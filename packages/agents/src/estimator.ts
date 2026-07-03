import { generateObject } from "ai";
import { z } from "zod";
import { type AiEnv, createModelResolver, type ModelResolver } from "./models.js";

/**
 * Public lead-gen extraction: read an owner's uploaded strata document (AGM
 * pack, budget, or financial statement) and pull out what the owners
 * corporation pays its STRATA MANAGER — management/agency fees, admin and
 * disbursements — not the whole budget and not building running costs.
 *
 * Runs against a VISION-capable model via the OpenAI-compatible (OpenRouter)
 * endpoint. Text-only agent models can't read documents, so this deliberately
 * resolves its own model key rather than the default agent model.
 *
 * Privacy: the file bytes are held only for the duration of the call and are
 * never written to disk or the event log. Nothing here persists.
 */

/**
 * Default vision model. A current, inexpensive multimodal model on OpenRouter
 * that handles both photographed pages and native PDFs. Override the whole key
 * (or just the model id) with AI_VISION_MODEL.
 */
export const DEFAULT_VISION_MODEL_KEY = "local:google/gemini-2.5-flash";

/**
 * Resolve the vision model key from the environment. Accepts either a full
 * `provider:model` key (e.g. `local:qwen/qwen2.5-vl-72b-instruct`) or a bare
 * model id, which is routed through the OpenAI-compatible (`local`) provider —
 * that's the OpenRouter path prod already uses.
 */
export function visionModelKey(env: Record<string, string | undefined> = process.env): string {
  const raw = env.AI_VISION_MODEL?.trim();
  if (!raw) return DEFAULT_VISION_MODEL_KEY;
  return raw.includes(":") ? raw : `local:${raw}`;
}

const lineItemSchema = z.object({
  label: z.string().describe("Short label exactly as printed, e.g. 'Management fee' or 'Sundries'"),
  amountCents: z
    .number()
    .int()
    .describe("Amount for this line as INTEGER CENTS (dollars × 100). $4,180.00 → 418000"),
});

export const strataFeeEstimateSchema = z.object({
  isStrataFinancialDoc: z
    .boolean()
    .describe(
      "True only if this is a strata / owners-corporation budget, AGM financial pack, or financial statement.",
    ),
  currency: z.string().describe("ISO currency code, e.g. 'AUD'. Default to 'AUD' if unclear."),
  managementFeeAnnualCents: z
    .number()
    .int()
    .nullable()
    .describe(
      "Annual base strata/agency management fee the owners corporation pays its manager, in INTEGER CENTS. Null if not found.",
    ),
  adminOrDisbursementCents: z
    .number()
    .int()
    .nullable()
    .describe(
      "Annual admin fee, disbursements, sundries or per-item charges paid to the manager, in INTEGER CENTS. Null if not found.",
    ),
  insuranceCommissionNoted: z
    .boolean()
    .describe(
      "True if the document shows the manager earns an insurance commission or broker fee.",
    ),
  otherManagerChargesCents: z
    .number()
    .int()
    .nullable()
    .describe(
      "Any other annual charges paid specifically to the manager (extra meetings, debt recovery admin, tech/portal fees), in INTEGER CENTS. Null if none.",
    ),
  totalManagerCostAnnualCents: z
    .number()
    .int()
    .nullable()
    .describe(
      "Best estimate of TOTAL annual cost paid to the strata manager, in INTEGER CENTS. Sum the manager-specific lines above; do not include insurance premiums, contractors, or utilities.",
    ),
  perLotAnnualCents: z
    .number()
    .int()
    .nullable()
    .describe(
      "Total manager cost divided by the number of lots, in INTEGER CENTS. Null if unknown.",
    ),
  lotCount: z
    .number()
    .int()
    .nullable()
    .describe("Number of lots / units in the scheme if stated or derivable. Null if unknown."),
  lineItems: z
    .array(lineItemSchema)
    .describe("Every manager-related charge you used, itemised. Empty array if none found."),
  confidence: z
    .enum(["low", "medium", "high"])
    .describe(
      "high = clear labelled manager fees; medium = some inference; low = guessed or document is unclear/not strata.",
    ),
  notes: z
    .string()
    .describe(
      "One or two plain-English sentences for the owner: what you found, what you excluded, and any caveats. If not a strata doc, explain what the document appears to be instead.",
    ),
});

export type StrataFeeEstimate = z.infer<typeof strataFeeEstimateSchema>;

export interface EstimateInput {
  /** Raw file bytes, held in memory only. */
  bytes: Uint8Array;
  /** MIME type: an image/* type or application/pdf. */
  mime: string;
  /** Optional original filename, passed to the model as a hint. */
  filename?: string;
}

export interface EstimateDeps {
  /** Inject a resolver (tests / route reuse). Defaults to one built from process.env. */
  resolveModel?: ModelResolver;
  /** Override the environment used to build the default resolver + pick the model. */
  env?: Record<string, string | undefined>;
}

