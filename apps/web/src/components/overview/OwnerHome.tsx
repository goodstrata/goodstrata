import { useQueries, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, CalendarDays, MessagesSquare, ReceiptText, Wrench } from "lucide-react";
import { LotStatementDialog } from "@/components/LotStatementDialog";
import type { OverviewData } from "@/components/overview/OverviewDashboard";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatMoney } from "@/components/ui/money";
import { Skeleton } from "@/components/ui/skeleton";
import { api, unwrap } from "@/lib/api";
import { useSession } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Read models — mirror the shapes the committee tabs already read, so the owner
// landing reuses their query keys/caches rather than opening a second stack.
// ---------------------------------------------------------------------------

interface LotRow {
  id: string;
  lotNumber: string;
  unitNumber: string | null;
  owners: { personId: string; email: string | null }[];
}

interface MaintenanceRequest {
  id: string;
  title: string;
  status: string;
  aiTriage: { reasoning?: string; declineExplanation?: string } | null;
  createdAt: string;
}

interface CommunityPost {
  id: string;
  body: string;
  author: { name: string };
  createdAt: string;
}

const MEETING_KIND_LABEL: Record<string, string> = {
  agm: "Annual general meeting",
  sgm: "Special general meeting",
  committee: "Committee meeting",
};

/**
 * Reassuring, jargon-free wording for a maintenance request's raw status. Used
 * only on the owner path; the shared StatusBadge (committee vocabulary) is left
 * untouched.
 */
function ownerStatusLabel(status: string): string {
  switch (status) {
    case "reported":
    case "received":
    case "new":
      return "Reported";
    case "completed":
    case "closed":
    case "resolved":
      return "Done";
    case "rejected":
    case "declined":
      return "Not proceeding";
    case "scheduled":
      return "Scheduled";
    default:
      // triaged / quoting / dispatched / in_progress / work-order states.
      return "Being looked at";
  }
}

function isOpenRequest(status: string): boolean {
  return !["completed", "closed", "resolved", "rejected", "declined"].includes(status);
}

/**
 * The owner (plain-member) landing. Two things lead the eye: a Report-an-issue
 * hero and the owner's own money position — no scheme-wide finance, no
 * governance queues. Everything below reuses primitives and query keys the
 * committee tabs already own.
 */
export function OwnerHome({ schemeId, data }: { schemeId: string; data: OverviewData }) {
  return (
    <div className="space-y-6">
      <ReportIssueHero schemeId={schemeId} />
      <WhatIOwe schemeId={schemeId} />
      <MyRequests schemeId={schemeId} />
      <div className="grid gap-6 lg:grid-cols-2">
        <NextMeetingCard schemeId={schemeId} meeting={data.nextMeeting} />
        <CommunityTeaser schemeId={schemeId} />
      </div>
    </div>
  );
}

// ------------------------------ 1. Report hero ------------------------------

/**
 * The single loudest element on the page. Links into the "Report an issue"
 * section, where the shared report dialog lives. (Enhancer contract: swap this
 * Link for an inline <ReportIssueDialog schemeId={schemeId} /> trigger once the
 * dialog is extracted to components/maintenance/ReportIssueDialog.tsx — the
 * create path and copy stay identical.)
 */
