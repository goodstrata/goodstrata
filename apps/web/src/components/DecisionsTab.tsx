import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, CircleCheck, CircleX, Scale, Users } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Markdown } from "@/components/Markdown";
import { StatusBadge } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api, unwrap } from "@/lib/api";
import { useSession } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/format";
import { canDecide, useSchemeRoles } from "@/lib/roles";

interface Decision {
  id: string;
  kind: string;
  title: string;
  summaryMd: string;
  options: { id: string; label: string }[];
  evidence: unknown[];
  deciderRole: string;
  status: string;
  dueAt: string | null;
  createdAt: string;
  resolvedAt: string | null;
  decidedByName: string | null;
  decisionNote: string | null;
  resolution: { optionId?: string } | null;
}

interface VoteTally {
  votes: { userId: string; name: string; choice: string; note: string | null; createdAt: string }[];
  votesFor: number;
  votesAgainst: number;
  eligible: number;
}

function optionLabel(decision: Decision, optionId: string | undefined): string | null {
  if (!optionId) return null;
  return decision.options.find((o) => o.id === optionId)?.label ?? optionId;
}

function isOverdue(decision: Decision): boolean {
  return decision.dueAt !== null && new Date(decision.dueAt).getTime() < Date.now();
}

export function DecisionsTab({ schemeId }: { schemeId: string }) {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["decisions", schemeId],
    queryFn: async () =>
      unwrap<{ decisions: Decision[] }>(
        await api.schemes[":schemeId"].decisions.$get({ param: { schemeId }, query: {} }),
      ),
    refetchInterval: 5000,
  });
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["decisions", schemeId] });
    void queryClient.invalidateQueries({ queryKey: ["budgets", schemeId] });
  };

  return (
    <div className="max-w-2xl space-y-8">
      <PageHeader
        as="h2"
        title="Decisions"
        description="Choices the agents have prepared and put to the people who hold the authority."
      />

      {isLoading && <Skeleton className="h-40" />}
      {isError && <ErrorState message="Couldn't load decisions." onRetry={() => void refetch()} />}

      {data && (
        <DecisionLists schemeId={schemeId} decisions={data.decisions} onChange={invalidate} />
      )}
    </div>
  );
}

