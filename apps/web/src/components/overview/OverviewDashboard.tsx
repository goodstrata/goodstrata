import { Link } from "@tanstack/react-router";
import {
  Activity,
  ArrowRight,
  Bot,
  CalendarDays,
  CircleCheck,
  Layers,
  Scale,
  ShieldCheck,
  User,
  Users,
  Wrench,
} from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatMoney } from "@/components/ui/money";
import { StatCard } from "@/components/ui/stat-card";
import { formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Sections the dashboard deep-links into (subset of the scheme nav). */
type TabSection =
  | "finance"
  | "maintenance"
  | "meetings"
  | "decisions"
  | "compliance"
  | "activity"
  | "lots"
  | "people";

export interface OverviewData {
  scheme: { id: string; name: string; planOfSubdivision: string; tier: number; status: string };
  onboarding: { hasLots: boolean; hasInsurance: boolean; ready: boolean; status: string };
  glance: { lots: number; people: number; members: number };
  finance: {
    hasBudget: boolean;
    fiscalYearStart: string | null;
    adminCents: number;
    maintenanceCents: number;
    leviedCents: number;
    noticeCount: number;
    arrearsCents: number;
    arrearsOutstandingCents: number;
    lotsInArrears: number;
  };
  attention: {
    pendingDecisions: number;
    overdueDecisions: number;
    openMaintenanceRequests: number;
    openWorkOrders: number;
    complianceOpen: number;
    complianceOverdue: number;
    nextCompliance: {
      id: string;
      kind: string;
      title: string;
      dueOn: string;
      status: string;
    } | null;
  };
  nextMeeting: {
    id: string;
    kind: string;
    title: string;
    scheduledAt: string;
    status: string;
  } | null;
  recentActivity: {
    id: string;
    seq: number;
    type: string;
    actor: { kind: string; id: string };
    occurredAt: string;
  }[];
}

const MEETING_KIND_LABEL: Record<string, string> = {
  agm: "Annual general meeting",
  sgm: "Special general meeting",
  committee: "Committee meeting",
};

/** A quiet "View X" deep link into a scheme section. */
function TabLink({
  schemeId,
  section,
  children,
}: {
  schemeId: string;
  section: TabSection;
  children: React.ReactNode;
}) {
  return (
    <Link
      to="/schemes/$schemeId"
      params={{ schemeId }}
      search={{ section }}
      className="inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline"
    >
      {children}
      <ArrowRight aria-hidden="true" className="size-3.5" />
    </Link>
  );
}

/**
 * The active-scheme landing dashboard: a scannable summary a committee member
 * or manager wants first — money, what needs attention, the next meeting, the
 * register at a glance, and recent activity. Every block deep-links to its tab.
 */
export function OverviewDashboard({ schemeId, data }: { schemeId: string; data: OverviewData }) {
  return (
    <div className="space-y-6">
      <FinancialPosition schemeId={schemeId} finance={data.finance} />
      <div className="grid gap-6 lg:grid-cols-2">
        <NeedsAttention schemeId={schemeId} attention={data.attention} />
        <NextMeeting schemeId={schemeId} meeting={data.nextMeeting} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <AtAGlance schemeId={schemeId} glance={data.glance} status={data.scheme.status} />
        <RecentActivity schemeId={schemeId} events={data.recentActivity} />
      </div>
    </div>
  );
}

function FinancialPosition({
  schemeId,
  finance,
}: {
  schemeId: string;
  finance: OverviewData["finance"];
}) {
  const budgetHint = finance.hasBudget
    ? finance.fiscalYearStart
      ? `FY from ${formatDate(finance.fiscalYearStart)}`
      : "Adopted budget"
    : "No budget yet";
  const inArrears = finance.arrearsCents > 0;

  return (
    <section aria-labelledby="overview-finance">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="overview-finance" className="text-base font-semibold">
          Financial position
        </h2>
        <TabLink schemeId={schemeId} section="finance">
          View finance
        </TabLink>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Admin fund"
          value={finance.hasBudget ? formatMoney(finance.adminCents) : "—"}
          hint={budgetHint}
        />
        <StatCard
          label="Maintenance fund"
          value={finance.hasBudget ? formatMoney(finance.maintenanceCents) : "—"}
          hint={budgetHint}
        />
        <StatCard
          label="Levied"
          value={formatMoney(finance.leviedCents)}
          hint={
            finance.noticeCount === 0
              ? "No notices yet"
              : `${finance.noticeCount} ${finance.noticeCount === 1 ? "notice" : "notices"}`
          }
        />
        <StatCard
          label="In arrears"
          value={formatMoney(finance.arrearsCents)}
          tone={inArrears ? "critical" : "positive"}
          hint={
            inArrears
              ? `${finance.lotsInArrears} ${finance.lotsInArrears === 1 ? "lot" : "lots"} overdue`
              : "All lots up to date"
          }
        />
      </div>
    </section>
  );
}

interface AttentionItem {
  section: TabSection;
  icon: typeof Scale;
  label: string;
  count: number;
  note?: string;
  critical?: boolean;
}

function NeedsAttention({
  schemeId,
  attention,
}: {
  schemeId: string;
  attention: OverviewData["attention"];
}) {
  const items: AttentionItem[] = [];
  if (attention.pendingDecisions > 0) {
    items.push({
      section: "decisions",
      icon: Scale,
      label: "Pending decisions",
      count: attention.pendingDecisions,
      note: attention.overdueDecisions > 0 ? `${attention.overdueDecisions} overdue` : undefined,
      critical: attention.overdueDecisions > 0,
    });
  }
  const openMaintenance = attention.openMaintenanceRequests + attention.openWorkOrders;
  if (openMaintenance > 0) {
    items.push({
      section: "maintenance",
      icon: Wrench,
      label: "Open maintenance",
      count: openMaintenance,
      note:
        attention.openWorkOrders > 0
          ? `${attention.openWorkOrders} ${attention.openWorkOrders === 1 ? "work order" : "work orders"}`
          : undefined,
    });
  }
  if (attention.complianceOpen > 0) {
    items.push({
      section: "compliance",
      icon: ShieldCheck,
      label: "Compliance due",
      count: attention.complianceOpen,
      note:
        attention.complianceOverdue > 0
          ? `${attention.complianceOverdue} overdue`
          : attention.nextCompliance
            ? `next ${formatDate(attention.nextCompliance.dueOn)}`
            : undefined,
      critical: attention.complianceOverdue > 0,
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Needs attention</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <EmptyState
            icon={CircleCheck}
            title="You're all caught up"
            description="No decisions, maintenance or compliance items need attention right now."
          />
        ) : (
          <ul className="-my-1">
            {items.map((item) => (
              <li key={item.section}>
                <Link
                  to="/schemes/$schemeId"
                  params={{ schemeId }}
                  search={{ section: item.section }}
                  className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-muted"
                >
                  <span
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-full",
                      item.critical
                        ? "bg-critical/10 text-critical"
                        : "bg-accent text-accent-foreground",
                    )}
                  >
                    <item.icon aria-hidden="true" className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{item.label}</span>
                    {item.note && (
                      <span
                        className={cn(
                          "block text-[13px]",
                          item.critical ? "text-critical" : "text-muted-foreground",
                        )}
                      >
                        {item.note}
                      </span>
                    )}
                  </span>
                  <Badge tone={item.critical ? "critical" : "neutral"} className="tabular-nums">
                    {item.count}
                  </Badge>
                  <ArrowRight
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted-foreground"
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function NextMeeting({
  schemeId,
  meeting,
}: {
  schemeId: string;
  meeting: OverviewData["nextMeeting"];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Next meeting</CardTitle>
        <CardAction>
          <TabLink schemeId={schemeId} section="meetings">
            View meetings
          </TabLink>
        </CardAction>
      </CardHeader>
      <CardContent>
        {meeting ? (
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
              <CalendarDays aria-hidden="true" className="size-4" />
            </span>
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{meeting.title}</span>
                <StatusBadge status={meeting.status} />
              </div>
              <p className="text-[13px] text-muted-foreground">
                {MEETING_KIND_LABEL[meeting.kind] ?? meeting.kind}
              </p>
              <p className="font-mono text-[13px] tabular-nums">
                {formatDateTime(meeting.scheduledAt)}
              </p>
            </div>
          </div>
        ) : (
          <EmptyState
            icon={CalendarDays}
            title="No meeting scheduled"
            description="When the committee schedules an AGM or committee meeting, it will show here."
          />
        )}
      </CardContent>
    </Card>
  );
}

function AtAGlance({
  schemeId,
  glance,
  status,
}: {
  schemeId: string;
  glance: OverviewData["glance"];
  status: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>At a glance</CardTitle>
        <CardAction>
          <TabLink schemeId={schemeId} section="lots">
            View register
          </TabLink>
        </CardAction>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
          <GlanceFigure icon={Layers} label="Lots" value={glance.lots} />
          <GlanceFigure icon={User} label="People" value={glance.people} />
          <GlanceFigure icon={Users} label="Members" value={glance.members} />
          <div className="flex flex-col gap-1">
            <dt className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
              <CircleCheck aria-hidden="true" className="size-3.5" />
              Status
            </dt>
            <dd className="pt-0.5">
              <StatusBadge status={status} />
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}

function GlanceFigure({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Layers;
  label: string;
  value: number;
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
        <Icon aria-hidden="true" className="size-3.5" />
        {label}
      </dt>
      <dd className="font-mono text-xl font-bold tabular-nums">{value}</dd>
    </div>
  );
}

function RecentActivity({
  schemeId,
  events,
}: {
  schemeId: string;
  events: OverviewData["recentActivity"];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
        <CardAction>
          <TabLink schemeId={schemeId} section="activity">
            View activity
          </TabLink>
        </CardAction>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <EmptyState
            icon={Activity}
            title="No activity yet"
            description="Every levy, meeting and maintenance job on the scheme's bus will appear here."
          />
        ) : (
          <ol className="relative space-y-0 border-l border-border pl-6">
            {events.map((evt) => {
              const isAgent = evt.actor.kind === "agent";
              return (
                <li key={evt.id} className="relative pb-4 last:pb-0">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute top-1.5 -left-[30px] size-2.5 rounded-full ring-4 ring-card",
                      isAgent ? "bg-agent" : "bg-foreground",
                    )}
                  />
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="min-w-0 flex-1 truncate font-mono text-[13px] font-medium">
                      {evt.type}
                    </span>
                    {isAgent && (
                      <Badge tone="agent" className="shrink-0 gap-1">
                        <Bot aria-hidden="true" className="size-3" />
                        agent
                      </Badge>
                    )}
                    <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
                      {formatDateTime(evt.occurredAt)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