function ReportIssueHero({ schemeId }: { schemeId: string }) {
  return (
    <Card className="border-primary/30 bg-accent/40">
      <CardContent className="flex flex-col gap-4 py-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Wrench aria-hidden="true" className="size-5" />
            </span>
            <h2 className="text-lg font-semibold">Something wrong in the building?</h2>
          </div>
          <p className="max-w-prose text-sm text-muted-foreground">
            Tell us and the maintenance agent takes it from there — you don't need to work out whose
            job it is.
          </p>
        </div>
        <Button asChild size="lg" className="shrink-0">
          <Link to="/schemes/$schemeId" params={{ schemeId }} search={{ section: "maintenance" }}>
            Report an issue
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

// ------------------------------ 2. What I owe -------------------------------

/**
 * The owner's own money position, driven only by the lots they own — never the
 * scheme-wide arrears table. Resolves owned lots from the member-readable lots
 * list (matched by the signed-in email) and sums each lot's statement balance.
 */
function WhatIOwe({ schemeId }: { schemeId: string }) {
  const { data: session } = useSession();
  const email = session?.user?.email?.toLowerCase() ?? null;

  const lotsQuery = useQuery({
    queryKey: ["lots", schemeId],
    queryFn: async () =>
      unwrap<{ lots: LotRow[] }>(await api.schemes[":schemeId"].lots.$get({ param: { schemeId } })),
  });

  const myLots = (lotsQuery.data?.lots ?? []).filter((lot) =>
    lot.owners.some((o) => o.email?.toLowerCase() === email),
  );

  const statements = useQueries({
    queries: myLots.map((lot) => ({
      queryKey: ["lot-statement", schemeId, lot.id] as const,
      queryFn: async () =>
        unwrap<{ entries: unknown[]; balanceCents: number }>(
          await api.schemes[":schemeId"].lots[":lotId"].statement.$get({
            param: { schemeId, lotId: lot.id },
          }),
        ),
    })),
  });

  const loading = lotsQuery.isPending || statements.some((s) => s.isPending);
  const balanceCents = statements.reduce((sum, s) => sum + (s.data?.balanceCents ?? 0), 0);
  const owes = balanceCents > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>My levies</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <Skeleton className="h-12 w-40" />
        ) : myLots.length === 0 ? (
          <EmptyState
            icon={ReceiptText}
            title="No lot linked to your account yet"
            description="Once your lot is on the register, your levy balance and how to pay will show here."
          />
        ) : (
          <>
            <div>
              <p
                className={cn(
                  "font-mono text-4xl font-bold tabular-nums",
                  owes ? "text-critical" : "text-positive",
                )}
              >
                {formatMoney(Math.abs(balanceCents))}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {owes
                  ? "Amount due"
                  : balanceCents < 0
                    ? "In credit — nothing due right now"
                    : "You're all paid up. Nothing due right now."}
              </p>
            </div>

            <div className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">How to pay</p>
              <p className="mt-1">
                Each levy notice carries its own PayID (on the emailed notice and PDF) — payments to
                it are matched automatically. Bank transfers work too: quote your notice number.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {myLots.map((lot) => (
                <LotStatementDialog
                  key={lot.id}
                  schemeId={schemeId}
                  lotId={lot.id}
                  lotNumber={lot.lotNumber}
                  triggerVariant="outline"
                />
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------- 3. My requests --------------------------------

function MyRequests({ schemeId }: { schemeId: string }) {
  const { data, isPending } = useQuery({
    queryKey: ["maintenance", schemeId],
    queryFn: async () =>
      unwrap<{ requests: MaintenanceRequest[] }>(
        await api.schemes[":schemeId"].maintenance.$get({ param: { schemeId } }),
      ),
    refetchInterval: 3000,
  });

  const open = (data?.requests ?? []).filter((r) => isOpenRequest(r.status)).slice(0, 3);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Requests in your building</CardTitle>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <div className="space-y-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : open.length === 0 ? (
          <EmptyState
            icon={Wrench}
            title="Nothing reported"
            description="If something's wrong, report it and we'll take it from there."
            action={
              <Button asChild variant="outline" size="sm">
                <Link
                  to="/schemes/$schemeId"
                  params={{ schemeId }}
                  search={{ section: "maintenance" }}
                >
                  Report an issue
                </Link>
              </Button>
            }
          />
        ) : (
          <ul className="-my-1 divide-y divide-border">
            {open.map((r) => (
              <li key={r.id} className="flex items-start gap-3 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{r.title}</span>
                  {r.status === "rejected" && r.aiTriage?.declineExplanation ? (
                    <span className="block text-13 text-muted-foreground">
                      {r.aiTriage.declineExplanation}
                    </span>
                  ) : (
                    r.aiTriage?.reasoning && (
                      <span className="block text-13 text-muted-foreground">
                        {r.aiTriage.reasoning}
                      </span>
                    )
                  )}
                </span>
                <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-13 font-medium text-muted-foreground">
                  {ownerStatusLabel(r.status)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------- 4. Next meeting -------------------------------

function NextMeetingCard({
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
      </CardHeader>
      <CardContent>
        {meeting ? (
          <Link
            to="/schemes/$schemeId"
            params={{ schemeId }}
            search={{ section: "meetings", meeting: meeting.id }}
            className="group -m-2 flex items-start gap-3 rounded-md p-2 transition-colors hover:bg-muted"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
              <CalendarDays aria-hidden="true" className="size-4" />
            </span>
            <span className="min-w-0 space-y-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium group-hover:underline">{meeting.title}</span>
                <StatusBadge status={meeting.status} />
              </span>
              <span className="block text-13 text-muted-foreground">
                {MEETING_KIND_LABEL[meeting.kind] ?? meeting.kind}
              </span>
              <span className="block font-mono text-13 tabular-nums">
                {meeting.status === "in_progress" ? (
                  <span className="font-medium text-positive">
                    Happening now — started {formatDateTime(meeting.scheduledAt)}
                  </span>
                ) : (
                  formatDateTime(meeting.scheduledAt)
                )}
              </span>
            </span>
          </Link>
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

// -------------------------- 5. Community teaser -----------------------------

function CommunityTeaser({ schemeId }: { schemeId: string }) {
  const { data, isPending } = useQuery({
    queryKey: ["community", schemeId, "latest"],
    queryFn: async () =>
      unwrap<{ posts: CommunityPost[] }>(
        await api.schemes[":schemeId"].community.posts.$get({ param: { schemeId }, query: {} }),
      ),
  });

  const posts = (data?.posts ?? []).slice(0, 2);

  return (
    <Card>
      <CardHeader>
        <CardTitle>My building</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : posts.length === 0 ? (
          <EmptyState
            icon={MessagesSquare}
            title="Nothing posted yet"
            description="Neighbours' notices and updates for your building will show here."
          />
        ) : (
          <ul className="space-y-3">
            {posts.map((post) => (
              <li key={post.id} className="text-sm">
                <p className="line-clamp-2 text-foreground">{post.body}</p>
                <p className="mt-0.5 text-13 text-muted-foreground">
                  {post.author.name} · {formatDate(post.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
        <Link
          to="/schemes/$schemeId"
          params={{ schemeId }}
          search={{ section: "community" }}
          className="inline-flex items-center gap-1 text-13 font-medium text-primary hover:underline"
        >
          View my building
          <ArrowRight aria-hidden="true" className="size-3.5" />
        </Link>
      </CardContent>
    </Card>
  );
}
