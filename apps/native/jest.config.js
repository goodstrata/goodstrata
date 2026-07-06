/** @type {import('jest').Config} */
module.exports = {
  preset: "jest-expo",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
  // The Expo/RN packages ship ESM and must be transpiled. pnpm nests real
  // packages under `.pnpm/<name>@<version>/node_modules/<name>`, so the ignore
  // pattern has to optionally skip the `.pnpm/` segment before matching the
  // package name — otherwise RN's own jest-preset fails on `import`.
  transformIgnorePatterns: [
    "node_modules/(?!(?:\\.pnpm/)?((jest-)?react-native|@react-native|@react-navigation|expo|@expo|@expo-google-fonts|react-native-.+|better-auth|@better-auth|@better-fetch|nanostores))",
  ],
  collectCoverageFrom: ["src/**/*.{ts,tsx}", "app/**/*.{ts,tsx}", "!**/*.d.ts"],
};
