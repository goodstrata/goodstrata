// Learn more: https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

// pnpm monorepo: the workspace also contains the web app's react 19.2.7, while
// this app is pinned to Expo SDK 57's react 19.2.3. Metro must bundle a SINGLE
// react/react-native or the app renders blank (invalid hook call from two
// Reacts). We pin them to this package's own copies via extraNodeModules and
// watch the workspace root — WITHOUT overriding resolver.nodeModulesPaths, which
// on EAS makes Metro load a broken transform-worker ("… reading 'transformFile'").
const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  react: path.resolve(projectRoot, "node_modules/react"),
  "react-native": path.resolve(projectRoot, "node_modules/react-native"),
};

module.exports = config;
