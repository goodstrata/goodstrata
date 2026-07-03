import PDFDocument from "pdfkit";
import { drawGoodStrataLockup } from "./brand.js";
import { type FontSet, registerFonts } from "./fonts.js";
import {
  AUDIT_LINE,
  color,
  contentWidth,
  font,
  formatDate,
  LEGAL_ACN,
  LEGAL_DOMAIN,
  LEGAL_ISSUER,
  money,
  page,
} from "./theme.js";
import type { SchemeParty } from "./types.js";

type Doc = typeof PDFDocument.prototype;

export interface BrandedDoc {
  doc: Doc;
  fonts: FontSet;
  /** Resolves to the finished PDF once doc.end() is called. */
  done: Promise<Buffer>;
}

export interface DocMeta {
  title: string; // PDF metadata title
  subject?: string;
}

/** Create an A4 document with branded fonts registered and buffered pages. */
export function createBrandedDoc(meta: DocMeta): BrandedDoc {
  const doc = new PDFDocument({
    size: "A4",
    margin: page.margin,
    bufferPages: true,
    info: {
      Title: meta.title,
      Author: `${LEGAL_ISSUER} (${LEGAL_ACN})`,
      Creator: "GoodStrata — The Registry",
      Subject: meta.subject ?? meta.title,
    },
  });
  const fonts = registerFonts(doc);

  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  return { doc, fonts, done };
}

