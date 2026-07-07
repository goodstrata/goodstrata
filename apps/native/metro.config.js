// Learn more: https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

// Standard pnpm-monorepo config: watch the workspace root so Metro follows the
// symlinked (.pnpm) packages. Nothing else — an earlier resolver.extraNodeModules
// override (added to dedupe react, which turned out NOT to be duplicated) broke
// expo-router's require.context in release builds, crashing the standalone app at
// launch with "Cannot find module" (asyncRequire → metroContext). react resolves
// to a single 19.2.3 without any override.
const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, "../..")];

module.exports = config;
