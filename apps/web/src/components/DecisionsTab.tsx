import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "../lib/api";

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

export function DecisionsTab({ schemeId }: { schemeId: string }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["decisions", schemeId],
    queryFn: async () =>
      unwrap<{ decisions: Decision[] }>(
        await api.schemes[":schemeId"].decisions.$get({ param: { schemeId }, query: {} }),
      ),
  });
  const resolve = useMutation({
    mutationFn: async (input: { decisionId: string; optionId: string }) =>
      unwrap(
        await api.schemes[":schemeId"].decisions[":decisionId"].resolve.$post({
          param: { schemeId, decisionId: input.decisionId },
          json: { optionId: input.optionId },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["decisions", schemeId] });
      void queryClient.invalidateQueries({ queryKey: ["budgets", schemeId] });
    },
  });

  const pending = data?.decisions.filter((d) => d.status === "pending") ?? [];
  const resolved = data?.decisions.filter((d) => d.status !== "pending") ?? [];

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
          Waiting on you
        </h3>
        {pending.length === 0 && (
          <p className="mt-2 text-sm text-gray-500">
            Nothing to decide — the agents have it covered.
          </p>
        )}
        <div className="mt-2 space-y-3">
          {pending.map((d) => (
            <div
              key={d.id}
              data-testid={`decision-${d.kind}`}
              className="rounded-lg border border-amber-200 bg-amber-50 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{d.title}</p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    for the {d.deciderRole.replace("_", " ")}
                    {d.dueAt ? ` · respond by ${new Date(d.dueAt).toLocaleDateString()}` : ""}
                  </p>
                </div>
                <span className="rounded-full bg-amber-200 px-2 py-0.5 text-xs text-amber-900">
                  {d.kind.replace("_", " ")}
                </span>
              </div>
              <pre className="mt-3 whitespace-pre-wrap rounded bg-white/70 p-3 font-sans text-sm text-gray-800">
                {d.summaryMd}
              </pre>
              <div className="mt-3 flex gap-2">
                {d.options.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    disabled={resolve.isPending}
                    onClick={() => resolve.mutate({ decisionId: d.id, optionId: o.id })}
                    className={`rounded-md px-4 py-2 text-sm font-medium disabled:opacity-40 ${
                      o.id === "approve"
                        ? "bg-brand-700 text-white hover:bg-brand-800"
                        : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        {resolve.error && <p className="mt-2 text-sm text-red-600">{resolve.error.message}</p>}
      </section>

      {resolved.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">History</h3>
          <ul className="mt-2 space-y-1">
            {resolved.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between rounded-md border border-gray-200 bg-white px-3 py-2 text-sm"
              >
                <span>{d.title}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    d.status === "approved"
                      ? "bg-green-100 text-green-800"
                      : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {d.status}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
