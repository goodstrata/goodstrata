import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { ArrowLeft, Bot, ChevronDown, ChevronRight, Cpu, Zap } from "lucide-react";
import { useState } from "react";
import { Markdown } from "@/components/Markdown";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { stripAgentTags } from "@/lib/agent-text";
import { api, unwrap } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

const schemeRoute = getRouteApi("/schemes/$schemeId");

interface RunSummary {
  id: string;
  agent: string;
  status: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
}

interface StepRecord {
  index: number;
  text: string | null;
  toolCalls: { toolName: string; input: unknown }[];
  toolResults: { toolName: string; output: unknown }[];
}

interface RunDetail extends RunSummary {
  input: { context: string; eventType: string } | null;
  steps: StepRecord[];
  output: { text: string } | null;
}

/**
 * The agent console: every run the agents have made for this scheme, with the
 * full tool-call transcript. This is the "show your work" surface that makes
 * an autonomous manager auditable. The selected run lives in the URL (?run)
 * so it is deep-linkable and survives refresh.
 */
export function AgentsTab({ schemeId }: { schemeId: string }) {
  const { run: selectedRun } = schemeRoute.useSearch();
  const navigate = schemeRoute.useNavigate();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["agent-runs", schemeId],
    queryFn: async () =>
      unwrap<{ runs: RunSummary[] }>(
        await api.schemes[":schemeId"]["agent-runs"].$get({ param: { schemeId }, query: {} }),
      ),
    refetchInterval: 5000,
  });

  if (selectedRun) {
    return (
      <RunDetailView
        schemeId={schemeId}
        runId={selectedRun}
        onBack={() => navigate({ search: (prev) => ({ ...prev, run: undefined }) })}
      />
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        as="h2"
        title="Agents"
        description="Every action an agent takes is a recorded run with a full tool-call transcript."
      />
      <div className="space-y-2.5" data-testid="agent-runs">
        {isLoading && <Skeleton className="h-24" />}
        {isError && (
          <ErrorState message="Couldn't load agent runs." onRetry={() => void refetch()} />
        )}
        {data?.runs.length === 0 && (
          <EmptyState
            icon={Bot}
            title="No agent runs yet"
            description="Runs appear here as events arrive and the agents act on them."
          />
        )}
        {data?.runs.map((run) => (
          <button
            key={run.id}
            type="button"
            onClick={() => navigate({ search: (prev) => ({ ...prev, run: run.id }) })}
            className="group flex w-full items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3.5 text-left shadow-xs transition-colors hover:border-primary/40"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-agent/10 text-agent">
                <Bot aria-hidden="true" className="size-4.5" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{run.agent}</p>
                <p className="flex flex-wrap gap-x-1.5 font-mono text-xs text-muted-foreground">
                  <span>{run.model}</span>
                  <span aria-hidden="true">·</span>
                  <span>{(run.inputTokens + run.outputTokens).toLocaleString()} tok</span>
                  <span aria-hidden="true">·</span>
                  <span>{formatDateTime(run.startedAt)}</span>
                </p>
                {run.error && <p className="line-clamp-2 text-xs text-critical">{run.error}</p>}
              </div>
            </div>
            <span className="flex shrink-0 items-center gap-2">
              <StatusBadge status={run.status} />
              <ChevronRight
                aria-hidden="true"
                className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
              />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The tool-call transcript block: a deliberate terminal card (ink surface,
 * paper text) that reads as machine output distinct from the surrounding page.
 */
function ToolCallBlock({
  call,
  result,
}: {
  call: { toolName: string; input: unknown };
  result: { toolName: string; output: unknown } | undefined;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="overflow-hidden rounded-lg bg-foreground font-mono text-xs text-background">
        <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-background/10">
          <ChevronDown
            aria-hidden="true"
            className={`size-3.5 shrink-0 text-background/60 transition-transform ${open ? "" : "-rotate-90"}`}
          />
          <Zap aria-hidden="true" className="size-3.5 shrink-0 text-background/70" />
          <span className="truncate font-medium">{call.toolName}</span>
          <span className="ml-auto shrink-0 text-background/60">{open ? "hide" : "show"} io</span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-2 border-t border-background/20 px-3 py-2.5">
            <div>
              <p className="mb-1 text-[11px] tracking-wider text-background/70 uppercase">input</p>
              <pre className="max-h-64 overflow-auto break-words whitespace-pre-wrap text-background">
                {JSON.stringify(call.input, null, 2)}
              </pre>
            </div>
            {result && (
              <div>
                <p className="mb-1 text-[11px] tracking-wider text-background/70 uppercase">
                  output
                </p>
                <pre className="max-h-64 overflow-auto break-words whitespace-pre-wrap text-background/90">
                  {JSON.stringify(result.output, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function RunDetailView({
  schemeId,
  runId,
  onBack,
}: {
  schemeId: string;
  runId: string;
  onBack: () => void;
}) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["agent-run", schemeId, runId],
    queryFn: async () =>
      unwrap<{ run: RunDetail }>(
        await api.schemes[":schemeId"]["agent-runs"][":runId"].$get({
          param: { schemeId, runId },
        }),
      ),
    // Keep a running transcript live; stop polling once it settles.
    refetchInterval: (query) => (query.state.data?.run.status === "running" ? 3000 : false),
  });

  return (
    <div className="max-w-3xl space-y-4">
      <Button variant="ghost" size="sm" className="-ml-2" onClick={onBack}>
        <ArrowLeft aria-hidden="true" className="size-4" /> All runs
      </Button>

      {isLoading && <Skeleton className="h-64" />}
      {isError && <ErrorState message="Couldn't load this run." onRetry={() => void refetch()} />}

      {data && <RunDetailCard run={data.run} />}
    </div>
  );
}

function RunDetailCard({ run }: { run: RunDetail }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <CardTitle className="flex items-center gap-2.5 text-base">
            <span className="flex size-9 items-center justify-center rounded-lg bg-agent/10 text-agent">
              <Bot aria-hidden="true" className="size-4.5" />
            </span>
            {run.agent}
          </CardTitle>
          <StatusBadge status={run.status} />
        </div>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 font-mono text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Cpu aria-hidden="true" className="size-3.5" /> {run.model}
          </span>
          <span>triggered by {run.input?.eventType ?? "?"}</span>
          <span>
            in {run.inputTokens.toLocaleString()} / out {run.outputTokens.toLocaleString()} tok
          </span>
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {run.error && (
          <div
            role="alert"
            className="rounded-lg border border-critical/25 bg-critical/8 p-3 text-sm text-critical"
          >
            {run.error}
          </div>
        )}

        {run.input?.context && (
          <Collapsible>
            <CollapsibleTrigger className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
              <ChevronRight
                aria-hidden="true"
                className="size-4 transition-transform [[data-state=open]>&]:rotate-90"
              />
              Context given to the model
            </CollapsibleTrigger>
            <CollapsibleContent>
              <pre className="mt-2 overflow-x-auto rounded-lg border bg-muted/50 p-3 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
                {run.input.context}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        )}

        {run.steps.length > 0 && (
          <ol className="space-y-4">
            {run.steps.map((step) => {
              const text = step.text ? stripAgentTags(step.text) : "";
              return (
                <li key={step.index} className="flex gap-3">
                  <span
                    aria-hidden="true"
                    className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-[11px] tabular-nums text-muted-foreground"
                  >
                    {step.index + 1}
                  </span>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    {text && <p className="text-sm">{text}</p>}
                    {step.toolCalls.map((call, i) => (
                      <ToolCallBlock
                        key={`${step.index}-${call.toolName}-${i}`}
                        call={call}
                        result={step.toolResults[i]}
                      />
                    ))}
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        {run.output?.text && (
          <div className="rounded-lg border border-primary/20 bg-accent/40 p-4">
            <Markdown>{run.output.text}</Markdown>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