export interface EstimateResult extends StrataFeeEstimate {
  /** The model key actually used, for transparency in the response. */
  model: string;
}

/** Thrown when the document can't be read (bad media type or model failure). */
export class EstimatorError extends Error {
  constructor(
    public code: "UNSUPPORTED_MEDIA" | "MODEL_ERROR",
    message: string,
  ) {
    super(message);
    this.name = "EstimatorError";
  }
}

const SUPPORTED_IMAGE = /^image\//i;
const PDF_MIME = "application/pdf";

const SYSTEM_PROMPT = [
  "You are a plain-spoken Australian strata finance analyst helping a lot owner",
  "understand what their owners corporation pays its STRATA MANAGER (the managing",
  "agent), separate from everything else in the budget.",
  "",
  "Read the supplied document image or PDF carefully. Focus ONLY on money that",
  "flows to the strata manager / managing agent as their remuneration:",
  "  • the base management / agency fee (often annual, sometimes per lot per year)",
  "  • administration fees, disbursements, sundries and per-item charges billed by the manager",
  "  • extra manager charges: additional meeting fees, debt-recovery admin, portal/technology fees",
  "  • note (boolean only) whether the manager earns an insurance commission",
  "",
  "Explicitly EXCLUDE from the manager total: insurance premiums, contractor and",
  "trade costs, utilities, repairs, capital works / sinking-fund contributions,",
  "cleaning, gardening, and the overall levy or budget total. Those are the",
  "building's costs, not the manager's fee.",
  "",
  "All *Cents fields are INTEGER CENTS: multiply any dollar figure by 100.",
  "$4,180.00 becomes 418000. Never return dollars in a cents field.",
  "If a figure is monthly, annualise it (×12) before converting to cents.",
  "If you cannot find a value, return null — do not guess a number.",
  "If the document is not a strata/owners-corporation financial document, set",
  "isStrataFinancialDoc to false, set money fields to null, and explain in notes.",
].join("\n");

/**
 * Extract the strata-manager cost from an uploaded document. Processes bytes in
 * memory; nothing is stored.
 */
export async function estimateStrataFees(
  input: EstimateInput,
  deps: EstimateDeps = {},
): Promise<EstimateResult> {
  const env = deps.env ?? (process.env as Record<string, string | undefined>);
  const mime = input.mime.toLowerCase();
  const isImage = SUPPORTED_IMAGE.test(mime);
  const isPdf = mime === PDF_MIME;

  if (!isImage && !isPdf) {
    throw new EstimatorError(
      "UNSUPPORTED_MEDIA",
      `Unsupported file type '${input.mime}'. Upload a PDF or an image.`,
    );
  }

  const resolve = deps.resolveModel ?? createModelResolver(env as AiEnv);
  const modelKey = visionModelKey(env);
  const { model, modelId } = resolve("vision", modelKey);

  // Multimodal user content. AI SDK v7 unifies both images and PDFs on the
  // `file` part; the image/* vs application/pdf mediaType tells the provider how
  // to treat the bytes.
  const filePart = isImage
    ? ({ type: "file", data: input.bytes, mediaType: input.mime } as const)
    : ({
        type: "file",
        data: input.bytes,
        mediaType: PDF_MIME,
        filename: input.filename ?? "document.pdf",
      } as const);

  const instruction =
    "Analyse the attached strata document and extract what the owners corporation" +
    " pays its strata manager. Return the structured result." +
    (input.filename ? ` The file is named "${input.filename}".` : "");

  try {
    const { object } = await generateObject({
      model,
      schema: strataFeeEstimateSchema,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: instruction }, filePart],
        },
      ],
    });

    return { ...normalise(object), model: modelId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new EstimatorError("MODEL_ERROR", `Couldn't read the document: ${message}`);
  }
}

/**
 * Defensive tidy-up: if the model omitted a total but gave the parts, sum them;
 * if it gave a total and a lot count but no per-lot, derive it. Never invents
 * numbers — only combines what the model already returned.
 */
function normalise(o: StrataFeeEstimate): StrataFeeEstimate {
  const parts = [
    o.managementFeeAnnualCents,
    o.adminOrDisbursementCents,
    o.otherManagerChargesCents,
  ];
  const known = parts.filter((v): v is number => typeof v === "number");

  let total = o.totalManagerCostAnnualCents;
  if (total == null && known.length > 0) {
    total = known.reduce((a, b) => a + b, 0);
  }

  let perLot = o.perLotAnnualCents;
  if (perLot == null && total != null && o.lotCount && o.lotCount > 0) {
    perLot = Math.round(total / o.lotCount);
  }

  return {
    ...o,
    currency: o.currency?.trim() || "AUD",
    totalManagerCostAnnualCents: total,
    perLotAnnualCents: perLot,
  };
}
