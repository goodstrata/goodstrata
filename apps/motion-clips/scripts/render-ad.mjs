// Render a single vertical ad composition to H.264 mp4 (+AAC) plus hook/mid
// still frames. Usage: node scripts/render-ad.mjs AD2-commission
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
const outDir = path.join(root, "out", "ads");

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
  const id = process.argv[2];
  if (!id) throw new Error("Usage: node scripts/render-ad.mjs <composition-id>");
  const base = id.toLowerCase().replace(/^ad(\d)-/, "ad$1-");

  await mkdir(outDir, { recursive: true });

  let browserExecutable = null;
  try {
    await ensureBrowser();
    console.log("[render] using Remotion-managed Chrome headless shell");
  } catch (err) {
    browserExecutable = findPlaywrightChrome();
    if (!browserExecutable) {
      throw new Error(
        `ensureBrowser() failed (${err?.message ?? err}) and no Playwright chrome found.`,
      );
    }
    console.log(`[render] using Playwright chrome at ${browserExecutable}`);
  }

  console.log("[render] bundling…");
  const serveUrl = await bundle({
    entryPoint: path.join(root, "src/index.ts"),
  });

  const composition = await selectComposition({
    serveUrl,
    id,
    browserExecutable: browserExecutable ?? undefined,
  });
  console.log(
    `[render] ${id}: ${composition.width}x${composition.height} ${composition.durationInFrames}f @ ${composition.fps}fps`,
  );

  const common = {
    serveUrl,
    composition,
    browserExecutable: browserExecutable ?? undefined,
    chromiumOptions: { gl: "angle" },
  };

  const mp4 = path.join(outDir, `${base}.mp4`);
  console.log("[render] mp4 (H.264 + AAC)…");
  await renderMedia({
    ...common,
    codec: "h264",
    audioCodec: "aac",
    outputLocation: mp4,
    crf: 18,
    onProgress: ({ progress }) => {
      const pct = Math.round(progress * 100);
      if (pct % 10 === 0) process.stdout.write(`  mp4 ${pct}%\r`);
    },
  });
  console.log("\n[render] mp4 done:", mp4);

  // Hook frame inside the first second + a mid frame.
  const stills = [
    { frame: Math.min(20, composition.durationInFrames - 1), name: `${base}-hook.jpg` },
    { frame: Math.floor(composition.durationInFrames / 2), name: `${base}-mid.jpg` },
  ];
  for (const s of stills) {
    const out = path.join(outDir, s.name);
    await renderStill({
      serveUrl,
      composition,
      browserExecutable: browserExecutable ?? undefined,
      frame: s.frame,
      output: out,
      imageFormat: "jpeg",
      jpegQuality: 90,
      chromiumOptions: { gl: "angle" },
    });
    console.log(`[render] still frame ${s.frame} -> ${out}`);
  }
}

main().catch((err) => {
  console.error("[render] FAILED:", err);
  process.exit(1);
});
