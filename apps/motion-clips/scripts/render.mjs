// Build-time render of the GoodStrata explainer clips (C1–C5) to mp4 (H.264) +
// webm (VP9) + poster JPG each. Uses @remotion/renderer programmatically.
// Chromium: prefers Remotion's own headless shell (ensureBrowser); falls back to
// the Playwright chrome-headless-shell in the local cache, or $REMOTION_CHROME.
//
// Render one clip by id:  node scripts/render.mjs C3-one-laptop
// Render all clips:       node scripts/render.mjs
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import {
  ensureBrowser,
  renderMedia,
  renderStill,
  selectComposition,
} from "@remotion/renderer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "out");

// The clips to render, with a poster frame picked on each clip's payoff beat.
const CLIPS = [
  { id: "C1-the-number", base: "c1-the-number", poster: 800 },
  { id: "C2-money-is-code", base: "c2-money-is-code", poster: 470 },
  { id: "C3-one-laptop", base: "c3-one-laptop", poster: 520 },
  { id: "C4-schedule-b", base: "c4-schedule-b", poster: 470 },
  { id: "C5-handbook", base: "c5-handbook", poster: 605 },
];

// Locate a usable Chromium. Try a few known Playwright cache locations.
function findPlaywrightChrome() {
  if (process.env.REMOTION_CHROME && existsSync(process.env.REMOTION_CHROME)) {
    return process.env.REMOTION_CHROME;
  }
  const base = path.join(homedir(), "Library/Caches/ms-playwright");
  const candidates = [
    "chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell",
    "chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell",
    "chromium_headless_shell-1217/chrome-headless-shell-mac-arm64/chrome-headless-shell",
  ];
  for (const c of candidates) {
    const p = path.join(base, c);
    if (existsSync(p)) return p;
  }
  return null;
}

async function main() {
  await mkdir(outDir, { recursive: true });

  // Resolve a browser. Prefer Remotion-managed; else Playwright's shell.
  let browserExecutable = null;
  try {
    await ensureBrowser();
    console.log("[render] using Remotion-managed Chrome headless shell");
  } catch (err) {
    browserExecutable = findPlaywrightChrome();
    if (!browserExecutable) {
      throw new Error(
        `ensureBrowser() failed (${err?.message ?? err}) and no Playwright chrome-headless-shell found. Set REMOTION_CHROME to a Chromium binary.`,
      );
    }
    console.log(`[render] using Playwright chrome at ${browserExecutable}`);
  }

  console.log("[render] bundling…");
  const serveUrl = await bundle({
    entryPoint: path.join(root, "src/index.ts"),
    onProgress: (p) => {
      if (p % 25 === 0) console.log(`  bundle ${p}%`);
    },
  });

  // Render one clip by id (CLI arg) or all of them.
  const only = process.argv[2];
  const targets = only ? CLIPS.filter((c) => c.id === only) : CLIPS;
  if (targets.length === 0) {
    throw new Error(
      `No clip matches "${only}". Known ids: ${CLIPS.map((c) => c.id).join(", ")}`,
    );
  }

  for (const clip of targets) {
    console.log(`\n[render] ===== ${clip.id} =====`);
    const composition = await selectComposition({
      serveUrl,
      id: clip.id,
      browserExecutable: browserExecutable ?? undefined,
    });
    console.log(
      `[render] composition ${composition.width}x${composition.height} ${composition.durationInFrames}f @ ${composition.fps}fps`,
    );

    const common = {
      serveUrl,
      composition,
      browserExecutable: browserExecutable ?? undefined,
      chromiumOptions: { gl: "angle" },
    };

    // 1) H.264 mp4
    const mp4 = path.join(outDir, `${clip.base}.mp4`);
    console.log("[render] mp4 (H.264)…");
    await renderMedia({
      ...common,
      codec: "h264",
      outputLocation: mp4,
      crf: 18,
      onProgress: ({ progress }) => {
        const pct = Math.round(progress * 100);
        if (pct % 10 === 0) process.stdout.write(`  mp4 ${pct}%\r`);
      },
    });
    console.log("\n[render] mp4 done");

    // 2) VP9 webm
    const webm = path.join(outDir, `${clip.base}.webm`);
    console.log("[render] webm (VP9)…");
    await renderMedia({
      ...common,
      codec: "vp9",
      outputLocation: webm,
      onProgress: ({ progress }) => {
        const pct = Math.round(progress * 100);
        if (pct % 10 === 0) process.stdout.write(`  webm ${pct}%\r`);
      },
    });
    console.log("\n[render] webm done");

    // 3) Poster JPG — the payoff frame for the homepage embed.
    const poster = path.join(outDir, `${clip.base}-poster.jpg`);
    console.log(`[render] poster jpg (frame ${clip.poster})…`);
    await renderStill({
      serveUrl,
      composition,
      browserExecutable: browserExecutable ?? undefined,
      frame: clip.poster,
      output: poster,
      imageFormat: "jpeg",
      jpegQuality: 90,
      chromiumOptions: { gl: "angle" },
    });
    console.log("[render] poster done");
  }

  console.log("\n[render] all outputs written to", outDir);
}

main().catch((err) => {
  console.error("[render] FAILED:", err);
  process.exit(1);
});
