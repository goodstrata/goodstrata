const { withInfoPlist, withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

// iOS 27 traps at launch (NoSceneLifecycleAdoption) unless the app adopts the
// UIScene lifecycle. Expo SDK 57.0.2's template still uses the legacy lifecycle
// (window created in the AppDelegate, no scene delegate) — the ExpoAppSceneDelegate
// only exists on expo `main`. This plugin backports scene adoption: it declares a
// scene manifest and appends a SceneDelegate that owns the window + starts React
// Native into it (using the factory the AppDelegate builds), forwarding deep links
// to RCTLinkingManager so OAuth/universal links keep working.

const SCENE_DELEGATE = `

// --- iOS 27 UIScene adoption (backported; see plugins/withIosSceneLifecycle.js) ---
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene,
      let appDelegate = UIApplication.shared.delegate as? AppDelegate,
      let factory = appDelegate.reactNativeFactory
    else {
      return
    }
    let window = UIWindow(windowScene: windowScene)
    self.window = window
    appDelegate.window = window
    factory.startReactNative(withModuleName: "main", in: window, launchOptions: nil)

    if let url = connectionOptions.urlContexts.first?.url {
      RCTLinkingManager.application(UIApplication.shared, open: url, options: [:])
    }
    if let activity = connectionOptions.userActivities.first {
      RCTLinkingManager.application(UIApplication.shared, continue: activity, restorationHandler: { _ in })
    }
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    guard let url = URLContexts.first?.url else { return }
    RCTLinkingManager.application(UIApplication.shared, open: url, options: [:])
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    RCTLinkingManager.application(
      UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
  }
}
`;

function withSceneManifest(config) {
  return withInfoPlist(config, (cfg) => {
    cfg.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: "Default Configuration",
            UISceneDelegateClassName: "$(PRODUCT_MODULE_NAME).SceneDelegate",
          },
        ],
      },
    };
    return cfg;
  });
}

function withSceneDelegate(config) {
  return withDangerousMod(config, [
    "ios",
    (cfg) => {
      const file = path.join(
        cfg.modRequest.platformProjectRoot,
        cfg.modRequest.projectName,
        "AppDelegate.swift",
      );
      let contents = fs.readFileSync(file, "utf8");
      // The scene owns the window + RN startup now — strip it from didFinishLaunching
      // so React Native isn't started twice.
      contents = contents.replace(
        /#if os\(iOS\) \|\| os\(tvOS\)[\s\S]*?factory\.startReactNative\([\s\S]*?\)\s*#endif/m,
        "// Window + startReactNative are owned by SceneDelegate (iOS 27 UIScene adoption)",
      );
      if (!contents.includes("class SceneDelegate")) {
        contents += SCENE_DELEGATE;
      }
      fs.writeFileSync(file, contents);
      return cfg;
    },
  ]);
}

module.exports = function withIosSceneLifecycle(config) {
  config = withSceneManifest(config);
  config = withSceneDelegate(config);
  return config;
};
