import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { ArrowLeft, ArrowUpRight, Bot, ChevronRight, Cpu, Zap } from "lucide-react";
import { Fragment } from "react";
import { Markdown } from "@/components/Markdown";
import { StatusBadge } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { stripAgentTags } from "@/lib/agent-text";
import { api, unwrap } from "@/lib/api";
import { formatDateTime, formatTime } from "@/lib/format";

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

/** An event the run published on the register (agent.run.* lifecycle excluded). */
interface RunEffect {
  id: string;
  seq: number;
  type: string;
  stream: string;
  occurredAt: string;
}

interface RunTrigger {
  type: string;
  stream: string;
  occurredAt: string;
}

interface RunDetailResponse {
  run: RunDetail;
  trigger: RunTrigger | null;
  effects: RunEffect[];
}

/**
 * The agent console: every run the agents have made for this scheme. The list
 * is the register; the detail leads with the outcome (what the agent did and
 * what it put on the record, with links), then the step timeline, with raw
 * tool IO and the model context behind per-step disclosures. The selected run
 * lives in the URL (?run) so it is deep-linkable and survives refresh.
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

// ---------------------------------------------------------------------------
// Run detail
// ---------------------------------------------------------------------------

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
      unwrap<RunDetailResponse>(
        await api.schemes[":schemeId"]["agent-runs"][":runId"].$get({
          param: { schemeId, runId },
        }),
      ),
    // Keep a running transcript live; stop polling once it settles.
    refetchInterval: (query) => (query.state.data?.run.status === "running" ? 3000 : false),
  });

  return (
    <div className="max-w-3xl space-y-5">
      <Button variant="ghost" size="sm" className="-ml-2" onClick={onBack}>
        <ArrowLeft aria-hidden="true" className="size-4" /> All runs
      </Button>

      {isLoading && <Skeleton className="h-64" />}
      {isError && <ErrorState message="Couldn't load this run." onRetry={() => void refetch()} />}

      {data && <RunDetailBody data={data} />}
    </div>
  );
}

function RunDetailBody({ data }: { data: RunDetailResponse }) {
  const { run, trigger, effects } = data;
  const outcomeText = run.output?.text ? stripAgentTags(run.output.text) : null;
  const triggerType = trigger?.type ?? run.input?.eventType;
  const duration = runDuration(run.startedAt, run.finishedAt);

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-agent/10 text-agent">
            <Bot aria-hidden="true" className="size-4.5" />
          </span>
          <h2 className="text-lg font-semibold">
            <span className="capitalize">{run.agent}</span> agent
          </h2>
          <StatusBadge status={run.status} />
        </div>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-muted-foreground">
          <span>triggered by {triggerType ?? "?"}</span>
          <span className="flex items-center gap-1">
            <Cpu aria-hidden="true" className="size-3.5" /> {run.model}
          </span>
          <span>
            {run.inputTokens.toLocaleString()} in / {run.outputTokens.toLocaleString()} out tok
          </span>
          <span>{formatDateTime(run.startedAt)}</span>
          {duration && <span>in {duration}</span>}
        </p>
      </div>

      {run.error && (
        <div role="alert" className="rounded-lg border border-critical/25 bg-critical/10 p-4">
          <p className="text-sm font-semibold text-critical">The run failed</p>
          <p className="mt-1 break-words font-mono text-xs text-critical">{run.error}</p>
        </div>
      )}

      {run.status === "running" && (
        <div
          aria-live="polite"
          className="flex items-center gap-2 rounded-lg border border-agent/25 bg-agent/5 px-3.5 py-2.5 text-sm text-agent"
        >
          <Spinner size="sm" /> Running — this page updates live as the agent works.
        </div>
      )}

      {outcomeText && (
        <section className="rounded-lg border border-agent/25 bg-agent/5 p-4">
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Outcome</p>
          <Markdown>{outcomeText}</Markdown>
        </section>
      )}

      {effects.length > 0 ? (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">On the record</h3>
          <ul className="divide-y rounded-lg border">
            {effects.map((effect) => (
              <EffectRow key={effect.id} effect={effect} />
            ))}
          </ul>
        </section>
      ) : (
        run.status === "succeeded" && (
          <p className="text-sm text-muted-foreground">
            This run recorded no changes on the register.
          </p>
        )
      )}

      <StepsTimeline
        steps={run.steps}
        outcomeText={outcomeText}
        running={run.status === "running"}
      />

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
    </div>
  );
}

function runDuration(startedAt: string, finishedAt: string | null): string | null {
  if (!finishedAt) return null;
  const seconds = Math.round((+new Date(finishedAt) - +new Date(startedAt)) / 1000);
  if (seconds < 0) return null;
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

// ---------------------------------------------------------------------------
// On the record — the run's effects, each linked to its register section
// ---------------------------------------------------------------------------

type SectionKey =
  | "overview"
  | "finance"
  | "maintenance"
  | "meetings"
  | "decisions"
  | "grievances"
  | "compliance"
  | "lots"
  | "people"
  | "documents"
  | "community";

/** Event stream prefix → where that record lives in the register. */
const STREAM_SECTIONS: Record<string, { section: SectionKey; label: string }> = {
  maintenance_request: { section: "maintenance", label: "Maintenance" },
  work_order: { section: "maintenance", label: "Maintenance" },
  rfq: { section: "maintenance", label: "Maintenance" },
  quote: { section: "maintenance", label: "Maintenance" },
  decision: { section: "decisions", label: "Decisions" },
  meeting: { section: "meetings", label: "Meetings" },
  motion: { section: "meetings", label: "Meetings" },
  budget: { section: "finance", label: "Finance" },
  levy_schedule: { section: "finance", label: "Finance" },
  levy_notice: { section: "finance", label: "Finance" },
  invoice: { section: "finance", label: "Finance" },
  payment: { section: "finance", label: "Finance" },
  bank_account: { section: "finance", label: "Finance" },
  complaint: { section: "grievances", label: "Grievances" },
  breach_notice: { section: "grievances", label: "Grievances" },
  compliance_obligation: { section: "compliance", label: "Compliance" },
  document: { section: "documents", label: "Documents" },
  lot: { section: "lots", label: "Lots" },
  person: { section: "people", label: "People" },
  community_post: { section: "community", label: "Community" },
  announcement: { section: "community", label: "Community" },
  conversation: { section: "community", label: "Community" },
  message: { section: "community", label: "Community" },
  scheme: { section: "overview", label: "Overview" },
};

