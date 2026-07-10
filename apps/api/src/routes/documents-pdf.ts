import { arrearsService } from "@goodstrata/core";
import {
  bankAccounts,
  funds as fundsTable,
  fundTransactions,
  levyNoticeLines,
  levyNotices,
  lots,
  paymentAllocations,
  payments,
  people,
  receipts,
  schemes,
} from "@goodstrata/db";
import {
  type BillToParty,
  buildLevyNoticePdf,
  buildReceiptPdf,
  buildStatementPdf,
  type LevyNoticeDoc,
  type ReceiptDoc,
  type SchemeParty,
  type StatementDoc,
} from "@goodstrata/integrations/pdf";
import { formatCents, toDateOnly, userActor } from "@goodstrata/shared";
import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { type AppEnv, requireSchemeMember } from "../middleware.js";
import { zv } from "../validate.js";

type SchemeRow = typeof schemes.$inferSelect;
type PersonRow = typeof people.$inferSelect;

const TRUST_ACCOUNT_KIND = "virtual_collection" as const;

/** Sanitise a value into a filename-safe token. */
function slug(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "document";
}

function mapScheme(s: SchemeRow): SchemeParty {
  return {
    name: s.name,
    planOfSubdivision: s.planOfSubdivision,
    addressLine1: s.addressLine1,
    addressLine2: s.addressLine2,
    suburb: s.suburb,
    state: s.state,
    postcode: s.postcode,
    abn: s.abn,
    gstRegistered: s.gstRegistered,
  };
}

/** Best-effort mailing-address lines from the free-form people.mailingAddress. */
function addressLines(person: PersonRow | null | undefined): string[] {
  const raw = person?.mailingAddress as unknown;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === "string");
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const line1 = [o.line1, o.line2].filter((v): v is string => typeof v === "string");
    const cityLine = [o.suburb, o.state, o.postcode]
      .filter((v): v is string => typeof v === "string")
      .join(" ");
    return [...line1, cityLine].filter(Boolean);
  }
  return [];
}

async function billToForLot(
  deps: AppDeps,
  ctx: ReturnType<AppDeps["serviceContext"]>,
  schemeId: string,
  lotId: string,
): Promise<{ billTo: BillToParty; person: PersonRow | null }> {
  const recipient = await arrearsService.levyRecipient(ctx, schemeId, lotId);
  const person = recipient
    ? ((await deps.db.query.people.findFirst({ where: eq(people.id, recipient.personId) })) ?? null)
    : null;
  return {
    billTo: {
      name: recipient?.name ?? person?.companyName ?? "Lot owner",
      companyName: person?.companyName ?? null,
      email: recipient?.email ?? person?.email ?? null,
      addressLines: addressLines(person),
    },
    person,
  };
}

function streamPdf(
  // biome-ignore lint/suspicious/noExplicitAny: Hono context is generic here
  c: any,
  buffer: Buffer,
  filename: string,
) {
  c.header("content-type", "application/pdf");
  c.header("content-disposition", `attachment; filename="${filename}"`);
  c.header("content-length", String(buffer.length));
  return c.body(new Uint8Array(buffer));
}

/**
 * Branded transactional PDFs (levy notice / tax invoice, payment receipt, owners
 * corporation statement). Mounted under /schemes so every route is scheme-scoped
 * and membership-guarded, matching the finance/trust routes. Rendered in-process
 * with pdfkit (no headless browser) and streamed as application/pdf.
 */
