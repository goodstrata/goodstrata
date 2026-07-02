import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, unwrap } from "../lib/api";

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

const STATUS_COLOURS: Record<string, string> = {
  succeeded: "bg-green-100 text-green-800",
  awaiting_decision: "bg-amber-100 text-amber-800",
  running: "bg-blue-100 text-blue-800",
  failed: "bg-red-100 text-red-800",
};

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
    <div>
      <p className="text-sm text-gray-500">
        Every action an agent takes is a recorded run with a full tool-call transcript.
      </p>
      <div className="mt-3 space-y-2" data-testid="agent-runs">
        {data?.runs.length === 0 && (
          <p className="text-sm text-gray-400">No agent runs yet — they appear as events arrive.</p>
        )}
        {data?.runs.map((run) => (
          <button
            key={run.id}
            type="button"
            onClick={() => setSelected(run.id)}
            className="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3 text-left hover:border-brand-600"
          >
            <div>
              <p className="text-sm font-medium">🤖 {run.agent}</p>
              <p className="text-xs text-gray-500">
                {run.model} · {run.inputTokens + run.outputTokens} tokens ·{" "}
                {new Date(run.startedAt).toLocaleString()}
              </p>
              {run.error && <p className="text-xs text-red-600">{run.error}</p>}
            </div>
            <span
              className={`rounded-full px-2 py-0.5 text-xs ${STATUS_COLOURS[run.status] ?? "bg-gray-100 text-gray-700"}`}
            >
              {run.status.replace("_", " ")}
            </span>
          </button>
        ))}
      </div>
    </div>
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

  if (!data) return <p className="text-gray-500">Loading…</p>;
  const run = data.run;

  return (
    <div className="space-y-3">
      <button type="button" onClick={onBack} className="text-sm text-brand-700 hover:underline">
        ← All runs
      </button>
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">🤖 {run.agent}</h2>
          <span
            className={`rounded-full px-2 py-0.5 text-xs ${STATUS_COLOURS[run.status] ?? "bg-gray-100"}`}
          >
            {run.status.replace("_", " ")}
          </span>
        </div>
        <p className="mt-1 text-xs text-gray-500">
          {run.model} · triggered by {run.input?.eventType ?? "?"} · in {run.inputTokens} / out{" "}
          {run.outputTokens} tokens
        </p>

        {run.input?.context && (
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-medium text-gray-700">
              Context given to the model
            </summary>
            <pre className="mt-1 whitespace-pre-wrap rounded bg-gray-50 p-3 text-xs text-gray-700">
              {run.input.context}
            </pre>
          </details>
        )}

        <div className="mt-3 space-y-2">
          {run.steps.map((step) => (
            <div key={step.index} className="rounded border border-gray-100 bg-gray-50 p-3">
              <p className="text-xs font-medium text-gray-500">Step {step.index + 1}</p>
              {step.text && <p className="mt-1 text-sm">{step.text}</p>}
              {step.toolCalls.map((call, i) => (
                <div key={`${step.index}-${call.toolName}-${i}`} className="mt-2">
                  <p className="font-mono text-xs text-purple-700">→ {call.toolName}</p>
                  <pre className="mt-0.5 overflow-x-auto whitespace-pre-wrap rounded bg-white p-2 text-xs text-gray-600">
                    {JSON.stringify(call.input, null, 2)}
                  </pre>
                  {step.toolResults[i] && (
                    <pre className="mt-0.5 overflow-x-auto whitespace-pre-wrap rounded bg-white p-2 text-xs text-gray-500">
                      {JSON.stringify(step.toolResults[i]!.output, null, 2)}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>

        {run.output?.text && (
          <p className="mt-3 rounded bg-brand-50 p-3 text-sm text-gray-800">{run.output.text}</p>
        )}
      </div>
    </div>
  );
}
