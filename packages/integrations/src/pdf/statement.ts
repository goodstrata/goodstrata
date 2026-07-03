import {
  color,
  contentWidth,
  createBrandedDoc,
  drawFooters,
  drawMasthead,
  drawMetaGrid,
  drawParty,
  font,
  formatDate,
  money,
  page,
} from "./render.js";
import type { StatementDoc, StatementEntry } from "./types.js";

type Doc = typeof import("pdfkit").prototype;

const KIND_LABELS: Record<string, string> = {
  levy_charge: "Levy charge",
  payment: "Payment received",
  interest: "Interest",
  adjustment: "Adjustment",
  opening: "Opening balance",
};

const BOTTOM_LIMIT = page.height - page.margin - 40;

// Column geometry for the ledger table.
const COLS = {
  date: { x: page.margin, w: 74 },
  desc: { x: page.margin + 74, w: contentWidth - 74 - 92 - 92 - 96 },
  charge: { x: 0, w: 92 },
  payment: { x: 0, w: 92 },
  balance: { x: 0, w: 96 },
};
COLS.charge.x = page.margin + contentWidth - 92 - 92 - 96;
COLS.payment.x = page.margin + contentWidth - 92 - 96;
COLS.balance.x = page.margin + contentWidth - 96;

function ledgerHeader(
  doc: Doc,
  fonts: ReturnType<typeof createBrandedDoc>["fonts"],
  y: number,
): number {
  doc.fillColor(color.mutedInk).font(fonts.face(font.sansSemibold)).fontSize(8.5);
  doc.text("Date", COLS.date.x, y, { width: COLS.date.w });
  doc.text("Description", COLS.desc.x, y, { width: COLS.desc.w });
  doc.text("Charges", COLS.charge.x, y, { width: COLS.charge.w, align: "right" });
  doc.text("Payments", COLS.payment.x, y, { width: COLS.payment.w, align: "right" });
  doc.text("Balance", COLS.balance.x, y, { width: COLS.balance.w, align: "right" });
  const yy = doc.y + 5;
  doc
    .moveTo(page.margin, yy)
    .lineTo(page.margin + contentWidth, yy)
    .lineWidth(1)
    .stroke(color.ink);
  return yy + 8;
}

/**
 * OWNERS CORPORATION STATEMENT — a lot's ledger over a period with a running
 * balance (opening → charges/payments → closing) and an optional fund summary.
 * Handles page breaks, repeating the column header on each page.
 */
