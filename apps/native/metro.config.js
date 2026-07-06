// Learn more: https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

// pnpm monorepo: Metro must watch the workspace root and know where hoisted
// packages live, otherwise it can bundle a second copy of react / react-native
// from a sibling node_modules — which crashes on load. Hierarchical lookup is
// left on so pnpm's symlinked (.pnpm) layout still resolves.
const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

module.exports = config;
