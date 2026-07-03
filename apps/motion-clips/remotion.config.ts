import { Config } from "@remotion/cli/config";

// Build-time only. 30fps master. H.264 mp4 is the CLI default; the VP9 webm
// is produced by scripts/render.mjs. Studio/CLI preview config lives here.
Config.setVideoImageFormat("jpeg");
Config.overrideWebpackConfig((cfg) => cfg);

// Concurrency left at auto; the render script pins the browser executable.