function streamTarget(stream: string) {
  const separator = stream.indexOf(":");
  if (separator === -1) return null;
  const prefix = stream.slice(0, separator);
  const id = stream.slice(separator + 1);
  const hit = STREAM_SECTIONS[prefix];
  if (!hit) return null;
  return { ...hit, meeting: prefix === "meeting" && id !== "standing" ? id : undefined };
}

function EffectRow({ effect }: { effect: RunEffect }) {
  const navigate = schemeRoute.useNavigate();
  const target = streamTarget(effect.stream);
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5">
      <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-agent" />
      <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium">{effect.type}</span>
      {target && (
        <button
          type="button"
          onClick={() =>
            navigate({
              search: (prev) => ({
                ...prev,
                section: target.section,
                run: undefined,
                meeting: target.meeting,
              }),
            })
          }
          className="inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-primary hover:underline"
        >
          View in {target.label}
          <ArrowUpRight aria-hidden="true" className="size-3" />
        </button>
      )}
      <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
        {formatTime(effect.occurredAt)}
      </span>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Step timeline — narrative once, tool IO behind per-step disclosure
// ---------------------------------------------------------------------------

function StepsTimeline({
  steps,
  outcomeText,
  running,
}: {
  steps: StepRecord[];
  outcomeText: string | null;
  running: boolean;
}) {
  // The final step's narration is usually byte-identical to the run output —
  // the outcome card already shows it, so it is elided here, and steps left
  // with nothing to say are dropped entirely.
  const items = steps
    .map((step) => {
      const text = step.text ? stripAgentTags(step.text) : "";
      return { ...step, displayText: text === outcomeText ? "" : text };
    })
    .filter((step) => step.displayText || step.toolCalls.length > 0);
  if (items.length === 0) return null;

  return (
    <section className="space-y-2.5">
      <h3 className="text-sm font-semibold">Steps</h3>
      <ol className="space-y-4 border-l border-border pl-6">
        {items.map((step) => (
          <li key={step.index} className="relative space-y-1.5">
            <span
              aria-hidden="true"
              className="absolute top-1 -left-[30px] size-2.5 rounded-full bg-agent ring-4 ring-background"
            />
            {step.displayText && <p className="text-sm">{step.displayText}</p>}
            {step.toolCalls.map((call, i) => (
              <ToolCallRow
                key={`${step.index}-${call.toolName}-${i}`}
                call={call}
                result={step.toolResults[i]}
                running={running}
              />
            ))}
          </li>
        ))}
      </ol>
    </section>
  );
}

function ToolCallRow({
  call,
  result,
  running,
}: {
  call: { toolName: string; input: unknown };
  result: { toolName: string; output: unknown } | undefined;
  running: boolean;
}) {
  // defineAgentTool returns { ok: false, error } instead of throwing — that
  // failure is the interesting part, so it shows without expanding anything.
  const failure =
    result && isPlainRecord(result.output) && result.output.ok === false
      ? String(result.output.error ?? "failed")
      : null;

  return (
    <Collapsible>
      <div className="rounded-lg border">
        <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-muted/50">
          <ChevronRight
            aria-hidden="true"
            className="size-3.5 shrink-0 text-muted-foreground transition-transform [[data-state=open]>&]:rotate-90"
          />
          <Zap aria-hidden="true" className="size-3.5 shrink-0 text-agent" />
          <span className="truncate font-mono text-xs font-medium">{call.toolName}</span>
          {failure && <Badge tone="critical">tool failed</Badge>}
          {!result && running && <Spinner size="sm" className="text-agent" />}
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">input & result</span>
        </CollapsibleTrigger>
        {failure && (
          <p className="border-t px-3 py-2 font-mono text-xs break-words text-critical">
            {failure}
          </p>
        )}
        <CollapsibleContent>
          <div className="space-y-3 border-t px-3 py-2.5">
            <section>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">Input</p>
              {isPlainRecord(call.input) ? (
                <FieldRows record={call.input} />
              ) : (
                <RawValue value={call.input} />
              )}
            </section>
            {result && !failure && (
              <section>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">What it returned</p>
                <ResultDiff input={call.input} output={result.output} />
              </section>
            )}
            {!result && !running && (
              <p className="text-xs text-muted-foreground">
                No result was recorded — the run ended before this tool returned.
              </p>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

const isPlainRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Long prose fields (specMd, explanations…) render as markdown, not escaped JSON. */
const isLongText = (v: unknown): v is string =>
  typeof v === "string" && (v.length > 120 || v.includes("\n"));

const canon = (v: unknown) => JSON.stringify(v) ?? "undefined";

/**
 * A tool result usually echoes the record it wrote — most fields byte-identical
 * to the input. Show only what the tool ADDED or CHANGED; name the echoes.
 */
function ResultDiff({ input, output }: { input: unknown; output: unknown }) {
  if (!isPlainRecord(output)) return <RawValue value={output} />;
  if (Object.keys(output).length === 1 && output.ok === true) {
    return <p className="text-xs text-muted-foreground">Done — the tool returned no data.</p>;
  }
  if (!isPlainRecord(input)) return <FieldRows record={output} />;

  const changed: Record<string, unknown> = {};
  const unchanged: string[] = [];
  for (const [key, value] of Object.entries(output)) {
    if (key in input && canon(input[key]) === canon(value)) unchanged.push(key);
    else changed[key] = value;
  }
  return (
    <div className="space-y-2">
      {Object.keys(changed).length > 0 ? (
        <FieldRows record={changed} />
      ) : (
        <p className="text-xs text-muted-foreground">Confirmed the input — nothing new.</p>
      )}
      {unchanged.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Echoes the input unchanged for <span className="font-mono">{unchanged.join(", ")}</span>.
        </p>
      )}
    </div>
  );
}

function FieldRows({ record }: { record: Record<string, unknown> }) {
  const entries = Object.entries(record).filter(([, v]) => v !== undefined);
  const shorts = entries.filter(([, v]) => !isLongText(v));
  const longs = entries.filter(([, v]) => isLongText(v));
  return (
    <div className="space-y-2">
      {shorts.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          {shorts.map(([key, value]) => (
            <Fragment key={key}>
              <dt className="font-mono text-xs text-muted-foreground">{key}</dt>
              <dd className="min-w-0 font-mono text-xs break-words">
                {typeof value === "string" ? value : canon(value)}
              </dd>
            </Fragment>
          ))}
        </dl>
      )}
      {longs.map(([key, value]) => (
        <div key={key}>
          <p className="mb-1 font-mono text-xs text-muted-foreground">{key}</p>
          <div className="rounded-md border bg-card px-3 py-2">
            <Markdown>{String(value)}</Markdown>
          </div>
        </div>
      ))}
    </div>
  );
}

function RawValue({ value }: { value: unknown }) {
  return (
    <pre className="max-h-64 overflow-auto rounded-md border bg-muted/50 p-2.5 font-mono text-xs break-words whitespace-pre-wrap">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
