import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Bot, ChevronDown, ChevronRight, Cpu, Zap } from "lucide-react";
import { useState } from "react";
import { Markdown } from "@/components/Markdown";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { stripAgentTags } from "@/lib/agent-text";
import { api, unwrap } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

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
 * an autonomous manager auditable.
 */
export function AgentsTab({ schemeId }: { schemeId: string }) {
  const [selected, setSelected] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: ["agent-runs", schemeId],
    queryFn: async () =>
      unwrap<{ runs: RunSummary[] }>(
        await api.schemes[":schemeId"]["agent-runs"].$get({
          param: { schemeId },
          query: {},
        }),
      ),
    refetchInterval: 5000,
  });

  if (selected) {
    return <RunDetailView schemeId={schemeId} runId={selected} onBack={() => setSelected(null)} />;
  }

  return (
    <div className="max-w-3xl">
      <h3 className="text-base font-semibold">Agent runs</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Every action an agent takes is a recorded run with a full tool-call transcript.
      </p>
      <div className="mt-4 space-y-2.5" data-testid="agent-runs">
        {!data && <Skeleton className="h-24" />}
        {data?.runs.length === 0 && (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No agent runs yet — they appear as events arrive.
          </p>
        )}
        {data?.runs.map((run) => (
          <button
            key={run.id}
            type="button"
            onClick={() => setSelected(run.id)}
            className="group flex w-full items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3.5 text-left shadow-sm transition-colors hover:border-brand-600/60"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-purple-50 text-purple-700">
                <Bot className="size-4.5" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{run.agent}</p>
                <p className="truncate font-mono text-xs text-muted-foreground">
                  {run.model} · {(run.inputTokens + run.outputTokens).toLocaleString()} tok ·{" "}
                  {formatDateTime(run.startedAt)}
                </p>
                {run.error && <p className="truncate text-xs text-destructive">{run.error}</p>}
              </div>
            </div>
            <span className="flex shrink-0 items-center gap-2">
              <StatusBadge status={run.status} />
              <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

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
      <div className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950 font-mono text-xs">
        <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left text-neutral-100 hover:bg-neutral-900">
          <ChevronDown
            className={`size-3.5 shrink-0 text-neutral-500 transition-transform ${open ? "" : "-rotate-90"}`}
          />
          <Zap className="size-3.5 shrink-0 text-amber-400" />
          <span className="truncate text-purple-300">{call.toolName}</span>
          <span className="ml-auto shrink-0 text-neutral-600">{open ? "hide" : "show"} io</span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-2 border-t border-neutral-800 px-3 py-2.5">
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-wider text-neutral-500">input</p>
              <pre className="overflow-x-auto whitespace-pre-wrap break-all text-green-300/90">
                {JSON.stringify(call.input, null, 2)}
              </pre>
            </div>
            {result && (
              <div>
                <p className="mb-1 text-[10px] uppercase tracking-wider text-neutral-500">output</p>
                <pre className="overflow-x-auto whitespace-pre-wrap break-all text-neutral-300">
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
  const { data } = useQuery({
    queryKey: ["agent-run", schemeId, runId],
    queryFn: async () =>
      unwrap<{ run: RunDetail }>(
        await api.schemes[":schemeId"]["agent-runs"][":runId"].$get({
          param: { schemeId, runId },
        }),
      ),
  });

  if (!data) return <Skeleton className="h-64 max-w-3xl" />;
  const run = data.run;

  return (
    <div className="max-w-3xl space-y-4">
      <Button variant="ghost" size="sm" className="-ml-2" onClick={onBack}>
        <ArrowLeft className="size-4" /> All runs
      </Button>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <CardTitle className="flex items-center gap-2.5 text-base">
              <span className="flex size-9 items-center justify-center rounded-lg bg-purple-50 text-purple-700">
                <Bot className="size-4.5" />
              </span>
              {run.agent}
            </CardTitle>
            <StatusBadge status={run.status} />
          </div>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 font-mono text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Cpu className="size-3.5" /> {run.model}
            </span>
            <span>triggered by {run.input?.eventType ?? "?"}</span>
            <span>
              in {run.inputTokens.toLocaleString()} / out {run.outputTokens.toLocaleString()} tok
            </span>
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {run.input?.context && (
            <Collapsible>
              <CollapsibleTrigger className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
                <ChevronRight className="size-4 transition-transform [[data-state=open]>&]:rotate-90" />
                Context given to the model
              </CollapsibleTrigger>
              <CollapsibleContent>
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg border bg-muted/50 p-3 font-mono text-xs text-muted-foreground">
                  {run.input.context}
                </pre>
              </CollapsibleContent>
            </Collapsible>
          )}

          {run.steps.length > 0 && (
            <ol className="relative space-y-4 border-l border-border pl-5">
              {run.steps.map((step) => (
                <li key={step.index} className="relative">
                  <span className="absolute top-1 -left-[27px] flex size-4 items-center justify-center rounded-full bg-muted font-mono text-[9px] text-muted-foreground ring-4 ring-background">
                    {step.index + 1}
                  </span>
                  {step.text && stripAgentTags(step.text) && (
                    <p className="mb-2 text-sm">{stripAgentTags(step.text)}</p>
                  )}
                  <div className="space-y-1.5">
                    {step.toolCalls.map((call, i) => (
                      <ToolCallBlock
                        key={`${step.index}-${call.toolName}-${i}`}
                        call={call}
                        result={step.toolResults[i]}
                      />
                    ))}
                  </div>
                </li>
              ))}
            </ol>
          )}

          {run.output?.text && (
            <div className="rounded-lg border border-brand-100 bg-brand-50/60 p-4">
              <Markdown>{run.output.text}</Markdown>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
