/**
 * P1 (build track) — Per-OC trust reconciliation & audit export (OC Act s 122).
 *
 * A registered OC manager must hold each owners corporation's money in the OC's
 * OWN segregated trust account and be able to reconcile and audit it
 * independently. This service produces, per OC:
 *
 *   - schemeTrustStatement: opening balance, receipts, payments and closing
 *     balance for a period, built from the immutable fund-transaction ledger
 *     (the schema's source of truth) and RECONCILED against the cash that moved
 *     through the scheme's own trust account (the payment/payout feed is the
 *     bank movement record). A non-zero variance is flagged for the auditor.
 *
 *   - exportTrustAudit: a structured, machine- and human-readable audit pack
 *     (CSV) an external auditor consumes, wrapping the same statement.
 *
 * Every figure is derived deterministically from integer cents and scoped to a
 * single scheme — one OC's money is never mixed with another's.
 *
 * Reconciliation model (no external bank API in this build):
 *   ledger side  = Σ fund_transactions.amount           (the OC's books)
 *   bank  side   = Σ payments in  −  Σ payouts out       (cash through the account)
 *   variance     = bank − ledger                         (0 ⇒ reconciled)
 * Accrued-but-uncollected items (e.g. interest not yet received, receipts not
 * yet matched to a fund) surface here as a genuine reconciling difference.
 */
import { funds, fundTransactions, payments, payouts, schemes } from "@goodstrata/db";
import { formatCents } from "@goodstrata/shared";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { ServiceContext } from "../context.js";
import { notFound } from "../errors.js";
import { getSchemeTrustAccount } from "./trustAccounts.js";

/** Reconciliation window; ISO date-only bounds (inclusive). Both optional. */
export const reconciliationPeriodInput = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export type ReconciliationPeriod = z.infer<typeof reconciliationPeriodInput>;

export interface TrustStatementLine {
  date: string;
  kind: string;
  description: string;
  /** Signed cents: receipts positive, payments negative. */
  amountCents: number;
  /** Running ledger balance after this line. */
  balanceCents: number;
}

export interface TrustStatement {
  schemeId: string;
  schemeName: string;
  /** The OC's own trust account (null if not yet provisioned — itself a flag). */
  bankAccountId: string | null;
  bankAccountStatus: string | null;
  /** Bounds actually applied; null when the statement spans all time. */
  period: { from: string | null; to: string | null };
  openingBalanceCents: number;
  /** Sum of positive movements in the period. */
  receiptsCents: number;
  /** Sum of negative movements in the period (signed, ≤ 0). */
  paymentsCents: number;
  /** Ledger balance as at the period end. */
  closingBalanceCents: number;
  /** Cash held per the bank movement feed (payments in − payouts out) as at period end. */
  bankBalanceCents: number;
  /** True when the ledger closing balance matches bank movements. */
  reconciled: boolean;
  /** Unreconciled difference (bank − ledger); 0 when reconciled. */
  varianceCents: number;
  lines: TrustStatementLine[];
  generatedAt: string;
}