function DecisionLists({
  schemeId,
  decisions,
  onChange,
}: {
  schemeId: string;
  decisions: Decision[];
  onChange: () => void;
}) {
  const roles = useSchemeRoles(schemeId);
  // Most urgent first: overdue, then nearest due date, then oldest request.
  const pending = decisions
    .filter((d) => d.status === "pending")
    .sort((a, b) => {
      const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Number.POSITIVE_INFINITY;
      const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Number.POSITIVE_INFINITY;
      if (aDue !== bDue) return aDue - bDue;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
  const resolved = decisions.filter((d) => d.status !== "pending");
  const actionable = pending.some((d) => canDecide(roles, d.deciderRole));

  return (
    <>
      <section>
        {pending.length === 0 ? (
          <EmptyState
            icon={Scale}
            title="Nothing to decide"
            description="The agents have it covered — decisions that need a person appear here."
          />
        ) : (
          <>
            <h2 className="text-base font-semibold">
              {actionable ? "Waiting on you" : "Pending decisions"}
            </h2>
            <div className="mt-3 space-y-4">
              {pending.map((d) => (
                <PendingDecisionCard
                  key={d.id}
                  schemeId={schemeId}
                  decision={d}
                  onChange={onChange}
                />
              ))}
            </div>
          </>
        )}
      </section>

      {resolved.length > 0 && (
        <section>
          <h2 className="text-base font-semibold">History</h2>
          <div className="mt-3 space-y-2">
            {resolved.map((d) => (
              <ResolvedDecisionRow key={d.id} decision={d} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

/** Audit-trail row: outcome at a glance, full who/when/why on expand. */
function ResolvedDecisionRow({ decision }: { decision: Decision }) {
  const [open, setOpen] = useState(false);
  const chosen = optionLabel(decision, decision.resolution?.optionId ?? undefined);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="gap-0 py-0">
        <CollapsibleTrigger
          className={`flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-muted/50 ${open ? "rounded-t-xl" : "rounded-xl"}`}
        >
          <ChevronDown
            aria-hidden="true"
            className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`}
          />
          <span className="min-w-0 flex-1 truncate">{decision.title}</span>
          {decision.resolvedAt && (
            <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
              {formatDate(decision.resolvedAt)}
            </span>
          )}
          <StatusBadge status={decision.status} />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-3 border-t px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
              <Badge tone="neutral">{decision.kind.replace(/_/g, " ")}</Badge>
              {chosen && <span>“{chosen}”</span>}
              {decision.decidedByName && <span>by {decision.decidedByName}</span>}
              {decision.resolvedAt && <span>on {formatDateTime(decision.resolvedAt)}</span>}
            </div>
            {decision.decisionNote && (
              <p className="border-l-2 pl-3 text-muted-foreground italic">
                {decision.decisionNote}
              </p>
            )}
            <div className="rounded-lg border bg-card p-3">
              <Markdown>{decision.summaryMd}</Markdown>
            </div>
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

function PendingDecisionCard({
  schemeId,
  decision,
  onChange,
}: {
  schemeId: string;
  decision: Decision;
  onChange: () => void;
}) {
  const roles = useSchemeRoles(schemeId);
  const mayDecide = canDecide(roles, decision.deciderRole);
  // Every tier except the single-officer treasurer collects one vote per person.
  const isMultiVoter = decision.deciderRole !== "treasurer";
  const overdue = isOverdue(decision);

  return (
    <Card
      data-testid={`decision-${decision.kind}`}
      className={
        overdue
          ? "border-l-4 border-l-critical bg-critical/5"
          : "border-l-4 border-l-caution bg-caution/5"
      }
    >
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <CardTitle className="text-base">{decision.title}</CardTitle>
            <CardDescription>
              for the {decision.deciderRole.replace(/_/g, " ")}
              {decision.dueAt ? (
                <>
                  {" · "}
                  <span className={overdue ? "font-medium text-critical" : undefined}>
                    respond by {formatDate(decision.dueAt)}
                  </span>
                </>
              ) : null}
            </CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {overdue && <StatusBadge status="overdue" />}
            <Badge tone="caution">{decision.kind.replace(/_/g, " ")}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border bg-card p-4">
          <Markdown>{decision.summaryMd}</Markdown>
        </div>
        {!mayDecide ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              This decision is with the {decision.deciderRole.replace(/_/g, " ")} — you'll see the
              outcome here.
            </p>
            {isMultiVoter && (
              <CommitteeVotePanel
                schemeId={schemeId}
                decision={decision}
                onChange={onChange}
                readOnly
              />
            )}
          </div>
        ) : isMultiVoter ? (
          <CommitteeVotePanel schemeId={schemeId} decision={decision} onChange={onChange} />
        ) : (
          <ResolveButtons schemeId={schemeId} decision={decision} onChange={onChange} />
        )}
      </CardContent>
    </Card>
  );
}

/** Optional note recorded against the vote/resolution for the minutes. */
function NoteField({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-13 text-muted-foreground">
        Note for the record (optional)
      </Label>
      <Textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        maxLength={2000}
        placeholder="Why you decided this way — kept with the decision."
        className="min-h-9 bg-card"
      />
    </div>
  );
}

/** Classic single-decider resolution (also the fallback when voting is unavailable). */
function ResolveButtons({
  schemeId,
  decision,
  onChange,
}: {
  schemeId: string;
  decision: Decision;
  onChange: () => void;
}) {
  const noteId = useId();
  const [note, setNote] = useState("");
  const resolve = useMutation({
    mutationFn: async (optionId: string) =>
      unwrap(
        await api.schemes[":schemeId"].decisions[":decisionId"].resolve.$post({
          param: { schemeId, decisionId: decision.id },
          json: { optionId, note: note.trim() || undefined },
        }),
      ),
    onSuccess: () => {
      toast.success("Decision recorded");
      onChange();
    },
  });

  return (
    <div className="space-y-3">
      <NoteField id={noteId} value={note} onChange={setNote} disabled={resolve.isPending} />
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {decision.options.map((o) => (
          <Button
            key={o.id}
            className="w-full sm:w-auto"
            variant={o.id === "approve" ? "default" : "outline"}
            pending={resolve.isPending && resolve.variables === o.id}
            disabled={resolve.isPending}
            onClick={() => resolve.mutate(o.id)}
          >
            {o.label}
          </Button>
        ))}
      </div>
      {resolve.isError && (
        <p role="alert" className="text-13 text-critical">
          {resolve.error.message}
        </p>
      )}
    </div>
  );
}

/** The running tally: badges, majority progress, and who voted which way. */
function VoteTallyView({ tally }: { tally: VoteTally }) {
  const needed = Math.floor(tally.eligible / 2) + 1;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge tone="positive">{tally.votesFor} for</Badge>
        {tally.votesAgainst > 0 && <Badge tone="critical">{tally.votesAgainst} against</Badge>}
        <span className="flex items-center gap-1 text-muted-foreground">
          <Users aria-hidden="true" className="size-3.5" />
          {needed} needed · {tally.eligible} eligible
        </span>
      </div>
      <Progress
        value={(tally.votesFor / Math.max(needed, 1)) * 100}
        aria-label={`${tally.votesFor} of ${needed} votes needed to carry`}
        className="h-1.5"
      />
      {tally.votes.length > 0 && (
        <>
          <Separator />
          <ul className="space-y-1.5 text-sm">
            {tally.votes.map((v) => (
              <li key={v.userId} className="space-y-0.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate" title={formatDateTime(v.createdAt)}>
                    {v.name}
                  </span>
                  <Badge tone={v.choice === "approve" ? "positive" : "critical"}>{v.choice}</Badge>
                </div>
                {v.note && (
                  <p className="border-l-2 pl-2 text-13 text-muted-foreground italic">{v.note}</p>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

/**
 * Multi-voter tiers (committee, all owners) collect one vote per person.
 * `readOnly` shows the running tally to members who can't vote. Falls back
 * to the classic resolve buttons if the tally can't be loaded (resolving
 * casts the caller's vote through the same tally underneath).
 */
function CommitteeVotePanel({
  schemeId,
  decision,
  onChange,
  readOnly = false,
}: {
  schemeId: string;
  decision: Decision;
  onChange: () => void;
  readOnly?: boolean;
}) {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const noteId = useId();
  const [note, setNote] = useState("");
  const {
    data: tally,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["decision-votes", schemeId, decision.id],
    queryFn: async () =>
      unwrap<VoteTally>(
        await api.schemes[":schemeId"].decisions[":decisionId"].votes.$get({
          param: { schemeId, decisionId: decision.id },
        }),
      ),
    retry: false,
    refetchInterval: 5000,
  });

  const vote = useMutation({
    mutationFn: async (choice: "approve" | "decline") =>
      unwrap(
        await api.schemes[":schemeId"].decisions[":decisionId"].vote.$post({
          param: { schemeId, decisionId: decision.id },
          json: { choice, note: note.trim() || undefined },
        }),
      ),
    onSuccess: () => {
      toast.success("Vote recorded");
      void queryClient.invalidateQueries({ queryKey: ["decision-votes", schemeId, decision.id] });
      onChange();
    },
  });

  if (readOnly) {
    // Silent while loading/unavailable — the parent already explains whose
    // decision this is; the tally is a bonus, not a blocker.
    if (!tally) return null;
    return (
      <div className="space-y-3">
        <VoteTallyView tally={tally} />
      </div>
    );
  }

  if (isLoading) return <Skeleton className="h-16" />;
  // Tally unavailable — fall back to the single approve/decline flow.
  if (isError || !tally)
    return <ResolveButtons schemeId={schemeId} decision={decision} onChange={onChange} />;

  const myVote = tally.votes.find((v) => v.userId === session?.user?.id);
  // Custom option labels (e.g. "Acknowledge" / "Flag for discussion") ride on
  // the approve/decline ids that the vote endpoint accepts.
  const forLabel = optionLabel(decision, "approve") ?? "Vote for";
  const againstLabel = optionLabel(decision, "decline") ?? "Vote against";

  return (
    <div className="space-y-3">
      {myVote ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          {myVote.choice === "approve" ? (
            <CircleCheck aria-hidden="true" className="size-4 text-positive" />
          ) : (
            <CircleX aria-hidden="true" className="size-4 text-critical" />
          )}
          You voted {myVote.choice === "approve" ? "for" : "against"} — waiting on the other
          eligible voters.
        </p>
      ) : (
        <>
          <NoteField id={noteId} value={note} onChange={setNote} disabled={vote.isPending} />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button
              className="w-full sm:w-auto"
              pending={vote.isPending && vote.variables === "approve"}
              disabled={vote.isPending}
              onClick={() => vote.mutate("approve")}
            >
              <CircleCheck aria-hidden="true" className="size-4" /> {forLabel}
            </Button>
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              pending={vote.isPending && vote.variables === "decline"}
              disabled={vote.isPending}
              onClick={() => vote.mutate("decline")}
            >
              <CircleX aria-hidden="true" className="size-4" /> {againstLabel}
            </Button>
          </div>
        </>
      )}
      <VoteTallyView tally={tally} />
      {vote.isError && (
        <p role="alert" className="text-13 text-critical">
          {vote.error.message}
        </p>
      )}
    </div>
  );
}
