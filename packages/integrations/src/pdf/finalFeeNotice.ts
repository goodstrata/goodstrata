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
  page,
} from "./render.js";
import type { FinalFeeNoticeDoc } from "./types.js";

/** Statutory final fee notice: immediate debt plus the 28-day legal-action warning. */
export function buildFinalFeeNoticePdf(data: FinalFeeNoticeDoc): Promise<Buffer> {
  const { doc, fonts, done } = createBrandedDoc({
    title: `Final Fee Notice ${data.notice.noticeNumber}`,
    subject: `Final fee notice for lot ${data.lot.lotNumber}, ${data.scheme.name}`,
  });
  let y = drawMasthead(doc, fonts, data.scheme, "Final Fee Notice");
  const gap = 24;
  const colW = (contentWidth - gap) / 2;
  const rightX = page.margin + colW + gap;
  const partyBottom = drawParty(
    doc,
    fonts,
    "To",
    [data.billTo.name, ...(data.billTo.addressLines ?? []), `Lot ${data.lot.lotNumber}`],
    page.margin,
    y,
    colW,
  );
  const metaBottom = drawMetaGrid(
    doc,
    fonts,
    [
      { label: "Final notice", value: data.notice.noticeNumber, mono: true },
      { label: "Original fee notice", value: data.notice.sourceNoticeNumber, mono: true },
      { label: "Date issued", value: formatDate(data.notice.issuedAt) },
    ],
    rightX,
    y,
    colW,
  );
  y = Math.max(partyBottom, metaBottom) + 20;
  y = drawMoneyTable(
    doc,
    fonts,
    [
      { label: "Overdue fees and charges", amountCents: data.notice.principalCents },
      { label: "Penalty interest to date", amountCents: data.notice.interestCents },
    ],
    {
      x: page.margin,
      y,
      width: contentWidth,
      header: ["Amount payable immediately", "Amount (AUD)"],
      total: {
        label: "Total now payable",
        amountCents: data.notice.principalCents + data.notice.interestCents,
      },
    },
  );
  y += 15;
  doc
    .fillColor(color.ink)
    .font(fonts.face(font.sansSemibold))
    .fontSize(9)
    .text(
      `Penalty interest is ${String(data.notice.interestRateBps / 100)}% per annum and will accrue at approximately $${(data.notice.dailyInterestCents / 100).toFixed(2)} per day until the overdue fees and charges are paid.`,
      page.margin,
      y,
      { width: contentWidth },
    );
  y = doc.y + 12;
  doc
    .fillColor("#9c2d2d")
    .font(fonts.face(font.sansBold))
    .fontSize(10)
    .text(
      `The owners corporation intends to take legal action to recover the amount due if payment in full is not received within 28 days of this final notice (from ${formatDate(data.notice.recoveryEligibleOn)}).`,
      page.margin,
      y,
      { width: contentWidth },
    );
  y = doc.y + 12;
  doc
    .fillColor(color.mutedInk)
    .font(fonts.face(font.sans))
    .fontSize(8.5)
    .text(data.disputeProcess, page.margin, y, { width: contentWidth });
  y = doc.y + 18;
  drawPaymentPanel(doc, fonts, data.payment, {
    x: page.margin,
    y,
    width: contentWidth,
    amountCents: data.notice.principalCents + data.notice.interestCents,
    dueOn:
      data.notice.issuedAt instanceof Date
        ? data.notice.issuedAt.toISOString().slice(0, 10)
        : String(data.notice.issuedAt).slice(0, 10),
  });
  drawFooters(doc, fonts);
  doc.end();
  return done;
}
