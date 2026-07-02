import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Tone = "green" | "amber" | "red" | "blue" | "purple" | "gray";

const TONE_CLASSES: Record<Tone, string> = {
  green: "border-green-200 bg-green-50 text-green-700",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  red: "border-red-200 bg-red-50 text-red-700",
  blue: "border-blue-200 bg-blue-50 text-blue-700",
  purple: "border-purple-200 bg-purple-50 text-purple-700",
  gray: "border-border bg-muted text-muted-foreground",
};

const STATUS_TONES: Record<string, Tone> = {
  // schemes / general
  active: "green",
  onboarding: "amber",
  // budgets & decisions
  adopted: "green",
  committee_review: "amber",
  pending: "amber",
  approved: "green",
  declined: "gray",
  expired: "gray",
  // levy notices
  paid: "green",
  issued: "blue",
  overdue: "red",
  cancelled: "gray",
  // maintenance
  open: "blue",
  triaged: "purple",
  quoting: "amber",
  dispatched: "blue",
  accepted: "blue",
  scheduled: "blue",
  in_progress: "blue",
  completed: "green",
  rejected: "gray",
  draft: "gray",
  // meetings
  notice_sent: "blue",
  closed: "gray",
  minutes_distributed: "green",
  // motions
  carried: "green",
  lost: "red",
  // agent runs
  succeeded: "green",
  awaiting_decision: "amber",
  running: "blue",
  failed: "red",
  // people
  joined: "green",
  invited: "amber",
};

/**
 * A consistent status pill: any snake_case domain status renders with a
 * sensible tone and human spacing (e.g. "notice_sent" → "notice sent").
 */
export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const tone = STATUS_TONES[status] ?? "gray";
  return (
    <Badge variant="outline" className={cn("shrink-0 font-medium", TONE_CLASSES[tone], className)}>
      {status.replace(/_/g, " ")}
    </Badge>
  );
}
