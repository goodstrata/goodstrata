import type { CapacitorConfig } from "@capacitor/cli";

/**
 * GoodStrata native shell. The webview loads the production app directly so
 * better-auth session cookies stay first-party and the app is always current —
 * no store release needed for web-layer changes. Native value (push, deep
 * links, biometrics) layers on via Capacitor plugins.
 */
const config: CapacitorConfig = {
  appId: "au.com.goodstrata.app",
  appName: "GoodStrata",
  // Bundled web dir is a placeholder; the shell points at prod below.
  webDir: "www",
  server: {
    url: "https://my.goodstrata.com.au",
    // Keep navigation inside the product; external links open the browser.
    allowNavigation: ["my.goodstrata.com.au", "mcp.goodstrata.com.au"],
  },
  ios: {
    contentInset: "never",
    backgroundColor: "#faf9f7",
  },
  android: {
    backgroundColor: "#faf9f7",
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      backgroundColor: "#095b41",
      launchAutoHide: true,
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: "LIGHT",
      backgroundColor: "#095b41",
    },
  },
};

export default config;
