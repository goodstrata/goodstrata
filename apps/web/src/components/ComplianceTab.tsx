import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import {
  BadgeCheck,
  CalendarClock,
  CalendarDays,
  Check,
  FileText,
  Flame,
  Landmark,
  Receipt,
  ScrollText,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/ui/stat-card";
import { api, unwrap } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useIsOfficer } from "@/lib/roles";

/** Mirror of the row shape returned by GET /schemes/:id/compliance. */
interface Obligation {
  id: string;
  schemeId: string | null;
  kind: string;
  title: string;
  dueOn: string;
  status: string;
  escalationState: string;
  responsibleRole: string | null;
}

type Tone = "positive" | "caution" | "critical" | "info" | "agent" | "neutral";

/** Kind → human label + icon. Mirrors the service's KIND_LABEL, in calendar order. */
const KINDS: { key: string; label: string; icon: LucideIcon }[] = [
  { key: "agm_due", label: "AGM due", icon: CalendarDays },
  { key: "insurance_renewal", label: "Insurance renewal", icon: ShieldCheck },
  { key: "valuation", label: "Insurance valuation", icon: Landmark },
  { key: "esm_inspection", label: "Essential safety measures", icon: Flame },
  { key: "financial_statements", label: "Financial statements", icon: FileText },
  { key: "bas", label: "BAS lodgement", icon: Receipt },
  { key: "registration_renewal", label: "Manager registration renewal", icon: BadgeCheck },
  { key: "pi_expiry", label: "Manager PI insurance", icon: ScrollText },
  { key: "custom", label: "Other obligations", icon: CalendarClock },
];
const KIND_META = new Map(KINDS.map((k) => [k.key, k]));

/** Escalation band → tone + short label for the pill. */
const NONE_ESC: { tone: Tone; label: string } = { tone: "neutral", label: "> 90 days" };
const ESCALATION: Record<string, { tone: Tone; label: string }> = {
  overdue: { tone: "critical", label: "overdue" },
  due: { tone: "critical", label: "due now" },
  t_30: { tone: "caution", label: "≤ 30 days" },
  t_60: { tone: "info", label: "≤ 60 days" },
  t_90: { tone: "info", label: "≤ 90 days" },
  none: NONE_ESC,
};

const OPEN_STATUSES = new Set(["upcoming", "due", "overdue"]);

