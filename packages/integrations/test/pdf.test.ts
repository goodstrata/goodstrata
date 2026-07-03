import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  buildLevyNoticePdf,
  buildReceiptPdf,
  buildStatementPdf,
  type LevyNoticeDoc,
  type ReceiptDoc,
  type StatementDoc,
} from "../src/pdf/index.js";

const scheme = {
  name: "The Eucalypt — Owners Corporation 1",
  planOfSubdivision: "PS543210V",
  addressLine1: "12 Wattle Street",
  suburb: "Fitzroy",
  state: "VIC",
  postcode: "3065",
  abn: "55 684 135 760",
  gstRegistered: true,
};
const billTo = {
  name: "Alex Owner",
  addressLines: ["Unit 2 / 12 Wattle Street", "Fitzroy VIC 3065"],
};
const lot = { lotNumber: "2", unitNumber: "2", streetAddress: "Unit 2 / 12 Wattle Street" };

const levyDoc: LevyNoticeDoc = {
  scheme,
  billTo,
  lot,
  notice: {
    noticeNumber: "LN-2026-01-2",
    issuedAt: new Date("2026-07-03T00:00:00Z"),
    dueOn: "2026-08-01",
    instalment: 1,
    frequencyLabel: "Quarterly",
    totalCents: 132000,
  },
  lines: [
    { fundKind: "admin", description: "Administration fund levy", amountCents: 88000 },
    {
      fundKind: "maintenance",
      description: "Maintenance (capital works) fund levy",
      amountCents: 44000,
    },
  ],
  payment: {
    reference: "GS-PS543210V-LN20260102",
    bsb: "802-985",
    accountNumber: "41234567",
    payid: "levies@ps543210v.goodstrata.com.au",
    accountName: "OC1 PS543210V Trust",
  },
  priorBalanceCents: 15000,
  interestNote: "Interest of $12.40 has accrued on overdue amounts.",
};

const receiptDoc: ReceiptDoc = {
  scheme,
  billTo,
  lot,
  receipt: { receiptNumber: "R-LN-2026-01-2-1", issuedAt: new Date("2026-07-03T00:00:00Z") },
  payment: {
    amountCents: 132000,
    paidAt: new Date("2026-07-03T00:00:00Z"),
    method: "monoova",
    payerName: "Alex Owner",
    providerRef: "MNV-88213",
  },
  appliedTo: [{ noticeNumber: "LN-2026-01-2", amountCents: 132000 }],
  allocations: [
    { fundKind: "admin", description: "Administration fund", amountCents: 88000 },
    {
      fundKind: "maintenance",
      description: "Maintenance (capital works) fund",
      amountCents: 44000,
    },
  ],
  runningBalanceCents: 15000,
};

// Long enough to force a page break — exercises multi-page pagination.
const statementDoc: StatementDoc = {
  scheme,
  billTo,
  lot,
  period: { from: "2025-07-01", to: "2026-06-30" },
  openingBalanceCents: 0,
  entries: Array.from({ length: 30 }, (_, i) => ({
    effectiveOn: `2026-${String((i % 12) + 1).padStart(2, "0")}-15`,
    kind: i % 2 === 0 ? "levy_charge" : "payment",
    description: i % 2 === 0 ? "Quarterly levy" : "Bank transfer",
    amountCents: i % 2 === 0 ? 132000 : -132000,
    reference: `REF-${i}`,
  })),
  closingBalanceCents: 0,
  fundSummary: [
    { name: "Administration fund", kind: "admin", balanceCents: 1250000 },
    { name: "Maintenance (capital works) fund", kind: "maintenance", balanceCents: 8400000 },
  ],
};

/** %PDF header, valid EOF marker, and the page count from the pages tree. */
function inspectPdf(buf: Buffer): { header: string; pages: number; hasEof: boolean } {
  const latin = buf.toString("latin1");
  const counts = [...latin.matchAll(/\/Count\s+(\d+)/g)].map((m) => Number(m[1]));
  return {
    header: buf.subarray(0, 5).toString("latin1"),
    pages: counts.length ? Math.max(...counts) : 0,
    hasEof: latin.trimEnd().endsWith("%%EOF"),
  };
}

describe("transactional PDF templates", () => {
  let dir: string;

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("renders a valid levy notice / tax invoice to a temp path", async () => {
    dir = await mkdtemp(join(tmpdir(), "gs-pdf-"));
    const buf = await buildLevyNoticePdf(levyDoc);
    const path = join(dir, "levy-notice.pdf");
    await writeFile(path, buf);

    const round = await readFile(path);
    const info = inspectPdf(round);
    expect(info.header).toBe("%PDF-");
    expect(info.hasEof).toBe(true);
    expect(info.pages).toBeGreaterThanOrEqual(1);
    expect(round.length).toBeGreaterThan(2000);
  });

  it("renders a valid payment receipt to a temp path", async () => {
    dir ||= await mkdtemp(join(tmpdir(), "gs-pdf-"));
    const buf = await buildReceiptPdf(receiptDoc);
    const path = join(dir, "receipt.pdf");
    await writeFile(path, buf);

    const info = inspectPdf(await readFile(path));
    expect(info.header).toBe("%PDF-");
    expect(info.hasEof).toBe(true);
    expect(info.pages).toBeGreaterThanOrEqual(1);
  });

  it("renders a multi-page owners corporation statement to a temp path", async () => {
    dir ||= await mkdtemp(join(tmpdir(), "gs-pdf-"));
    const buf = await buildStatementPdf(statementDoc);
    const path = join(dir, "statement.pdf");
    await writeFile(path, buf);

    const info = inspectPdf(await readFile(path));
    expect(info.header).toBe("%PDF-");
    expect(info.hasEof).toBe(true);
    // 30 ledger rows + header/summary overflow one A4 page.
    expect(info.pages).toBeGreaterThanOrEqual(2);
  });

  it("degrades gracefully when optional fields are absent", async () => {
    const minimal: LevyNoticeDoc = {
      scheme: { name: "OC 9", planOfSubdivision: "PS9" },
      billTo: { name: "Owner" },
      lot: { lotNumber: "1" },
      notice: { noticeNumber: "LN-1", dueOn: "2026-01-01", totalCents: 50000 },
      lines: [{ fundKind: "admin", description: "Admin levy", amountCents: 50000 }],
      payment: { reference: null },
    };
    const buf = await buildLevyNoticePdf(minimal);
    expect(inspectPdf(buf).header).toBe("%PDF-");
  });
});
