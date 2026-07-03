import type PDFDocument from "pdfkit";
import type { FontSet } from "./fonts.js";
import { color, font } from "./theme.js";

type Doc = typeof PDFDocument.prototype;

/**
 * The GoodStrata mark — three stacked isometric diamond frames, lifted verbatim
 * from site/logo-on-light.svg (the clip-outline geometry). Each path is an
 * inner+outer diamond filled even-odd to yield a frame. Drawn as vectors so the
 * masthead stays crisp and light (no embedded raster).
 *
 * Native art box: 272.19 (w) × 260.32 (h) in the source viewBox.
 */
const MARK_ART_HEIGHT = 260.32;
const MARK_ART_WIDTH = 272.19;
const MARK_PATHS = [
  // Top layer
  "M15.53,78.43l120.98,69.5,120.15-69.48L135.68,8.95,15.53,78.43ZM136.52,156.88L0,78.45,135.67,0l136.52,78.43-135.67,78.45Z",
  // Middle layer
  "M15.53,130.15l120.98,69.5,120.15-69.48-120.97-69.5L15.53,130.15ZM136.52,208.6L0,130.17,135.67,51.72l136.52,78.43-135.67,78.45Z",
  // Bottom layer
  "M15.53,181.87l120.98,69.5,120.15-69.48-120.97-69.5L15.53,181.87ZM136.52,260.32L0,181.89l135.67-78.45,136.52,78.43-135.67,78.45Z",
] as const;

/** Draw the mark with its top-left at (x, y), scaled to `height` points. */
export function drawLogoMark(
  doc: Doc,
  x: number,
  y: number,
  height: number,
  fill: string = color.primary,
): number {
  const scale = height / MARK_ART_HEIGHT;
  doc.save();
  doc.translate(x, y).scale(scale);
  for (const d of MARK_PATHS) {
    doc.path(d).fill(fill, "even-odd");
  }
  doc.restore();
  return MARK_ART_WIDTH * scale; // rendered width
}

/**
 * The full GoodStrata lockup: mark + "GoodStrata" wordmark (Public Sans bold) +
 * an optional caption. Right-aligned lockups pass align:"right" and an x that is
 * the RIGHT edge. Returns the block's bounding height.
 */
export function drawGoodStrataLockup(
  doc: Doc,
  fonts: FontSet,
  opts: {
    x: number;
    y: number;
    markHeight?: number;
    caption?: string;
    align?: "left" | "right";
    onDark?: boolean;
  },
): { width: number; height: number } {
  const markHeight = opts.markHeight ?? 22;
  const wordSize = markHeight * 0.86;
  const gap = markHeight * 0.42;
  const inkColor = opts.onDark ? color.white : color.ink;
  const markColor = opts.onDark ? color.white : color.primary;

  doc.font(fonts.face(font.sansBold)).fontSize(wordSize);
  const wordText = "GoodStrata";
  const wordWidth = doc.widthOfString(wordText);
  const markWidthAt = MARK_ART_WIDTH * (markHeight / MARK_ART_HEIGHT);
  const totalWidth = markWidthAt + gap + wordWidth;

  const left = opts.align === "right" ? opts.x - totalWidth : opts.x;

  drawLogoMark(doc, left, opts.y, markHeight, markColor);
  // Optically centre the wordmark against the mark's cap height.
  const wordY = opts.y + (markHeight - wordSize) / 2 + wordSize * 0.06;
  doc
    .fillColor(inkColor)
    .font(fonts.face(font.sansBold))
    .fontSize(wordSize)
    .text(wordText, left + markWidthAt + gap, wordY, { lineBreak: false });

  let height = markHeight;
  if (opts.caption) {
    const capSize = markHeight * 0.4;
    const capY = opts.y + markHeight + 4;
    doc
      .fillColor(opts.onDark ? color.line : color.mutedInk)
      .font(fonts.face(font.sans))
      .fontSize(capSize)
      .text(opts.caption, left, capY, {
        width: totalWidth,
        align: opts.align ?? "left",
        lineBreak: false,
      });
    height = markHeight + 4 + capSize;
  }
  return { width: totalWidth, height };
}
