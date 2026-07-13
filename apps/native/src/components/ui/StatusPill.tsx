import { Text, View } from "react-native";
import { radius, space, type } from "../../theme/tokens";
import { useTheme } from "../../theme/useTheme";

export type StatusToneName = "ok" | "warn" | "crit" | "info" | "agent" | "neutral";

const TONE_BY_STATUS: Record<string, StatusToneName> = {
  paid: "ok",
  approved: "ok",
  active: "ok",
  adopted: "ok",
  awarded: "ok",
  carried: "ok",
  closed: "ok",
  completed: "ok",
  executed: "ok",
  joined: "ok",
  matched: "ok",
  minutes_distributed: "ok",
  passed: "ok",
  responded: "ok",
  selected: "ok",
  succeeded: "ok",
  pending: "warn",
  awaiting_decision: "warn",
  awaiting_quorum: "warn",
  committee_review: "warn",
  overdue_soon: "warn",
  due_soon: "warn",
  partially_paid: "warn",
  draft: "warn",
  invited: "warn",
  onboarding: "warn",
  quote_requested: "warn",
  quoted: "warn",
  quoting: "warn",
  requested: "warn",
  setup: "warn",
  registered: "warn",
  overdue: "crit",
  failed: "crit",
  lost: "crit",
  rejected: "crit",
  cancelled: "crit",
  accepted: "info",
  dispatched: "info",
  in_progress: "info",
  issued: "info",
  notice_sent: "info",
  open: "info",
  published: "info",
  received: "info",
  running: "info",
  scheduled: "info",
  sent: "info",
  unmatched: "warn",
  work_ordered: "info",
  minutes_draft: "agent",
  triaged: "agent",
  archived: "neutral",
  declined: "neutral",
  expired: "neutral",
  refunded: "neutral",
  withdrawn: "neutral",
  written_off: "neutral",
};

/**
 * The one shared domain-status → tone mapping (mirrors the web's
 * STATUS_TONES). Never invent per-screen colour mappings. Unknown statuses
 * fall back to neutral with a dev warning.
 */
export function statusTone(status: string): StatusToneName {
  const key = status
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const tone = TONE_BY_STATUS[key];
  if (!tone) {
    if (__DEV__) {
      console.warn(`statusTone: unknown status "${status}" — defaulting to neutral`);
    }
    return "neutral";
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
  const colour = theme[tone];
  const soft = theme[`${tone}Soft` as const];
  return (
    <View
      style={{
        minHeight: 24,
        borderRadius: radius.pill,
        paddingHorizontal: space(3),
        paddingVertical: space(1),
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
