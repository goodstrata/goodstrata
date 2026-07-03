import {
  color,
  contentWidth,
  createBrandedDoc,
  drawFooters,
  drawMasthead,
  drawMetaGrid,
  drawMoneyTable,
  drawParty,
  drawPaymentPanel,
  font,
  formatDate,
  money,
  page,
  type TableRow,
} from "./render.js";
import { fundLabel, gstOf } from "./theme.js";
import type { LevyNoticeDoc } from "./types.js";

/**
 * LEVY NOTICE / TAX INVOICE. The owners corporation is the issuer; the lot owner
 * is billed. Itemised by fund, with the trust-account payment panel and, for a
 * GST-registered scheme, a GST line.
 */
export function buildLevyNoticePdf(data: LevyNoticeDoc): Promise<Buffer> {
  const isTaxInvoice = Boolean(data.scheme.gstRegistered);
  const title = isTaxInvoice ? "Tax Invoice — Levy Notice" : "Levy Notice";
  const { doc, fonts, done } = createBrandedDoc({
    title: `${title} ${data.notice.noticeNumber}`,
    subject: `Levy notice for lot ${data.lot.lotNumber}, ${data.scheme.name}`,
  });

  let y = drawMasthead(doc, fonts, data.scheme, title);

  // Two columns: bill-to (left), notice meta (right).
  const colGap = 24;
  const colW = (contentWidth - colGap) / 2;
  const leftX = page.margin;
  const rightX = page.margin + colW + colGap;

  const lotDesc = [
    `Lot ${data.lot.lotNumber}`,
    data.lot.unitNumber ? `Unit ${data.lot.unitNumber}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const partyBottom = drawParty(
    doc,
    fonts,
    "Bill to",
    [
      data.billTo.name,
      data.billTo.companyName,
      ...(data.billTo.addressLines ?? []),
      lotDesc,
      data.lot.streetAddress,
    ],
    leftX,
    y,
    colW,
  );

  const metaRows = [
    { label: "Notice number", value: data.notice.noticeNumber, mono: true },
    { label: "Date issued", value: formatDate(data.notice.issuedAt ?? new Date()) },
    { label: "Due date", value: formatDate(data.notice.dueOn), strong: true },
  ];
  if (data.notice.instalment) {
    metaRows.splice(1, 0, {
      label: "Instalment",
      value: data.notice.frequencyLabel
        ? `${data.notice.instalment} · ${data.notice.frequencyLabel}`
        : String(data.notice.instalment),
    });
  }
  const metaBottom = drawMetaGrid(doc, fonts, metaRows, rightX, y, colW);

  y = Math.max(partyBottom, metaBottom) + 22;

  // Itemised charges.
  const rows: TableRow[] = data.lines.map((l) => ({
    label: fundLabel(l.fundKind),
    sub: l.description !== fundLabel(l.fundKind) ? l.description : null,
    amountCents: l.amountCents,
  }));
  const linesTotal = data.lines.reduce((a, l) => a + l.amountCents, 0);
  const total = data.notice.totalCents || linesTotal;

  y = drawMoneyTable(doc, fonts, rows, {
    x: page.margin,
    y,
    width: contentWidth,
    header: ["Description", "Amount (AUD)"],
    total: { label: "Total amount due", amountCents: total },
  });

  if (isTaxInvoice) {
    y += 6;
    doc
      .fillColor(color.mutedInk)
      .font(fonts.face(font.sans))
      .fontSize(8.5)
      .text(
        `Total includes GST of ${money(gstOf(total))}. ${data.scheme.abn ? `ABN ${data.scheme.abn}.` : ""} This document is a tax invoice.`,
        page.margin,
        y,
        { width: contentWidth },
      );
    y = doc.y;
  }

  // Arrears / interest notes.
  const notes: string[] = [];
  if (data.priorBalanceCents && data.priorBalanceCents > 0) {
    notes.push(
      `A prior balance of ${money(data.priorBalanceCents)} was outstanding when this notice issued and is payable in addition to the amount above.`,
    );
  }
  if (data.interestNote) notes.push(data.interestNote);
  if (notes.length) {
    y += 10;
    for (const n of notes) {
      doc
        .fillColor(color.mutedInk)
        .font(fonts.face(font.sans))
        .fontSize(8.5)
        .text(`• ${n}`, page.margin, y, { width: contentWidth });
      y = doc.y + 2;
    }
  }

  y += 18;
  drawPaymentPanel(doc, fonts, data.payment, {
    x: page.margin,
    y,
    width: contentWidth,
    amountCents: total,
    dueOn: data.notice.dueOn,
  });

  // Statutory note.
  const noteY = page.height - page.margin - 40;
  doc
    .fillColor(color.mutedInk)
    .font(fonts.face(font.sans))
    .fontSize(7.5)
    .text(
      "Payment is due at least 28 days after the date of this notice (Owners Corporations Act 2006 (Vic)). Interest may accrue on amounts unpaid after the due date.",
      page.margin,
      noteY,
      { width: contentWidth },
    );

  drawFooters(doc, fonts);
  doc.end();
  return done;
}
