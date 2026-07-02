import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, CircleX, Scale, Users } from "lucide-react";
import { toast } from "sonner";
import { Markdown } from "@/components/Markdown";
import { StatusBadge } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { api, unwrap } from "@/lib/api";
import { formatDate } from "@/lib/format";
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
  decisionNote: string | null;
}

interface VoteTally {
  votes: { userId: string; name: string; choice: string; note: string | null; createdAt: string }[];
  votesFor: number;
  votesAgainst: number;
  eligible: number;
}

/** GET the vote tally; null means the endpoint doesn't exist yet (pre-merge). */
async function fetchVotes(schemeId: string, decisionId: string): Promise<VoteTally | null> {
  const res = await fetch(`/api/schemes/${schemeId}/decisions/${decisionId}/votes`, {
    credentials: "include",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Votes request failed (${res.status})`);
  return (await res.json()) as VoteTally;
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
  const pending = decisions.filter((d) => d.status === "pending");
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
              <Card key={d.id} className="py-3">
                <CardContent className="flex items-center justify-between gap-3 px-4 text-sm">
                  <span className="min-w-0 truncate">{d.title}</span>
                  <StatusBadge status={d.status} />
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}
    </>
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
  const isCommitteeTier = decision.deciderRole.includes("committee");

  return (
    <Card
      data-testid={`decision-${decision.kind}`}
      className="border-l-4 border-l-caution bg-caution/5"
    >
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <CardTitle className="text-base">{decision.title}</CardTitle>
            <CardDescription>
              for the {decision.deciderRole.replace(/_/g, " ")}
              {decision.dueAt ? ` · respond by ${formatDate(decision.dueAt)}` : ""}
            </CardDescription>
          </div>
          <Badge tone="caution">{decision.kind.replace(/_/g, " ")}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border bg-card p-4">
          <Markdown>{decision.summaryMd}</Markdown>
        </div>
        {!mayDecide ? (
          <p className="text-sm text-muted-foreground">
            This decision is with the {decision.deciderRole.replace(/_/g, " ")} — you'll see the
            outcome here.
          </p>
        ) : isCommitteeTier ? (
          <CommitteeVotePanel schemeId={schemeId} decision={decision} onChange={onChange} />
        ) : (
          <ResolveButtons schemeId={schemeId} decision={decision} onChange={onChange} />
        )}
      </CardContent>
    </Card>
  );
}

/** Classic single-decider resolution (also the fallback when /vote is absent). */
function ResolveButtons({
  schemeId,
  decision,
  onChange,
}: {
  schemeId: string;
  decision: Decision;
  onChange: () => void;
}) {
  const resolve = useMutation({
    mutationFn: async (optionId: string) =>
      unwrap(
        await api.schemes[":schemeId"].decisions[":decisionId"].resolve.$post({
          param: { schemeId, decisionId: decision.id },
          json: { optionId },
        }),
      ),
    onSuccess: () => {
      toast.success("Decision recorded");
      onChange();
    },
  });

  return (
    <div>
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
        <p role="alert" className="mt-2 text-[13px] text-critical">
          {resolve.error.message}
        </p>
      )}
    </div>
  );
}

/**
 * Committee-tier decisions collect one vote per committee member.
 * Falls back to the classic resolve buttons when the API doesn't expose
 * the voting endpoints yet.
 */
function CommitteeVotePanel({
  schemeId,
  decision,
  onChange,
}: {
  schemeId: string;
  decision: Decision;
  onChange: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: tally, isLoading } = useQuery({
    queryKey: ["decision-votes", schemeId, decision.id],
    queryFn: () => fetchVotes(schemeId, decision.id),
    retry: false,
  });

  const vote = useMutation({
    mutationFn: async (choice: "approve" | "decline") => {
      const res = await fetch(`/api/schemes/${schemeId}/decisions/${decision.id}/vote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ choice }),
      });
      if (res.status === 404) throw new Error("Voting isn't available yet");
      if (!res.ok) {
        let message = `Vote failed (${res.status})`;
        try {
          const body = (await res.json()) as { error?: { message?: string } };
          message = body.error?.message ?? message;
        } catch {
          // keep status message
        }
        throw new Error(message);
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Vote recorded");
      void queryClient.invalidateQueries({ queryKey: ["decision-votes", schemeId, decision.id] });
      onChange();
    },
  });

  if (isLoading) return <Skeleton className="h-16" />;
  // Endpoint missing — fall back to the single approve/decline flow.
  if (!tally) return <ResolveButtons schemeId={schemeId} decision={decision} onChange={onChange} />;

  const needed = Math.floor(tally.eligible / 2) + 1;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button
          className="w-full sm:w-auto"
          pending={vote.isPending && vote.variables === "approve"}
          disabled={vote.isPending}
          onClick={() => vote.mutate("approve")}
        >
          <CircleCheck aria-hidden="true" className="size-4" /> Vote for
        </Button>
        <Button
          variant="outline"
          className="w-full sm:w-auto"
          pending={vote.isPending && vote.variables === "decline"}
          disabled={vote.isPending}
          onClick={() => vote.mutate("decline")}
        >
          <CircleX aria-hidden="true" className="size-4" /> Vote against
        </Button>
      </div>
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
              <li key={v.userId} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">{v.name}</span>
                <Badge tone={v.choice === "approve" ? "positive" : "critical"}>{v.choice}</Badge>
              </li>
            ))}
          </ul>
        </>
      )}
      {vote.isError && (
        <p role="alert" className="text-[13px] text-critical">
          {vote.error.message}
        </p>
      )}
    </div>
  );
}
