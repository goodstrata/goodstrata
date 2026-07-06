import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, FileSearch, HardHat } from "lucide-react";
import { useMemo, useState } from "react";
import { z } from "zod";
import { Markdown } from "@/components/Markdown";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, unwrap } from "@/lib/api";
import { FormError, fieldError, SubmitButton, useAppForm } from "@/lib/form";
import { formatDate } from "@/lib/format";

export const Route = createFileRoute("/quote/$token")({
  component: QuotePage,
});

// ---------------------------------------------------------------------------
// Read shape — mirrors GET /api/quote/:token (backend contract). The preview
// exposes suburb only; it carries no address, no scheme, no other quotes.
// ---------------------------------------------------------------------------

interface QuotePreview {
  title: string;
  scopeMd: string;
  /** Server-escaped, whitelisted HTML — unused here; we render scopeMd via <Markdown>. */
  scopeHtml: string;
  suburb: string;
  category: string;
  quotesDueOn: string | null;
  rfqStatus: "draft" | "published" | "quoting" | "awarded" | "cancelled";
  alreadyQuoted: boolean;
  /** true = scheme-book contractor (name on file, contact block hidden). */
  hasContractor: boolean;
  businessName: string | null;
}

const OPEN_STATUSES = new Set(["published", "quoting"]);

function QuotePage() {
  const { token } = Route.useParams();
  const [submitted, setSubmitted] = useState(false);

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ["quote-preview", token],
    queryFn: async (): Promise<QuotePreview> =>
      unwrap<QuotePreview>(await fetch(`/api/quote/${encodeURIComponent(token)}`)),
    retry: false,
  });

  if (isPending) {
    return (
      <Shell>
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-48 w-full" />
      </Shell>
    );
  }

  // Invalid / unknown token — the neutral 404 card. No hint about whether the
  // token ever existed; a rate-limit reads the same way but keeps its message.
  if (isError) {
    const status = error instanceof ApiError ? error.status : 0;
    if (status === 404) {
      return (
        <Shell>
          <EmptyState
            icon={FileSearch}
            title="This quote link isn't valid"
            description="Check you opened the most recent link from your email. If it keeps failing, reply to the original request."
          />
        </Shell>
      );
    }
    return (
      <Shell>
        <ErrorState
          title="Couldn't open this quote"
          message={
            error instanceof Error
              ? error.message
              : "Something went wrong loading this request. Try again."
          }
          onRetry={() => void refetch()}
        />
      </Shell>
    );
  }

  const open = OPEN_STATUSES.has(data.rfqStatus);

  return (
    <Shell>
      <JobSummary preview={data} />
      {submitted ? (
        <SubmittedCard />
      ) : data.alreadyQuoted ? (
        <AlreadyQuotedCard />
      ) : !open ? (
        <ClosedCard status={data.rfqStatus} />
      ) : (
        <QuoteForm token={token} preview={data} onSubmitted={() => setSubmitted(true)} />
      )}
    </Shell>
  );
}

/** Centered single-column shell, comfortable to read on a phone at 390px. */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto mt-4 flex w-full max-w-xl flex-col gap-4 md:mt-10">{children}</div>
  );
}

// ---------------------------------------------------------------------------
// Job summary — what every state shows: title, trade/suburb/due, and the scope.
// Suburb is the only location; there is deliberately no address here.
// ---------------------------------------------------------------------------

