import { Text, View } from "react-native";
import { radius, space, type } from "../../theme/tokens";
import { useTheme } from "../../theme/useTheme";

export type StatusToneName = "ok" | "warn" | "crit";

const TONE_BY_STATUS: Record<string, StatusToneName> = {
  paid: "ok",
  approved: "ok",
  active: "ok",
  pending: "warn",
  overdue_soon: "warn",
  due_soon: "warn",
  partially_paid: "warn",
  draft: "warn",
  overdue: "crit",
  rejected: "crit",
  cancelled: "crit",
};

/**
 * The one shared domain-status → tone mapping (mirrors the web's
 * STATUS_TONES). Never invent per-screen colour mappings. Unknown statuses
 * fall back to warn with a dev warning.
 */
export function statusTone(status: string): StatusToneName {
  const key = status.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const tone = TONE_BY_STATUS[key];
  if (!tone) {
    if (__DEV__) {
      console.warn(`statusTone: unknown status "${status}" — defaulting to warn`);
    }
    return "warn";
  }
  return tone;
}

export interface StatusPillProps {
  tone: StatusToneName;
  label: string;
}

/** Text conveys the status; colour is reinforcement. */
export function StatusPill({ tone, label }: StatusPillProps) {
  const theme = useTheme();
  const colour = tone === "ok" ? theme.ok : tone === "warn" ? theme.warn : theme.crit;
  const soft = tone === "ok" ? theme.okSoft : tone === "warn" ? theme.warnSoft : theme.critSoft;
  return (
    <View
      style={{
        height: 24,
        borderRadius: radius.pill,
        paddingHorizontal: space(3),
        backgroundColor: soft,
        alignItems: "center",
        justifyContent: "center",
        alignSelf: "flex-start",
      }}
    >
      <Text
        style={{
          fontFamily: type.label.fontFamily,
          fontSize: 12,
          lineHeight: 16,
          letterSpacing: 0.2,
          color: colour,
        }}
      >
        {label}
      </Text>
    </View>
  );
}
