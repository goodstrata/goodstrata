// Build-time render of C1 "The Number" to mp4 (H.264) + webm (VP9) + poster JPG.
// Uses @remotion/renderer programmatically. Chromium: prefers Remotion's own
// headless shell (ensureBrowser); falls back to the Playwright chrome-headless-
// shell in the local cache, or $REMOTION_CHROME.
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
const COMP_ID = "C1-the-number";

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

  const composition = await selectComposition({
    serveUrl,
    id: COMP_ID,
    inputProps: { hook: "A" },
    browserExecutable: browserExecutable ?? undefined,
  });
  console.log(
    `[render] composition ${composition.width}x${composition.height} ${composition.durationInFrames}f @ ${composition.fps}fps`,
  );

  const common = {
    serveUrl,
    composition,
    inputProps: { hook: "A" },
    browserExecutable: browserExecutable ?? undefined,
    chromiumOptions: { gl: "angle" },
  };

  // 1) H.264 mp4
  const mp4 = path.join(outDir, "c1-the-number.mp4");
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
  const webm = path.join(outDir, "c1-the-number.webm");
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

  // 3) Poster JPG — a real mid-clip frame (~scene 6, the $8,400 count).
  // Scene 6 is frames 465-570; grab 540 (count settled, breakdown visible).
  const poster = path.join(outDir, "c1-poster.jpg");
  console.log("[render] poster jpg (frame 540)…");
  await renderStill({
    serveUrl,
    composition,
    inputProps: { hook: "A" },
    browserExecutable: browserExecutable ?? undefined,
    frame: 540,
    output: poster,
    imageFormat: "jpeg",
    jpegQuality: 90,
    chromiumOptions: { gl: "angle" },
  });
  console.log("[render] poster done");

  console.log("\n[render] all outputs written to", outDir);
}

main().catch((err) => {
  console.error("[render] FAILED:", err);
  process.exit(1);
});