/** Days from today to an ISO date-only string (negative = overdue). */
function daysUntil(dueOn: string): number {
  const due = new Date(`${dueOn}T00:00:00`);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

function relativeDue(dueOn: string): string {
  const d = daysUntil(dueOn);
  if (d < 0) return `${-d} day${d === -1 ? "" : "s"} overdue`;
  if (d === 0) return "due today";
  if (d === 1) return "due tomorrow";
  return `due in ${d} days`;
}

function humanRole(role: string | null): string | null {
  return role ? role.replace(/_/g, " ") : null;
}

export function ComplianceTab({ schemeId }: { schemeId: string }) {
  const isOfficer = useIsOfficer(schemeId);
  const [showClosed, setShowClosed] = useState(false);
  const window = showClosed ? "all" : "open";

  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["compliance", schemeId, window],
    queryFn: async () =>
      unwrap<{ obligations: Obligation[] }>(
        await api.schemes[":schemeId"].compliance.$get({
          param: { schemeId },
          query: { window },
        }),
      ),
  });

  const complete = useMutation({
    mutationFn: async (obligationId: string) =>
      unwrap(
        await api.schemes[":schemeId"].compliance[":obligationId"].complete.$post({
          param: { schemeId, obligationId },
          json: {},
        }),
      ),
    onSuccess: () => {
      toast.success("Obligation marked done");
      void queryClient.invalidateQueries({ queryKey: ["compliance", schemeId] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Couldn't complete it"),
  });

  const obligations = data?.obligations ?? [];
  const open = obligations.filter((o) => OPEN_STATUSES.has(o.status));
  const overdue = open.filter((o) => o.escalationState === "overdue").length;
  const dueSoon = open.filter((o) => ["due", "t_30"].includes(o.escalationState)).length;

  // Group by kind, preserving the calendar order in KINDS.
  const groups = KINDS.map((k) => ({
    ...k,
    items: obligations
      .filter((o) => o.kind === k.key)
      .sort((a, b) => a.dueOn.localeCompare(b.dueOn)),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="space-y-8">
      <PageHeader
        as="h2"
        title="Compliance calendar"
        description="Statutory deadlines — insurance, valuation, ESM, AGM, financial statements and manager registration — tracked and escalated as they approach."
        actions={
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowClosed((v) => !v)}
            aria-pressed={showClosed}
          >
            {showClosed ? "Hide completed" : "Show completed"}
          </Button>
        }
      />

      {!isLoading && !isError && obligations.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatCard
            label="Overdue"
            value={overdue}
            tone={overdue > 0 ? "critical" : "neutral"}
            hint="past their statutory due date"
          />
          <StatCard
            label="Due within 30 days"
            value={dueSoon}
            tone={dueSoon > 0 ? "caution" : "neutral"}
            hint="approaching — action soon"
          />
          <StatCard label="Open total" value={open.length} hint="obligations still to close" />
        </div>
      )}

      {isLoading && <Skeleton className="h-40" />}
      {isError && (
        <ErrorState
          message="Couldn't load the compliance calendar."
          onRetry={() => void refetch()}
        />
      )}

      {!isLoading && !isError && groups.length === 0 && (
        <EmptyState
          icon={ShieldCheck}
          title="Nothing on the calendar"
          description="Compliance obligations appear here as insurance, valuations, meetings and registrations are recorded — then escalate automatically as their due dates near."
        />
      )}

      <div className="space-y-8">
        {groups.map((group) => (
          <section key={group.key}>
            <h3 className="flex items-center gap-2 text-base font-semibold">
              <group.icon aria-hidden="true" className="size-4 text-muted-foreground" />
              {group.label}
              <span className="text-sm font-normal text-muted-foreground">
                ({group.items.length})
              </span>
            </h3>
            <ul className="mt-3 space-y-2.5">
              {group.items.map((o) => (
                <ObligationRow
                  key={o.id}
                  obligation={o}
                  isOfficer={isOfficer}
                  onComplete={() => complete.mutate(o.id)}
                  completing={complete.isPending && complete.variables === o.id}
                  completeDisabled={complete.isPending}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function ObligationRow({
  obligation: o,
  isOfficer,
  onComplete,
  completing,
  completeDisabled,
}: {
  obligation: Obligation;
  isOfficer: boolean;
  onComplete: () => void;
  completing: boolean;
  completeDisabled: boolean;
}) {
  const isOpen = OPEN_STATUSES.has(o.status);
  const esc = ESCALATION[o.escalationState] ?? NONE_ESC;
  const role = humanRole(o.responsibleRole);
  const kindLabel = KIND_META.get(o.kind)?.label;

  return (
    <li className="flex flex-col gap-3 rounded-lg border bg-card px-4 py-3 shadow-xs sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium">{o.title}</p>
          {isOpen ? (
            <Badge tone={esc.tone}>{esc.label}</Badge>
          ) : o.status === "done" ? (
            <Badge tone="positive">
              <Check aria-hidden="true" className="size-3" /> done
            </Badge>
          ) : (
            <Badge tone="neutral">{o.status}</Badge>
          )}
        </div>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span>
            {formatDate(o.dueOn)}
            {isOpen && <span className="text-foreground/70"> · {relativeDue(o.dueOn)}</span>}
          </span>
          {kindLabel && <span className="hidden sm:inline">· {kindLabel}</span>}
          {role && (
            <span className="inline-flex items-center gap-1">
              · <Users aria-hidden="true" className="size-3" /> {role}
            </span>
          )}
        </p>
      </div>
      {isOfficer && isOpen && (
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={onComplete}
          pending={completing}
          disabled={completeDisabled}
        >
          <Check aria-hidden="true" className="size-4" /> Mark done
        </Button>
      )}
    </li>
  );
}
