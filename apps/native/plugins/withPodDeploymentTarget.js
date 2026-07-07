const { withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

// The app targets iOS 16.4; nothing runs below it. Xcode 27 rejects any pod
// whose IPHONEOS_DEPLOYMENT_TARGET is under iOS 15 — react-native-svg's
// RNSVGFilters resource bundle ships 12.4, and the default post_install misses
// resource-bundle targets. Force every pod target up to the app's own target.
const DEPLOYMENT_TARGET = 16.4;

/**
 * Injects a post_install pod-deployment-target bump into the generated Podfile.
 * withDangerousMod runs after prebuild writes the Podfile, so the edit survives
 * `expo prebuild` / `eas build` (a hand-edit of ios/Podfile would not).
 */
module.exports = function withPodDeploymentTarget(config) {
  return withDangerousMod(config, [
    "ios",
    (cfg) => {
      const podfilePath = path.join(cfg.modRequest.platformProjectRoot, "Podfile");
      let contents = fs.readFileSync(podfilePath, "utf8");
      const marker = "# @gs-pod-deployment-target";
      if (!contents.includes(marker)) {
        const snippet = [
          `    ${marker}`,
          "    installer.pods_project.targets.each do |t|",
          "      t.build_configurations.each do |bc|",
          "        current = bc.build_settings['IPHONEOS_DEPLOYMENT_TARGET']",
          `        if current.nil? || current.to_f < ${DEPLOYMENT_TARGET}`,
          `          bc.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '${DEPLOYMENT_TARGET}'`,
          "        end",
          "      end",
          "    end",
        ].join("\n");
        contents = contents.replace(
          /post_install do \|installer\|/,
          (match) => `${match}\n${snippet}`,
        );
        fs.writeFileSync(podfilePath, contents);
      }
      return cfg;
    },
  ]);
};
