/**
 * Plain, DB-agnostic input shapes for the transactional PDF templates. The
 * route layer maps rows from finance/tenancy tables (and the trust-account
 * model) onto these — the renderers never touch the database, so they are pure
 * and unit-testable.
 *
 * All money is integer cents (AUD), matching @goodstrata/shared's Cents.
 */

export type FundKind = "admin" | "maintenance" | string;

/** The issuing owners corporation — masthead + legal issuer of every document. */
export interface SchemeParty {
  name: string;
  planOfSubdivision: string;
  addressLine1?: string | null;
  addressLine2?: string | null;
  suburb?: string | null;
  state?: string | null;
  postcode?: string | null;
  abn?: string | null;
  /** When true, amounts are treated as GST-inclusive and a GST line is shown. */
  gstRegistered?: boolean;
}

/** Recipient of the document (lot owner / levy recipient). */
export interface BillToParty {
  name: string;
  companyName?: string | null;
  email?: string | null;
  /** Free-form mailing address lines, if held. */
  addressLines?: string[];
}

export interface LotRef {
  lotNumber: string;
  unitNumber?: string | null;
  streetAddress?: string | null;
}

/** Trust-account payment rails printed on a notice's payment panel. */
export interface PaymentRails {
  /** Unique per-notice payment reference (notice.payid / provider ref). */
  reference: string | null;
  bsb?: string | null;
  accountNumber?: string | null;
  /** PayID root of the per-OC virtual collection account. */
  payid?: string | null;
  accountName?: string | null;
}

export interface MoneyLine {
  fundKind: FundKind;
  description: string;
  amountCents: number;
}

/** LEVY NOTICE / TAX INVOICE. */
export interface LevyNoticeDoc {
  scheme: SchemeParty;
  billTo: BillToParty;
  lot: LotRef;
  notice: {
    noticeNumber: string;
    issuedAt?: Date | string | null;
    dueOn: string; // yyyy-mm-dd
    instalment?: number | null;
    frequencyLabel?: string | null;
    totalCents: number;
  };
  lines: MoneyLine[];
  payment: PaymentRails;
  /** Prior arrears carried into this notice, if any (shown as a note). */
  priorBalanceCents?: number | null;
  /** Interest accrued on overdue balances, if any (shown as a note). */
  interestNote?: string | null;
}

/** PAYMENT RECEIPT for a reconciled payment. */
export interface ReceiptDoc {
  scheme: SchemeParty;
  billTo: BillToParty;
  lot: LotRef;
  receipt: {
    receiptNumber: string;
    issuedAt?: Date | string | null;
  };
  payment: {
    amountCents: number;
    paidAt: Date | string;
    method: string; // provider: monoova | mock | manual
    payerName?: string | null;
    providerRef?: string | null;
  };
  /** Notice(s) the payment was allocated against. */
  appliedTo: { noticeNumber: string; amountCents: number }[];
  /** Split of the payment across funds. */
  allocations: MoneyLine[];
  /** Lot ledger balance after this payment (positive = owing). */
  runningBalanceCents: number;
}

export interface StatementEntry {
  effectiveOn: string; // yyyy-mm-dd
  kind: string; // levy_charge | payment | interest | adjustment ...
  description: string;
  /** Signed cents: charges positive, payments negative (matches the ledger). */
  amountCents: number;
  reference?: string | null;
}

/** OWNERS CORPORATION STATEMENT — a lot's ledger over a period. */
export interface StatementDoc {
  scheme: SchemeParty;
  billTo: BillToParty;
  lot: LotRef;
  period: { from: string; to: string };
  openingBalanceCents: number;
  entries: StatementEntry[];
  closingBalanceCents: number;
  /** Optional fund position summary (admin / maintenance balances). */
  fundSummary?: { name: string; kind: FundKind; balanceCents: number }[];
}
