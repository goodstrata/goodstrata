import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Tone = "positive" | "caution" | "critical" | "info" | "agent" | "neutral";

/**
 * The single source of truth mapping every domain status to a tone
 * (DESIGN.md §3.3, §7.2). New statuses must be added here — unmapped
 * statuses render neutral and warn in dev.
 */
const STATUS_TONES: Record<string, Tone> = {
  // schemes
  registered: "caution",
  setup: "caution",
  onboarding: "caution",
  active: "positive",
  // people & invites
  pending: "caution",
  invited: "caution",
  joined: "positive",
  // budgets & decisions
  draft: "caution",
  committee_review: "caution",
  awaiting_decision: "caution",
  adopted: "positive",
  approved: "positive",
  rejected: "critical",
  declined: "neutral",
  expired: "neutral",
  executed: "positive",
  // levy notices
  issued: "info",
  paid: "positive",
  overdue: "critical",
  cancelled: "critical",
  // maintenance
  open: "info",
  triaged: "agent",
  quoting: "caution",
  quote_requested: "caution",
  quoted: "caution",
  dispatched: "info",
  accepted: "info",
  scheduled: "info",
  work_ordered: "info",
  in_progress: "info",
  completed: "positive",
  // meetings & motions
  notice_sent: "info",
  closed: "positive",
  minutes_distributed: "positive",
  carried: "positive",
  lost: "critical",
  // agent runs
  running: "info",
  succeeded: "positive",
  failed: "critical",
};

/**
 * A consistent status pill: the raw lowercase domain word stays in the DOM
 * (the e2e suite asserts it) with underscores humanised ("notice_sent" →
 * "notice sent"); capitalisation is visual only, via CSS.
 */
export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const tone = STATUS_TONES[status];
  if (import.meta.env.DEV && tone === undefined) {
    console.warn(`StatusBadge: unmapped status "${status}" rendered as neutral`);
  }
  return (
    <Badge tone={tone ?? "neutral"} className={cn("shrink-0 font-medium capitalize", className)}>
      {status.replace(/_/g, " ")}
    </Badge>
  );
}