function JobSummary({ preview }: { preview: QuotePreview }) {
  const dueLabel = preview.quotesDueOn
    ? `quotes due ${formatDate(preview.quotesDueOn)}`
    : "no fixed closing date";
  const pastDue =
    preview.quotesDueOn !== null &&
    OPEN_STATUSES.has(preview.rfqStatus) &&
    preview.quotesDueOn < todayIso();

  return (
    <Card>
      <CardHeader>
        <p className="text-13 font-medium text-muted-foreground">Request for quote</p>
        <CardTitle className="text-lg">{preview.title}</CardTitle>
        <CardDescription>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-medium text-foreground">{preview.category}</span>
            <span aria-hidden="true">·</span>
            <span>{preview.suburb}</span>
            <span aria-hidden="true">·</span>
            <span>{dueLabel}</span>
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="rounded-md border bg-muted/40 p-3">
          <p className="mb-1.5 text-13 font-medium text-muted-foreground">Scope of works</p>
          <Markdown className="prose-sm">{preview.scopeMd}</Markdown>
        </div>
        {pastDue && (
          <Alert tone="info">
            <FileSearch aria-hidden="true" />
            <AlertTitle>Closing date has passed</AlertTitle>
            <AlertDescription>
              The requested closing date has passed, but this job is still accepting quotes.
            </AlertDescription>
          </Alert>
        )}
        <p className="text-13 text-muted-foreground">
          The exact property address is shared with the successful contractor once the committee
          awards the job.
        </p>
      </CardContent>
    </Card>
  );
}

function todayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ---------------------------------------------------------------------------
// Friendly states.
// ---------------------------------------------------------------------------

function SubmittedCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CheckCircle2 aria-hidden="true" className="size-5 text-positive" />
          Quote received
        </CardTitle>
        <CardDescription>
          We've recorded your quote for this job. The committee reviews all quotes before awarding.
          If you need to revise it, reply to the original email and the committee will update it.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

function AlreadyQuotedCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CheckCircle2 aria-hidden="true" className="size-5 text-positive" />
          You've already quoted this job
        </CardTitle>
        <CardDescription>
          We've recorded your quote for this job. If you need to revise it, reply to the original
          email and the committee will update it.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