export function buildStatementPdf(data: StatementDoc): Promise<Buffer> {
  const { doc, fonts, done } = createBrandedDoc({
    title: `Statement — Lot ${data.lot.lotNumber}`,
    subject: `Owners corporation statement for lot ${data.lot.lotNumber}, ${data.scheme.name}`,
  });

  let y = drawMasthead(doc, fonts, data.scheme, "Owners Corporation Statement");

  const colGap = 24;
  const colW = (contentWidth - colGap) / 2;
  const rightX = page.margin + colW + colGap;

  const partyBottom = drawParty(
    doc,
    fonts,
    "Account",
    [data.billTo.name, `Lot ${data.lot.lotNumber}`, data.lot.streetAddress],
    page.margin,
    y,
    colW,
  );
  const metaBottom = drawMetaGrid(
    doc,
    fonts,
    [
      { label: "Period from", value: formatDate(data.period.from) },
      { label: "Period to", value: formatDate(data.period.to) },
      {
        label: "Closing balance",
        value: money(data.closingBalanceCents),
        strong: true,
        mono: true,
      },
    ],
    rightX,
    y,
    colW,
  );
  y = Math.max(partyBottom, metaBottom) + 22;

  // Ledger table.
  y = ledgerHeader(doc, fonts, y);

  let running = data.openingBalanceCents;
  const drawRow = (label: string, dateStr: string, amount: number | null, isOpening = false) => {
    if (y > BOTTOM_LIMIT) {
      doc.addPage();
      y = page.margin;
      y = ledgerHeader(doc, fonts, y);
    }
    if (amount !== null) running += amount;
    const charge = amount !== null && amount > 0 ? money(amount) : "";
    const payment = amount !== null && amount < 0 ? money(-amount) : "";
    doc
      .fillColor(color.mutedInk)
      .font(fonts.face(font.mono))
      .fontSize(8.5)
      .text(dateStr, COLS.date.x, y, { width: COLS.date.w, lineBreak: false });
    doc
      .fillColor(color.ink)
      .font(fonts.face(isOpening ? font.sansSemibold : font.sans))
      .fontSize(9.5)
      .text(label, COLS.desc.x, y, { width: COLS.desc.w });
    const descBottom = doc.y;
    doc.font(fonts.face(font.mono)).fontSize(9.5);
    if (charge)
      doc
        .fillColor(color.ink)
        .text(charge, COLS.charge.x, y, { width: COLS.charge.w, align: "right" });
    if (payment)
      doc
        .fillColor(color.primaryStrong)
        .text(payment, COLS.payment.x, y, { width: COLS.payment.w, align: "right" });
    doc
      .fillColor(color.ink)
      .font(fonts.face(font.monoMedium))
      .text(money(running), COLS.balance.x, y, { width: COLS.balance.w, align: "right" });
    y = Math.max(descBottom, doc.y) + 7;
    doc
      .moveTo(page.margin, y - 3)
      .lineTo(page.margin + contentWidth, y - 3)
      .lineWidth(0.4)
      .stroke(color.line);
  };

  drawRow("Opening balance", formatDateShort(data.period.from), null, true);
  for (const e of data.entries) {
    drawRow(entryLabel(e), formatDateShort(e.effectiveOn), e.amountCents);
  }

  // Closing balance emphasis row.
  y += 4;
  if (y > BOTTOM_LIMIT) {
    doc.addPage();
    y = page.margin;
  }
  doc.rect(page.margin, y, contentWidth, 28).fill(color.accent);
  doc
    .fillColor(color.accentInk)
    .font(fonts.face(font.sansBold))
    .fontSize(10.5)
    .text("Closing balance", COLS.desc.x, y + 8, { width: COLS.desc.w });
  doc
    .fillColor(color.primaryStrong)
    .font(fonts.face(font.monoMedium))
    .fontSize(12)
    .text(money(data.closingBalanceCents), COLS.balance.x - 4, y + 7, {
      width: COLS.balance.w,
      align: "right",
    });
  y += 28 + 6;
  doc
    .fillColor(color.mutedInk)
    .font(fonts.face(font.sans))
    .fontSize(8)
    .text(
      data.closingBalanceCents > 0
        ? `${money(data.closingBalanceCents)} is currently owing on this lot.`
        : data.closingBalanceCents < 0
          ? `This lot is ${money(-data.closingBalanceCents)} in credit.`
          : "This lot is paid in full.",
      page.margin,
      y,
      { width: contentWidth },
    );
  y = doc.y + 16;

  // Optional fund position summary.
  if (data.fundSummary?.length) {
    if (y > BOTTOM_LIMIT - 60) {
      doc.addPage();
      y = page.margin;
    }
    doc
      .fillColor(color.ink)
      .font(fonts.face(font.sansBold))
      .fontSize(11)
      .text("Fund position", page.margin, y);
    y = doc.y + 8;
    doc
      .moveTo(page.margin, y)
      .lineTo(page.margin + contentWidth, y)
      .lineWidth(1)
      .stroke(color.ink);
    y += 8;
    for (const f of data.fundSummary) {
      doc
        .fillColor(color.ink)
        .font(fonts.face(font.sansSemibold))
        .fontSize(9.5)
        .text(f.name, page.margin, y, { width: contentWidth - 120 });
      doc
        .fillColor(color.ink)
        .font(fonts.face(font.mono))
        .fontSize(9.5)
        .text(money(f.balanceCents), page.margin + contentWidth - 120, y, {
          width: 120,
          align: "right",
        });
      y = doc.y + 7;
      doc
        .moveTo(page.margin, y - 3)
        .lineTo(page.margin + contentWidth, y - 3)
        .lineWidth(0.4)
        .stroke(color.line);
    }
  }

  drawFooters(doc, fonts);
  doc.end();
  return done;
}

function entryLabel(e: StatementEntry): string {
  const base = KIND_LABELS[e.kind] ?? e.kind;
  if (e.description && e.description !== base) return `${base} — ${e.description}`;
  if (e.reference) return `${base} (${e.reference})`;
  return base;
}

/** dd/mm/yyyy for tight ledger columns. */
function formatDateShort(value: string): string {
  const p = value.slice(0, 10).split("-");
  if (p.length !== 3) return value;
  return `${p[2]}/${p[1]}/${p[0]}`;
}