export function documentsPdfRoutes(deps: AppDeps) {
  return (
    new Hono<AppEnv>()
      // LEVY NOTICE / TAX INVOICE.
      .get(
        "/:schemeId/documents/levy-notices/:noticeId/pdf",
        requireSchemeMember(deps),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const schemeId = c.get("schemeId");
          const noticeId = c.req.param("noticeId");

          const notice = await deps.db.query.levyNotices.findFirst({
            where: and(eq(levyNotices.id, noticeId), eq(levyNotices.schemeId, schemeId)),
          });
          if (!notice)
            return c.json({ error: { code: "NOT_FOUND", message: "Notice not found" } }, 404);

          const [scheme, lot, lines, trust] = await Promise.all([
            deps.db.query.schemes.findFirst({ where: eq(schemes.id, schemeId) }),
            deps.db.query.lots.findFirst({ where: eq(lots.id, notice.lotId) }),
            deps.db.query.levyNoticeLines.findMany({
              where: eq(levyNoticeLines.levyNoticeId, notice.id),
            }),
            deps.db.query.bankAccounts.findFirst({
              where: and(
                eq(bankAccounts.schemeId, schemeId),
                eq(bankAccounts.kind, TRUST_ACCOUNT_KIND),
              ),
            }),
          ]);
          if (!scheme || !lot) {
            return c.json({ error: { code: "NOT_FOUND", message: "Notice not found" } }, 404);
          }

          const { billTo } = await billToForLot(deps, ctx, schemeId, notice.lotId);

          // Ledger-derived arrears context: what the lot owes BEYOND this
          // notice (older notices, adjustments, posted penalty interest), and
          // how much of that is interest — so the printed notice reconciles
          // exactly with the lot statement.
          const allocs = await deps.db.query.paymentAllocations.findMany({
            where: eq(paymentAllocations.levyNoticeId, notice.id),
          });
          const allocated = allocs.reduce((a, r) => a + r.amountCents, 0);
          const noticeOpen = ["issued", "partially_paid", "overdue"].includes(notice.status);
          const noticeOutstanding = noticeOpen ? Math.max(0, notice.totalCents - allocated) : 0;
          const statement = await arrearsService.lotStatement(ctx, schemeId, notice.lotId);
          const priorBalanceCents = Math.max(0, statement.balanceCents - noticeOutstanding);
          const postedInterestCents = statement.entries
            .filter((e) => e.kind === "interest")
            .reduce((a, e) => a + e.amountCents, 0);
          const unpaidInterestCents = Math.min(priorBalanceCents, Math.max(0, postedInterestCents));
          const interestNote =
            unpaidInterestCents > 0
              ? `The prior balance includes ${formatCents(unpaidInterestCents)} of penalty interest charged on overdue levies (Owners Corporations Act 2006 (Vic) s 29).`
              : null;

          const doc: LevyNoticeDoc = {
            scheme: mapScheme(scheme),
            billTo,
            lot: {
              lotNumber: lot.lotNumber,
              unitNumber: lot.unitNumber,
              streetAddress: lot.streetAddress,
            },
            notice: {
              noticeNumber: notice.noticeNumber,
              issuedAt: notice.issuedAt,
              dueOn: notice.dueOn,
              instalment: notice.instalment,
              totalCents: notice.totalCents,
            },
            lines: lines.map((l) => ({
              fundKind: l.fundKind,
              description: l.description,
              amountCents: l.amountCents,
            })),
            payment: {
              reference: notice.payid,
              bsb: trust?.bsb ?? null,
              accountNumber: trust?.accountNumber ?? null,
              payid: trust?.payidRoot ?? null,
              accountName: scheme.name,
            },
            priorBalanceCents,
            interestNote,
          };

          const pdf = await buildLevyNoticePdf(doc);
          return streamPdf(c, pdf, `Levy-Notice-${slug(notice.noticeNumber)}.pdf`);
        },
      )
      // PAYMENT RECEIPT.
      .get(
        "/:schemeId/documents/payments/:paymentId/receipt.pdf",
        requireSchemeMember(deps),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const schemeId = c.get("schemeId");
          const paymentId = c.req.param("paymentId");

          const payment = await deps.db.query.payments.findFirst({
            where: and(eq(payments.id, paymentId), eq(payments.schemeId, schemeId)),
          });
          if (!payment) {
            return c.json({ error: { code: "NOT_FOUND", message: "Payment not found" } }, 404);
          }

          const receipt = await deps.db.query.receipts.findFirst({
            where: and(eq(receipts.paymentId, payment.id), eq(receipts.schemeId, schemeId)),
          });
          if (!receipt) {
            return c.json(
              { error: { code: "NO_RECEIPT", message: "No receipt issued for this payment" } },
              404,
            );
          }

          const [scheme, allocs] = await Promise.all([
            deps.db.query.schemes.findFirst({ where: eq(schemes.id, schemeId) }),
            deps.db.query.paymentAllocations.findMany({
              where: eq(paymentAllocations.paymentId, payment.id),
            }),
          ]);
          if (!scheme) return c.json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404);

          const noticeIds = allocs.map((a) => a.levyNoticeId);
          const notices = noticeIds.length
            ? await deps.db.query.levyNotices.findMany({
                where: inArray(levyNotices.id, noticeIds),
              })
            : [];
          const appliedTo = allocs.map((a) => ({
            noticeNumber: notices.find((n) => n.id === a.levyNoticeId)?.noticeNumber ?? "—",
            amountCents: a.amountCents,
          }));

          // Fund split — the levy_receipt fund transactions tagged with this payment.
          const [ftx, fundRows] = await Promise.all([
            deps.db.query.fundTransactions.findMany({
              where: and(
                eq(fundTransactions.schemeId, schemeId),
                eq(fundTransactions.kind, "levy_receipt"),
              ),
            }),
            deps.db.query.funds.findMany({ where: eq(fundsTable.schemeId, schemeId) }),
          ]);
          const allocations = ftx
            .filter((t) => (t.reference as { paymentId?: string } | null)?.paymentId === payment.id)
            .map((t) => {
              const fund = fundRows.find((f) => f.id === t.fundId);
              return {
                fundKind: fund?.kind ?? "admin",
                description: fund?.name ?? "Fund",
                amountCents: t.amountCents,
              };
            });

          const lotId = notices[0]?.lotId;
          const lot = lotId
            ? await deps.db.query.lots.findFirst({ where: eq(lots.id, lotId) })
            : null;
          const { billTo } = lotId
            ? await billToForLot(deps, ctx, schemeId, lotId)
            : { billTo: { name: payment.payerName ?? "Lot owner" } as BillToParty };
          const running = lotId
            ? (await arrearsService.lotStatement(ctx, schemeId, lotId)).balanceCents
            : 0;

          const doc: ReceiptDoc = {
            scheme: mapScheme(scheme),
            billTo,
            lot: { lotNumber: lot?.lotNumber ?? "—" },
            receipt: { receiptNumber: receipt.receiptNumber, issuedAt: receipt.createdAt },
            payment: {
              amountCents: payment.amountCents,
              paidAt: payment.paidAt,
              method: payment.provider,
              payerName: payment.payerName,
              providerRef: payment.providerRef,
            },
            appliedTo,
            allocations,
            runningBalanceCents: running,
          };

          const pdf = await buildReceiptPdf(doc);
          return streamPdf(c, pdf, `Receipt-${slug(receipt.receiptNumber)}.pdf`);
        },
      )
      // OWNERS CORPORATION STATEMENT (a lot's ledger over a period).
      .get(
        "/:schemeId/documents/lots/:lotId/statement.pdf",
        requireSchemeMember(deps),
        zv(
          "query",
          z.object({
            from: z
              .string()
              .regex(/^\d{4}-\d{2}-\d{2}$/)
              .optional(),
            to: z
              .string()
              .regex(/^\d{4}-\d{2}-\d{2}$/)
              .optional(),
          }),
        ),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const schemeId = c.get("schemeId");
          const lotId = c.req.param("lotId");
          const q = c.req.valid("query");

          const [scheme, lot] = await Promise.all([
            deps.db.query.schemes.findFirst({ where: eq(schemes.id, schemeId) }),
            deps.db.query.lots.findFirst({
              where: and(eq(lots.id, lotId), eq(lots.schemeId, schemeId)),
            }),
          ]);
          if (!scheme || !lot) {
            return c.json({ error: { code: "NOT_FOUND", message: "Lot not found" } }, 404);
          }

          const { entries } = await arrearsService.lotStatement(ctx, schemeId, lotId);
          const today = toDateOnly(ctx.clock.now());
          const from = q.from ?? entries[0]?.effectiveOn ?? today;
          const to = q.to ?? today;

          const opening = entries
            .filter((e) => e.effectiveOn < from)
            .reduce((a, e) => a + e.amountCents, 0);
          const inRange = entries.filter((e) => e.effectiveOn >= from && e.effectiveOn <= to);
          const closing = opening + inRange.reduce((a, e) => a + e.amountCents, 0);

          const { billTo } = await billToForLot(deps, ctx, schemeId, lotId);
          const fundRows = await deps.db.query.funds.findMany({
            where: eq(fundsTable.schemeId, schemeId),
          });

          const doc: StatementDoc = {
            scheme: mapScheme(scheme),
            billTo,
            lot: {
              lotNumber: lot.lotNumber,
              unitNumber: lot.unitNumber,
              streetAddress: lot.streetAddress,
            },
            period: { from, to },
            openingBalanceCents: opening,
            entries: inRange.map((e) => ({
              effectiveOn: e.effectiveOn,
              kind: e.kind,
              description: e.note ?? "",
              amountCents: e.amountCents,
              reference: null,
            })),
            closingBalanceCents: closing,
            fundSummary: fundRows.map((f) => ({
              name: f.name,
              kind: f.kind,
              balanceCents: f.balanceCents,
            })),
          };

          const pdf = await buildStatementPdf(doc);
          return streamPdf(c, pdf, `Statement-Lot-${slug(lot.lotNumber)}-${from}_${to}.pdf`);
        },
      )
  );
}
