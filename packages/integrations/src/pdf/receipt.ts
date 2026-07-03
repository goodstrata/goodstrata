import {
  color,
  contentWidth,
  createBrandedDoc,
  drawFooters,
  drawMasthead,
  drawMetaGrid,
  drawMoneyTable,
  drawParty,
  font,
  formatDate,
  money,
  page,
  type TableRow,
} from "./render.js";
import { fundLabel } from "./theme.js";
import type { ReceiptDoc } from "./types.js";

const METHOD_LABELS: Record<string, string> = {
  monoova: "Bank transfer (PayID / NPP)",
  mock: "Bank transfer",
  manual: "Manual / office payment",
};

/**
 * PAYMENT RECEIPT for a reconciled payment: amount, date, method, the split
 * across funds, and the lot's running balance afterward.
 */
export function buildReceiptPdf(data: ReceiptDoc): Promise<Buffer> {
  const { doc, fonts, done } = createBrandedDoc({
    title: `Receipt ${data.receipt.receiptNumber}`,
    subject: `Payment receipt for lot ${data.lot.lotNumber}, ${data.scheme.name}`,
  });

  let y = drawMasthead(doc, fonts, data.scheme, "Payment Receipt");

  const colGap = 24;
  const colW = (contentWidth - colGap) / 2;
  const leftX = page.margin;
  const rightX = page.margin + colW + colGap;

  const partyBottom = drawParty(
    doc,
    fonts,
    "Received from",
    [
      data.billTo.name,
      data.payment.payerName && data.payment.payerName !== data.billTo.name
        ? `Paid by ${data.payment.payerName}`
        : null,
      `Lot ${data.lot.lotNumber}`,
    ],
    leftX,
    y,
    colW,
  );

  const metaRows = [
    { label: "Receipt number", value: data.receipt.receiptNumber, mono: true },
    { label: "Date received", value: formatDate(data.payment.paidAt) },
    { label: "Method", value: METHOD_LABELS[data.payment.method] ?? data.payment.method },
  ];
  if (data.payment.providerRef) {
    metaRows.push({ label: "Provider reference", value: data.payment.providerRef, mono: true });
  }
  const metaBottom = drawMetaGrid(doc, fonts, metaRows, rightX, y, colW);

  y = Math.max(partyBottom, metaBottom) + 16;

  // Amount received banner.
  doc.roundedRect(page.margin, y, contentWidth, 44, 8).fill(color.primary);
  doc
    .fillColor(color.white)
    .font(fonts.face(font.sans))
    .fontSize(9)
    .text("Amount received", page.margin + 16, y + 10);
  doc
    .fillColor(color.white)
    .font(fonts.face(font.monoMedium))
    .fontSize(20)
    .text(money(data.payment.amountCents), page.margin + 16, y + 20, {
      width: contentWidth - 32,
      lineBreak: false,
    });
  const paidLabel = "PAID";
  doc
    .font(fonts.face(font.sansBold))
    .fontSize(13)
    .text(paidLabel, page.margin, y + 15, { width: contentWidth - 18, align: "right" });
  y += 44 + 22;

  // Applied to which notice(s).
  if (data.appliedTo.length) {
    const rows: TableRow[] = data.appliedTo.map((a) => ({
      label: `Levy notice ${a.noticeNumber}`,
      amountCents: a.amountCents,
    }));
    y = drawMoneyTable(doc, fonts, rows, {
      x: page.margin,
      y,
      width: contentWidth,
      header: ["Applied to", "Amount (AUD)"],
    });
    y += 16;
  }

  // Fund allocation.
  if (data.allocations.length) {
    const rows: TableRow[] = data.allocations.map((a) => ({
      label: fundLabel(a.fundKind),
      sub: a.description !== fundLabel(a.fundKind) ? a.description : null,
      amountCents: a.amountCents,
    }));
    y = drawMoneyTable(doc, fonts, rows, {
      x: page.margin,
      y,
      width: contentWidth,
      header: ["Allocated across funds", "Amount (AUD)"],
      total: { label: "Total allocated", amountCents: data.payment.amountCents },
    });
    y += 20;
  }

  // Running lot balance.
  const owing = data.runningBalanceCents;
  doc.roundedRect(page.margin, y, contentWidth, 40, 8).lineWidth(1).stroke(color.line);
  doc
    .fillColor(color.mutedInk)
    .font(fonts.face(font.sansSemibold))
    .fontSize(10)
    .text("Lot balance after this payment", page.margin + 16, y + 14);
  doc
    .fillColor(owing > 0 ? color.ink : color.primaryStrong)
    .font(fonts.face(font.monoMedium))
    .fontSize(13)
    .text(
      owing > 0
        ? `${money(owing)} owing`
        : owing < 0
          ? `${money(-owing)} in credit`
          : "$0.00 — paid in full",
      page.margin,
      y + 13,
      { width: contentWidth - 16, align: "right" },
    );

  drawFooters(doc, fonts);
  doc.end();
  return done;
}
