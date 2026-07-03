/**
 * Transactional PDF system for GoodStrata (The Registry). Node-only renderer
 * (pdfkit) — no headless browser — that produces branded levy notices / tax
 * invoices, payment receipts, and owners corporation statements. Templates are
 * pure functions of plain data (see ./types), so they render identically from
 * live DB rows or fixtures.
 */

export { buildLevyNoticePdf } from "./levyNotice.js";
export { buildReceiptPdf } from "./receipt.js";
export { buildStatementPdf } from "./statement.js";
export { fundLabel, money as formatMoneyCents } from "./theme.js";
export type {
  BillToParty,
  FundKind,
  LevyNoticeDoc,
  LotRef,
  MoneyLine,
  PaymentRails,
  ReceiptDoc,
  SchemeParty,
  StatementDoc,
  StatementEntry,
} from "./types.js";
