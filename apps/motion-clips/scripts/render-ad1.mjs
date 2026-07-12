// One-off: render AD1-screwed (1080x1920) to out/ads/ad1-screwed.mp4 (H.264+AAC)
// plus hook + mid still frames. Modeled on scripts/render.mjs.
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { ensureBrowser, renderMedia, renderStill, selectComposition } from "@remotion/renderer";

const root = "/Users/jake/Projects/open-goodstrata/apps/motion-clips";
const outDir = path.join(root, "out/ads");

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

  let browserExecutable = null;
  try {
    await ensureBrowser();
    console.log("[render] using Remotion-managed Chrome headless shell");
  } catch (err) {
    browserExecutable = findPlaywrightChrome();
    if (!browserExecutable) throw new Error(`no browser: ${err?.message}`);
    console.log(`[render] using Playwright chrome at ${browserExecutable}`);
  }

  console.log("[render] bundling…");
  const serveUrl = await bundle({ entryPoint: path.join(root, "src/index.ts") });

  const composition = await selectComposition({
    serveUrl,
    id: "AD1-screwed",
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

  const mp4 = path.join(outDir, "ad1-screwed.mp4");
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
  console.log("\n[render] mp4 done");

  const midFrame = Math.floor(composition.durationInFrames / 2);
  const hookFrame = 20; // inside the first second
  for (const [name, frame] of [
    ["ad1-screwed-hook.jpg", hookFrame],
    ["ad1-screwed-mid.jpg", midFrame],
  ]) {
    await renderStill({
      serveUrl,
      composition,
      browserExecutable: browserExecutable ?? undefined,
      frame,
      output: path.join(outDir, name),
      imageFormat: "jpeg",
      jpegQuality: 90,
    });
    console.log(`[render] still ${name} (frame ${frame})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
