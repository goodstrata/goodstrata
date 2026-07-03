import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type PDFDocument from "pdfkit";
import { font } from "./theme.js";

const FONTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "assets", "fonts");

/** Logical family name → TTF filename. */
const FONT_FILES: Record<string, string> = {
  [font.sans]: "PublicSans-Regular.ttf",
  [font.sansSemibold]: "PublicSans-SemiBold.ttf",
  [font.sansBold]: "PublicSans-Bold.ttf",
  [font.mono]: "IBMPlexMono-Regular.ttf",
  [font.monoMedium]: "IBMPlexMono-Medium.ttf",
};

/** Built-in PDF base-14 fallbacks, used only if a TTF cannot be loaded. */
const FALLBACK: Record<string, string> = {
  [font.sans]: "Helvetica",
  [font.sansSemibold]: "Helvetica-Bold",
  [font.sansBold]: "Helvetica-Bold",
  [font.mono]: "Courier",
  [font.monoMedium]: "Courier-Bold",
};

let cache: Map<string, Buffer> | null = null;

/** Load and cache the embedded TTFs once. Missing files degrade to fallbacks. */
function loadBuffers(): Map<string, Buffer> {
  if (cache) return cache;
  const map = new Map<string, Buffer>();
  for (const [name, file] of Object.entries(FONT_FILES)) {
    try {
      map.set(name, readFileSync(join(FONTS_DIR, file)));
    } catch {
      // Left unset → resolveFont() falls back to a base-14 face.
    }
  }
  cache = map;
  return map;
}

export interface FontSet {
  /** Resolve a logical family to whatever face is actually registered. */
  face(name: string): string;
  /** True when every branded TTF embedded (no Helvetica fallback in play). */
  branded: boolean;
}

/**
 * Register the branded faces on a document, returning a resolver that maps
 * logical names to registered faces (or a base-14 fallback). Register once per
 * document before any drawing.
 */
export function registerFonts(doc: typeof PDFDocument.prototype): FontSet {
  const buffers = loadBuffers();
  let branded = true;
  for (const name of Object.keys(FONT_FILES)) {
    const buf = buffers.get(name);
    if (buf) {
      doc.registerFont(name, buf);
    } else {
      branded = false;
    }
  }
  return {
    face: (name) => (buffers.has(name) ? name : (FALLBACK[name] ?? "Helvetica")),
    branded,
  };
}