function ClosedCard({ status }: { status: QuotePreview["rfqStatus"] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Quoting for this job has closed</CardTitle>
        <CardDescription>
          This request is no longer accepting quotes.
          {status === "awarded" ? " This job has been awarded." : ""}
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The quote form — bound 1:1 to submitQuoteByTokenInput so the public form
// cannot submit anything the service would reject. Fee disclosure is always
// present (defaults 0); a nonzero fee requires a named recipient.
// ---------------------------------------------------------------------------

const EMAIL_LIKE = z.union([
  z.literal(""),
  z.email("Enter a valid email, like quotes@example.com."),
]);

/** Dollars text → validated. `positive` rejects empty / zero / negative. */
const dollarsField = (message: string, { positive = false } = {}) =>
  z
    .string()
    .trim()
    .refine(
      (v) =>
        v === ""
          ? !positive
          : Number.isFinite(Number(v)) && (positive ? Number(v) > 0 : Number(v) >= 0),
      message,
    );

const feeCents = (v: string) => (v.trim() === "" ? 0 : Math.round(Number(v) * 100));

function quoteSchema(hasContractor: boolean) {
  return (
    z
      .object({
        businessName: z.string().trim(),
        abn: z.string().trim().max(20, "Check the ABN — it looks too long."),
        email: EMAIL_LIKE,
        phone: z.string().trim().max(40),
        amount: dollarsField("Enter your quoted amount in dollars.", { positive: true }),
        validUntil: z.string(),
        notes: z.string().trim().max(5000, "Keep notes under 5,000 characters."),
        licenceConfirmed: z.boolean(),
        insuranceConfirmed: z.boolean(),
        platformFee: dollarsField("Enter the platform fee in dollars, or leave it empty."),
        referralFee: dollarsField("Enter the referral fee in dollars, or leave it empty."),
        feeRecipient: z.string().trim(),
      })
      // Invited-email channels have no business on file, so the name is required.
      .refine((v) => hasContractor || v.businessName.length >= 2, {
        message: "Enter your business name.",
        path: ["businessName"],
      })
      // Zero hidden margin: any fee must name who receives it.
      .refine(
        (v) =>
          feeCents(v.platformFee) + feeCents(v.referralFee) === 0 || v.feeRecipient.length >= 2,
        {
          message: "Name who receives the fee — a fee can't be recorded without a recipient.",
          path: ["feeRecipient"],
        },
      )
  );
}

type QuoteValues = z.infer<ReturnType<typeof quoteSchema>>;

function QuoteForm({
  token,
  preview,
  onSubmitted,
}: {
  token: string;
  preview: QuotePreview;
  onSubmitted: () => void;
}) {
  const schema = useMemo(() => quoteSchema(preview.hasContractor), [preview.hasContractor]);

  const form = useAppForm({
    schema,
    defaultValues: {
      businessName: "",
      abn: "",
      email: "",
      phone: "",
      amount: "",
      validUntil: "",
      notes: "",
      licenceConfirmed: false,
      insuranceConfirmed: false,
      platformFee: "",
      referralFee: "",
      feeRecipient: "",
    } satisfies QuoteValues,
    onSubmit: async (values) => {
      // schemeId / rfqId / contractorId / channelId are ALL derived from the
      // token server-side — the form never sends them.
      const body = {
        ...(preview.hasContractor
          ? {}
          : {
              contact: {
                businessName: values.businessName.trim(),
                ...(values.abn ? { abn: values.abn.trim() } : {}),
                ...(values.email ? { email: values.email.trim() } : {}),
                ...(values.phone ? { phone: values.phone.trim() } : {}),
              },
            }),
        amountCents: Math.round(Number(values.amount) * 100),
        ...(values.validUntil ? { validUntil: values.validUntil } : {}),
        ...(values.notes ? { notes: values.notes } : {}),
        licenceConfirmed: values.licenceConfirmed,
        insuranceConfirmed: values.insuranceConfirmed,
        platformFeeCents: feeCents(values.platformFee),
        referralFeeCents: feeCents(values.referralFee),
        ...(values.feeRecipient ? { feeRecipient: values.feeRecipient.trim() } : {}),
      };
      await unwrap(
        await fetch(`/api/quote/${encodeURIComponent(token)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
      onSubmitted();
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Add your quote</CardTitle>
        <CardDescription>
          {preview.hasContractor && preview.businessName
            ? `Quoting as ${preview.businessName}. `
            : "Tell us who's quoting, then your price. "}
          The committee compares all quotes before awarding — no login needed, this link is your
          identity.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          id="quote-form"
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          {/* Contact block — invited-email channels only. Scheme-book quotes
              use the contractor already on file (name shown, not editable). */}
          {preview.hasContractor ? (
            preview.businessName ? (
              <Field label="Business" hint="On file from your invitation." htmlFor="quote-business">
                <Input id="quote-business" value={preview.businessName} readOnly disabled />
              </Field>
            ) : null
          ) : (
            <>
              <form.Field name="businessName">
                {(field) => (
                  <Field label="Business name" required error={fieldError(field.state.meta.errors)}>
                    {(controlProps) => (
                      <Input
                        {...controlProps}
                        placeholder={`e.g. Westside ${preview.category} Services`}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                      />
                    )}
                  </Field>
                )}
              </form.Field>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <form.Field name="abn">
                  {(field) => (
                    <Field label="ABN" error={fieldError(field.state.meta.errors)}>
                      {(controlProps) => (
                        <Input
                          {...controlProps}
                          inputMode="numeric"
                          placeholder="Optional"
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(e) => field.handleChange(e.target.value)}
                        />
                      )}
                    </Field>
                  )}
                </form.Field>
                <form.Field name="phone">
                  {(field) => (
                    <Field label="Phone" error={fieldError(field.state.meta.errors)}>
                      {(controlProps) => (
                        <Input
                          {...controlProps}
                          type="tel"
                          inputMode="tel"
                          placeholder="Optional"
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(e) => field.handleChange(e.target.value)}
                        />
                      )}
                    </Field>
                  )}
                </form.Field>
              </div>
              <form.Field name="email">
                {(field) => (
                  <Field
                    label="Contact email"
                    hint="Optional — how the committee reaches you if awarded."
                    error={fieldError(field.state.meta.errors)}
                  >
                    {(controlProps) => (
                      <Input
                        {...controlProps}
                        type="email"
                        inputMode="email"
                        placeholder="Optional"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                      />
                    )}
                  </Field>
                )}
              </form.Field>
            </>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <form.Field name="amount">
              {(field) => (
                <Field label="Your quote ($)" required error={fieldError(field.state.meta.errors)}>
                  {(controlProps) => (
                    <Input
                      {...controlProps}
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      placeholder="e.g. 850"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                  )}
                </Field>
              )}
            </form.Field>
            <form.Field name="validUntil">
              {(field) => (
                <Field
                  label="Valid until"
                  hint="Optional."
                  error={fieldError(field.state.meta.errors)}
                >
                  {(controlProps) => (
                    <Input
                      {...controlProps}
                      type="date"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                  )}
                </Field>
              )}
            </form.Field>
          </div>

          <form.Field name="notes">
            {(field) => (
              <Field label="Notes" error={fieldError(field.state.meta.errors)}>
                {(controlProps) => (
                  <Textarea
                    {...controlProps}
                    className="min-h-20"
                    placeholder="Inclusions, exclusions, lead time…"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                )}
              </Field>
            )}
          </form.Field>

          <div className="flex flex-col gap-2">
            <form.Field name="licenceConfirmed">
              {(field) => (
                <label className="flex items-start gap-2.5 text-13 text-muted-foreground">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 accent-primary"
                    checked={field.state.value}
                    onChange={(e) => field.handleChange(e.target.checked)}
                  />
                  <span>I hold a current trade licence for this work.</span>
                </label>
              )}
            </form.Field>
            <form.Field name="insuranceConfirmed">
              {(field) => (
                <label className="flex items-start gap-2.5 text-13 text-muted-foreground">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 accent-primary"
                    checked={field.state.value}
                    onChange={(e) => field.handleChange(e.target.checked)}
                  />
                  <span>I hold current public-liability insurance.</span>
                </label>
              )}
            </form.Field>
          </div>

          {/* Fee disclosure — zero hidden margin. The recipient field stays
              greyed until a fee is entered, then becomes required. */}
          <fieldset className="flex flex-col gap-3 rounded-md border border-caution/25 bg-caution/5 p-3">
            <legend className="px-1 text-13 font-medium">Fee disclosure</legend>
            <p className="text-xs text-muted-foreground">
              If any platform or referral fee comes out of this quote, record it here with who
              receives it. This is shown to the committee in full.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <form.Field name="platformFee">
                {(field) => (
                  <Field label="Platform fee ($)" error={fieldError(field.state.meta.errors)}>
                    {(controlProps) => (
                      <Input
                        {...controlProps}
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        placeholder="0"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                      />
                    )}
                  </Field>
                )}
              </form.Field>
              <form.Field name="referralFee">
                {(field) => (
                  <Field label="Referral fee ($)" error={fieldError(field.state.meta.errors)}>
                    {(controlProps) => (
                      <Input
                        {...controlProps}
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        placeholder="0"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                      />
                    )}
                  </Field>
                )}
              </form.Field>
            </div>
            <form.Subscribe
              selector={(state) =>
                feeCents(state.values.platformFee) + feeCents(state.values.referralFee) > 0
              }
            >
              {(feeApplies) => (
                <form.Field name="feeRecipient">
                  {(field) => (
                    <Field
                      label="Who receives the fee?"
                      required={feeApplies}
                      hint={
                        feeApplies
                          ? "Any fee that comes out of this quote must name who receives it."
                          : "No platform or referral fee — leave the fees above at 0."
                      }
                      error={fieldError(field.state.meta.errors)}
                    >
                      {(controlProps) => (
                        <Input
                          {...controlProps}
                          disabled={!feeApplies}
                          placeholder={feeApplies ? "e.g. TradeMatch Marketplace Pty Ltd" : "—"}
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(e) => field.handleChange(e.target.value)}
                        />
                      )}
                    </Field>
                  )}
                </form.Field>
              )}
            </form.Subscribe>
          </fieldset>

          <FormError form={form} />
          <SubmitButton form={form} formId="quote-form" className="w-full">
            <HardHat aria-hidden="true" className="size-4" /> Submit quote
          </SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