/** True when `dateOnly(ts)` falls on/after `from` and on/before `to` (each optional). */
export function withinBounds(ts: Date, from?: string, to?: string): boolean {
  const day = ts.toISOString().slice(0, 10);
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

/** True when `dateOnly(ts) <= to` (or `to` is open). */
export function onOrBefore(ts: Date, to?: string): boolean {
  return !to || ts.toISOString().slice(0, 10) <= to;
}

const RECEIPT_PAYMENT_STATUSES = ["received", "matched", "unmatched"] as const;
const SETTLED_PAYOUT_STATUSES = ["sent", "settled"] as const;

/**
 * Build the per-OC trust statement for the (optional) period, reconciling the
 * fund-transaction ledger against the scheme's own trust-account cash. Pure read.
 */
export async function schemeTrustStatement(
  ctx: ServiceContext,
  schemeId: string,
  period?: ReconciliationPeriod,
): Promise<TrustStatement> {
  const scheme = await ctx.db.query.schemes.findFirst({ where: eq(schemes.id, schemeId) });
  if (!scheme) throw notFound("Scheme");

  const from = period?.from;
  const to = period?.to;

  const account = await getSchemeTrustAccount(ctx, schemeId);

  // Fund map (id → label) for readable statement lines.
  const fundRows = await ctx.db.query.funds.findMany({ where: eq(funds.schemeId, schemeId) });
  const fundLabel = new Map(fundRows.map((f) => [f.id, f.name]));

  // Ledger side: the OC's fund-transaction movements (source of truth).
  const txns = await ctx.db.query.fundTransactions.findMany({
    where: eq(fundTransactions.schemeId, schemeId),
    orderBy: [asc(fundTransactions.occurredAt), asc(fundTransactions.id)],
  });

  let openingBalanceCents = 0;
  let receiptsCents = 0;
  let paymentsCents = 0;
  const lines: TrustStatementLine[] = [];

  // Opening balance = everything strictly before the window start.
  for (const t of txns) {
    if (from && t.occurredAt.toISOString().slice(0, 10) < from) {
      openingBalanceCents += t.amountCents;
    }
  }

  let running = openingBalanceCents;
  for (const t of txns) {
    if (!withinBounds(t.occurredAt, from, to)) continue;
    running += t.amountCents;
    if (t.amountCents >= 0) receiptsCents += t.amountCents;
    else paymentsCents += t.amountCents;
    const label = t.fundId ? (fundLabel.get(t.fundId) ?? "Fund") : "Fund";
    lines.push({
      date: t.occurredAt.toISOString().slice(0, 10),
      kind: t.kind,
      description: `${label} — ${t.kind.replace(/_/g, " ")}`,
      amountCents: t.amountCents,
      balanceCents: running,
    });
  }
  const closingBalanceCents = running;

  // Bank side: cash that moved through the OC's own trust account, as at the
  // period end (payments credited in, payouts debited out).
  const paymentRows = await ctx.db.query.payments.findMany({
    where: eq(payments.schemeId, schemeId),
  });
  const payoutRows = await ctx.db.query.payouts.findMany({
    where: eq(payouts.schemeId, schemeId),
  });

  let bankBalanceCents = 0;
  for (const p of paymentRows) {
    if (!(RECEIPT_PAYMENT_STATUSES as readonly string[]).includes(p.status)) continue;
    if (!onOrBefore(p.paidAt, to)) continue;
    bankBalanceCents += p.amountCents;
  }
  for (const p of payoutRows) {
    if (!(SETTLED_PAYOUT_STATUSES as readonly string[]).includes(p.status)) continue;
    // Only count a debit once it has actually executed within the window.
    if (p.executedAt && !onOrBefore(p.executedAt, to)) continue;
    bankBalanceCents -= p.amountCents;
  }

  const varianceCents = bankBalanceCents - closingBalanceCents;

  return {
    schemeId,
    schemeName: scheme.name,
    bankAccountId: account?.id ?? null,
    bankAccountStatus: account?.status ?? null,
    period: { from: from ?? null, to: to ?? null },
    openingBalanceCents,
    receiptsCents,
    paymentsCents,
    closingBalanceCents,
    bankBalanceCents,
    reconciled: varianceCents === 0,
    varianceCents,
    lines,
    generatedAt: ctx.clock.now().toISOString(),
  };
}

export interface AuditExport {
  schemeId: string;
  schemeName: string;
  period: { from: string | null; to: string | null };
  statement: TrustStatement;
  /** RFC-4180 CSV audit pack (header block + ledger movements). */
  csv: string;
  /** Suggested download filename. */
  filename: string;
  generatedAt: string;
}

/** Escape a single CSV cell (RFC-4180): quote when it contains , " or newline. */
export function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvRow(cells: (string | number)[]): string {
  return cells.map(csvCell).join(",");
}

/**
 * Produce the auditor-facing export for a scheme's trust money over the period:
 * the reconciled statement plus a CSV pack (summary header + itemised ledger).
 */
export async function exportTrustAudit(
  ctx: ServiceContext,
  schemeId: string,
  period?: ReconciliationPeriod,
): Promise<AuditExport> {
  const statement = await schemeTrustStatement(ctx, schemeId, period);
  const dollars = (cents: number) => formatCents(cents);

  const rows: string[] = [];
  rows.push(csvRow(["GoodStrata trust account audit export"]));
  rows.push(csvRow(["Owners corporation", statement.schemeName]));
  rows.push(csvRow(["Scheme ID", statement.schemeId]));
  rows.push(csvRow(["Trust account ID", statement.bankAccountId ?? "NOT PROVISIONED"]));
  rows.push(csvRow(["Trust account status", statement.bankAccountStatus ?? "—"]));
  rows.push(csvRow(["Period from", statement.period.from ?? "inception"]));
  rows.push(csvRow(["Period to", statement.period.to ?? "present"]));
  rows.push(csvRow(["Generated at", statement.generatedAt]));
  rows.push(csvRow([]));
  rows.push(csvRow(["Opening balance", dollars(statement.openingBalanceCents)]));
  rows.push(csvRow(["Receipts", dollars(statement.receiptsCents)]));
  rows.push(csvRow(["Payments", dollars(statement.paymentsCents)]));
  rows.push(csvRow(["Closing balance (ledger)", dollars(statement.closingBalanceCents)]));
  rows.push(csvRow(["Bank balance (cash)", dollars(statement.bankBalanceCents)]));
  rows.push(csvRow(["Variance", dollars(statement.varianceCents)]));
  rows.push(csvRow(["Reconciled", statement.reconciled ? "YES" : "NO — REVIEW"]));
  rows.push(csvRow([]));
  rows.push(csvRow(["Date", "Kind", "Description", "Amount", "Balance"]));
  for (const line of statement.lines) {
    rows.push(
      csvRow([
        line.date,
        line.kind,
        line.description,
        dollars(line.amountCents),
        dollars(line.balanceCents),
      ]),
    );
  }
  const csv = `${rows.join("\r\n")}\r\n`;

  const stamp = statement.generatedAt.slice(0, 10);
  const filename = `trust-audit-${statement.schemeId}-${stamp}.csv`;

  return {
    schemeId,
    schemeName: statement.schemeName,
    period: statement.period,
    statement,
    csv,
    filename,
    generatedAt: statement.generatedAt,
  };
}