const addr = (s: SchemeParty): string =>
  [s.addressLine1, s.addressLine2, [s.suburb, s.state, s.postcode].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");

/**
 * Masthead: the owners corporation is the issuer (left), the GoodStrata lockup
 * sits top-right ("Managed via GoodStrata"), then the document title band.
 * Returns the y cursor below the masthead.
 */
export function drawMasthead(doc: Doc, fonts: FontSet, scheme: SchemeParty, title: string): number {
  const x = page.margin;
  const top = page.margin;

  // Eucalypt rule across the top edge.
  doc.rect(0, 0, page.width, 5).fill(color.primary);

  // GoodStrata lockup, top-right.
  drawGoodStrataLockup(doc, fonts, {
    x: page.width - page.margin,
    y: top,
    markHeight: 20,
    caption: "Managed via GoodStrata",
    align: "right",
  });

  // Issuer (owners corporation), left.
  doc
    .fillColor(color.ink)
    .font(fonts.face(font.sansBold))
    .fontSize(17)
    .text(scheme.name, x, top - 1, { width: contentWidth * 0.62 });

  let y = doc.y + 2;
  const sub = `Plan of Subdivision ${scheme.planOfSubdivision}`;
  doc.fillColor(color.mutedInk).font(fonts.face(font.sans)).fontSize(9);
  doc.text(sub, x, y, { width: contentWidth * 0.62 });
  y = doc.y;
  const addressLine = addr(scheme);
  if (addressLine) {
    doc.text(addressLine, x, y, { width: contentWidth * 0.62 });
    y = doc.y;
  }
  if (scheme.abn) {
    doc.text(`ABN ${scheme.abn}`, x, y, { width: contentWidth * 0.62 });
    y = doc.y;
  }

  y = Math.max(y, top + 46) + 14;

  // Hairline + document title band.
  doc
    .moveTo(x, y)
    .lineTo(page.width - page.margin, y)
    .lineWidth(0.75)
    .stroke(color.line);
  y += 14;
  doc.fillColor(color.primaryStrong).font(fonts.face(font.sansBold)).fontSize(20).text(title, x, y);
  y = doc.y + 10;
  return y;
}

/** A labelled block of stacked lines (e.g. "Bill to"). Returns bottom y. */
export function drawParty(
  doc: Doc,
  fonts: FontSet,
  label: string,
  lines: (string | null | undefined)[],
  x: number,
  y: number,
  width: number,
): number {
  doc
    .fillColor(color.mutedInk)
    .font(fonts.face(font.sansSemibold))
    .fontSize(8.5)
    .text(label, x, y, { width });
  let cy = doc.y + 3;
  doc.font(fonts.face(font.sans)).fontSize(10).fillColor(color.ink);
  const clean = lines.filter((l): l is string => Boolean(l && l.trim()));
  for (const [i, line] of clean.entries()) {
    doc
      .font(fonts.face(i === 0 ? font.sansSemibold : font.sans))
      .fillColor(i === 0 ? color.ink : color.mutedInk)
      .text(line, x, cy, { width });
    cy = doc.y + 1;
  }
  return cy;
}

/** A right-hand grid of label/value pairs (meta such as notice no. / due date). */
export function drawMetaGrid(
  doc: Doc,
  fonts: FontSet,
  rows: { label: string; value: string; strong?: boolean; mono?: boolean }[],
  x: number,
  y: number,
  width: number,
): number {
  const labelW = width * 0.48;
  const valueX = x + labelW;
  const valueW = width - labelW;
  let cy = y;
  for (const r of rows) {
    doc
      .fillColor(color.mutedInk)
      .font(fonts.face(font.sans))
      .fontSize(9)
      .text(r.label, x, cy, { width: labelW - 8 });
    const labelBottom = doc.y;
    doc
      .fillColor(r.strong ? color.primaryStrong : color.ink)
      .font(fonts.face(r.mono ? font.monoMedium : r.strong ? font.sansBold : font.sansSemibold))
      .fontSize(r.strong ? 10.5 : 9.5)
      .text(r.value, valueX, cy, { width: valueW, align: "right" });
    cy = Math.max(labelBottom, doc.y) + 6;
  }
  return cy;
}

export interface TableRow {
  label: string;
  sub?: string | null;
  amountCents: number;
  strong?: boolean;
  muted?: boolean;
}

/**
 * Itemised money table: description left, amount right-aligned in mono. Header
 * hairline, per-row separators, no zebra (clean registry look).
 */
export function drawMoneyTable(
  doc: Doc,
  fonts: FontSet,
  rows: TableRow[],
  opts: {
    x: number;
    y: number;
    width: number;
    header?: [string, string];
    total?: { label: string; amountCents: number };
  },
): number {
  const { x, width } = opts;
  const amountW = 120;
  const amountX = x + width - amountW;
  const descW = width - amountW - 12;
  let y = opts.y;

  if (opts.header) {
    doc
      .fillColor(color.mutedInk)
      .font(fonts.face(font.sansSemibold))
      .fontSize(8.5)
      .text(opts.header[0], x, y, { width: descW });
    doc.text(opts.header[1], amountX, y, { width: amountW, align: "right" });
    y = doc.y + 6;
  }
  doc
    .moveTo(x, y)
    .lineTo(x + width, y)
    .lineWidth(1)
    .stroke(color.ink);
  y += 9;

  for (const row of rows) {
    const labelColor = row.muted ? color.mutedInk : color.ink;
    doc
      .fillColor(labelColor)
      .font(fonts.face(font.sansSemibold))
      .fontSize(10)
      .text(row.label, x, y, { width: descW });
    let descBottom = doc.y;
    if (row.sub) {
      doc
        .fillColor(color.mutedInk)
        .font(fonts.face(font.sans))
        .fontSize(8.5)
        .text(row.sub, x, descBottom + 1, { width: descW });
      descBottom = doc.y;
    }
    doc
      .fillColor(labelColor)
      .font(fonts.face(font.mono))
      .fontSize(10)
      .text(money(row.amountCents), amountX, y, { width: amountW, align: "right" });
    y = Math.max(descBottom, doc.y) + 8;
    doc
      .moveTo(x, y - 2)
      .lineTo(x + width, y - 2)
      .lineWidth(0.5)
      .stroke(color.line);
  }

  if (opts.total) {
    y += 4;
    doc.rect(amountX - 12, y - 4, amountW + 12, 30).fill(color.accent);
    doc
      .fillColor(color.accentInk)
      .font(fonts.face(font.sansBold))
      .fontSize(10.5)
      .text(opts.total.label, x, y + 4, { width: descW });
    doc
      .fillColor(color.primaryStrong)
      .font(fonts.face(font.monoMedium))
      .fontSize(13)
      .text(money(opts.total.amountCents), amountX, y + 2, { width: amountW - 8, align: "right" });
    y += 30;
  }
  return y;
}

/**
 * The payment panel — the "how to pay" block: PayID + trust BSB/account and the
 * unique per-notice reference. Rendered as a bordered eucalypt-tinted card.
 */
export function drawPaymentPanel(
  doc: Doc,
  fonts: FontSet,
  rails: {
    reference: string | null;
    bsb?: string | null;
    accountNumber?: string | null;
    payid?: string | null;
    accountName?: string | null;
  },
  opts: { x: number; y: number; width: number; amountCents: number; dueOn: string },
): number {
  const { x, width } = opts;
  const pad = 14;
  const startY = opts.y;

  // Measure content height first by laying out rows into a list.
  const rows: { k: string; v: string; mono?: boolean }[] = [];
  if (rails.payid) rows.push({ k: "PayID", v: rails.payid, mono: true });
  if (rails.bsb) rows.push({ k: "BSB", v: rails.bsb, mono: true });
  if (rails.accountNumber) rows.push({ k: "Account number", v: rails.accountNumber, mono: true });
  if (rails.accountName) rows.push({ k: "Account name", v: rails.accountName });
  rows.push({ k: "Payment reference", v: rails.reference ?? "—", mono: true });

  const headerH = 40;
  const rowH = 17;
  const panelH = pad + headerH + rows.length * rowH + pad - 6;

  doc.roundedRect(x, startY, width, panelH, 8).fill(color.accent);
  doc.roundedRect(x, startY, width, panelH, 8).lineWidth(1).stroke(color.primary);
  // Header strip.
  doc
    .fillColor(color.primaryStrong)
    .font(fonts.face(font.sansBold))
    .fontSize(11)
    .text("How to pay", x + pad, startY + pad);
  doc
    .fillColor(color.accentInk)
    .font(fonts.face(font.sans))
    .fontSize(8.5)
    .text(
      `Pay ${money(opts.amountCents)} by ${formatDate(opts.dueOn)}. Always quote the payment reference.`,
      x + pad,
      doc.y + 1,
      { width: width - pad * 2 },
    );

  let cy = startY + pad + headerH;
  const keyX = x + pad;
  const valX = x + width * 0.42;
  for (const r of rows) {
    doc
      .fillColor(color.mutedInk)
      .font(fonts.face(font.sans))
      .fontSize(9)
      .text(r.k, keyX, cy, { width: width * 0.42 - pad });
    doc
      .fillColor(color.ink)
      .font(fonts.face(r.mono ? font.monoMedium : font.sansSemibold))
      .fontSize(r.mono ? 10 : 9.5)
      .text(r.v, valX, cy, { width: x + width - pad - valX, align: "left" });
    cy += rowH;
  }
  return startY + panelH;
}

/** Footer on every page: legal issuer, audit line, page numbers. Call last. */
export function drawFooters(doc: Doc, fonts: FontSet): void {
  const range = doc.bufferedPageRange();
  const y = page.height - page.margin + 6;
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Footer sits inside the bottom margin band; drop the margin so writing
    // there does not trip pdfkit's auto-pagination (which would add blanks).
    doc.page.margins.bottom = 0;
    doc
      .moveTo(page.margin, y - 8)
      .lineTo(page.width - page.margin, y - 8)
      .lineWidth(0.5)
      .stroke(color.line);
    doc
      .fillColor(color.mutedInk)
      .font(fonts.face(font.sans))
      .fontSize(7.5)
      .text(`${LEGAL_ISSUER} · ${LEGAL_ACN} · ${LEGAL_DOMAIN}`, page.margin, y, {
        width: contentWidth * 0.72,
        lineBreak: false,
      });
    doc
      .fillColor(color.mutedInk)
      .fontSize(7)
      .text(AUDIT_LINE, page.margin, y + 9, { width: contentWidth * 0.72, lineBreak: false });
    doc
      .fillColor(color.mutedInk)
      .font(fonts.face(font.mono))
      .fontSize(7.5)
      .text(`Page ${i - range.start + 1} of ${range.count}`, page.width - page.margin - 120, y, {
        width: 120,
        align: "right",
        lineBreak: false,
      });
  }
}

export { color, contentWidth, font, formatDate, money, page };
