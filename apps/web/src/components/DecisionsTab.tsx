import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, CircleX, Users } from "lucide-react";
import { toast } from "sonner";
import { Markdown } from "@/components/Markdown";
import { StatusBadge } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { api, unwrap } from "@/lib/api";
import { formatDate } from "@/lib/format";

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
  const { data } = useQuery({
    queryKey: ["decisions", schemeId],
    queryFn: async () =>
      unwrap<{ decisions: Decision[] }>(
        await api.schemes[":schemeId"].decisions.$get({ param: { schemeId }, query: {} }),
      ),
  });
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["decisions", schemeId] });
    void queryClient.invalidateQueries({ queryKey: ["budgets", schemeId] });
  };

  if (!data) return <Skeleton className="h-40 max-w-3xl" />;

  const pending = data.decisions.filter((d) => d.status === "pending");
  const resolved = data.decisions.filter((d) => d.status !== "pending");

  return (
    <div className="max-w-3xl space-y-8">
      <section>
        <h3 className="text-base font-semibold">Waiting on you</h3>
        {pending.length === 0 && (
          <p className="mt-3 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            Nothing to decide — the agents have it covered.
          </p>
        )}
        <div className="mt-3 space-y-4">
          {pending.map((d) => (
            <PendingDecisionCard
              key={d.id}
              schemeId={schemeId}
              decision={d}
              onChange={invalidate}
            />
          ))}
        </div>
      </section>

      {resolved.length > 0 && (
        <section>
          <h3 className="text-base font-semibold">History</h3>
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
    </div>
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
  const isCommitteeTier = decision.deciderRole.includes("committee");

  return (
    <Card data-testid={`decision-${decision.kind}`} className="border-amber-200 bg-amber-50/50">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <CardTitle className="text-base">{decision.title}</CardTitle>
            <CardDescription>
              for the {decision.deciderRole.replace(/_/g, " ")}
              {decision.dueAt ? ` · respond by ${formatDate(decision.dueAt)}` : ""}
            </CardDescription>
          </div>
          <Badge variant="outline" className="border-amber-300 bg-amber-100 text-amber-900">
            {decision.kind.replace(/_/g, " ")}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border border-amber-100 bg-card p-4">
          <Markdown>{decision.summaryMd}</Markdown>
        </div>
        {isCommitteeTier ? (
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
    onError: (e) => toast.error(e.message),
  });

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {decision.options.map((o) => (
          <Button
            key={o.id}
            variant={o.id === "approve" ? "default" : "outline"}
            disabled={resolve.isPending}
            onClick={() => resolve.mutate(o.id)}
          >
            {o.label}
          </Button>
        ))}
      </div>
      {resolve.error && <p className="mt-2 text-sm text-destructive">{resolve.error.message}</p>}
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
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) return <Skeleton className="h-16" />;
  // Endpoint missing — fall back to the single approve/decline flow.
  if (!tally) return <ResolveButtons schemeId={schemeId} decision={decision} onChange={onChange} />;

  const needed = Math.floor(tally.eligible / 2) + 1;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={vote.isPending} onClick={() => vote.mutate("approve")}>
          <CircleCheck className="size-4" /> Vote for
        </Button>
        <Button variant="outline" disabled={vote.isPending} onClick={() => vote.mutate("decline")}>
          <CircleX className="size-4" /> Vote against
        </Button>
        <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <Users className="size-3.5" />
          {tally.votesFor} of {needed} needed · {tally.eligible} eligible
        </span>
      </div>
      <Progress value={(tally.votesFor / Math.max(needed, 1)) * 100} className="h-1.5" />
      {tally.votes.length > 0 && (
        <>
          <Separator />
          <ul className="space-y-1.5 text-sm">
            {tally.votes.map((v) => (
              <li key={v.userId} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">{v.name}</span>
                <Badge
                  variant="outline"
                  className={
                    v.choice === "approve"
                      ? "border-green-200 bg-green-50 text-green-700"
                      : "border-red-200 bg-red-50 text-red-700"
                  }
                >
                  {v.choice}
                </Badge>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
