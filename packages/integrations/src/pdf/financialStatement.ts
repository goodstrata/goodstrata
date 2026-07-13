import {
  color,
  contentWidth,
  createBrandedDoc,
  drawFooters,
  drawMasthead,
  drawMoneyTable,
  font,
  page,
} from "./render.js";
import type { FinancialStatementDoc } from "./types.js";

export function buildFinancialStatementPdf(data: FinancialStatementDoc): Promise<Buffer> {
  const { doc, fonts, done } = createBrandedDoc({
    title: `Annual Financial Statements ${data.statement.periodEnd}`,
    subject: `Annual financial statements for ${data.scheme.name}`,
  });
  let y = drawMasthead(doc, fonts, data.scheme, "Annual Financial Statements");
  doc
    .fillColor(color.mutedInk)
    .font(fonts.face(font.sans))
    .fontSize(9)
    .text(
      `For the period ${data.statement.periodStart} to ${data.statement.periodEnd} · ${data.statement.accountingBasis.replaceAll("_", " ")}`,
      page.margin,
      y,
      { width: contentWidth },
    );
  y = doc.y + 18;
  y = drawMoneyTable(
    doc,
    fonts,
    [
      { label: "Income", amountCents: data.statement.incomeCents },
      { label: "Expenditure", amountCents: -data.statement.expenditureCents },
      { label: "Penalty interest charged", amountCents: data.statement.penaltyInterestCents },
    ],
    { x: page.margin, y, width: contentWidth, header: ["Income and expenditure", "AUD"] },
  );
  y += 24;
  drawMoneyTable(
    doc,
    fonts,
    [
      { label: "Cash and fund balances", amountCents: data.statement.cashCents },
      { label: "Fee receivables", amountCents: data.statement.receivablesCents },
      { label: "Liabilities", amountCents: -data.statement.liabilitiesCents },
    ],
    {
      x: page.margin,
      y,
      width: contentWidth,
      header: ["Assets and liabilities", "AUD"],
      total: { label: "Net assets", amountCents: data.statement.netAssetsCents },
    },
  );
  doc
    .fillColor(color.mutedInk)
    .font(fonts.face(font.sans))
    .fontSize(7.5)
    .text(
      "Prepared from GoodStrata's append-only ledgers. Tier-required independent audit or review evidence is recorded separately and must accompany these statements at the AGM.",
      page.margin,
      page.height - page.margin - 42,
      { width: contentWidth },
    );
  drawFooters(doc, fonts);
  doc.end();
  return done;
}
