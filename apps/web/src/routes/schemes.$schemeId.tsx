import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api, unwrap } from "../lib/api";

export const Route = createFileRoute("/schemes/$schemeId")({
  component: SchemePage,
});

interface DomainEvent {
  id: string;
  seq: number;
  type: string;
  stream: string;
  payload: unknown;
  actor: { kind: string; id: string };
  occurredAt: string;
}

function SchemePage() {
  const { schemeId } = Route.useParams();
  const { data } = useQuery({
    queryKey: ["scheme", schemeId],
    queryFn: async () =>
      unwrap<{
        scheme: { name: string; planOfSubdivision: string; status: string };
        roles: string[];
      }>(await api.schemes[":schemeId"].$get({ param: { schemeId } })),
  });
  const events = useEventStream(schemeId);

  return (
    <div>
      <h1 className="text-xl font-semibold">{data?.scheme.name ?? "…"}</h1>
      <p className="text-sm text-gray-500">
        {data?.scheme.planOfSubdivision} · {data?.scheme.status} · your roles:{" "}
        {data?.roles.join(", ")}
      </p>

      <h2 className="mt-6 text-sm font-semibold uppercase tracking-wide text-gray-500">
        Live activity
      </h2>
      <ul className="mt-2 space-y-1.5">
        {events.length === 0 && <li className="text-sm text-gray-400">Waiting for events…</li>}
        {events.map((evt) => (
          <li
            key={evt.id}
            className="flex items-baseline gap-3 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm"
          >
            <span className="shrink-0 font-mono text-xs text-gray-400">#{evt.seq}</span>
            <span
              className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${
                evt.actor.kind === "agent"
                  ? "bg-purple-100 text-purple-700"
                  : evt.actor.kind === "user"
                    ? "bg-blue-100 text-blue-700"
                    : "bg-gray-100 text-gray-600"
              }`}
            >
              {evt.actor.kind === "agent" ? `🤖 ${evt.actor.id}` : evt.actor.kind}
            </span>
            <span className="font-medium">{evt.type}</span>
            <span className="ml-auto shrink-0 text-xs text-gray-400">
              {new Date(evt.occurredAt).toLocaleTimeString()}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Live event feed over SSE with automatic resume (Last-Event-ID = seq). */
function useEventStream(schemeId: string): DomainEvent[] {
  const [events, setEvents] = useState<DomainEvent[]>([]);

  useEffect(() => {
    setEvents([]);
    const source = new EventSource(`/api/schemes/${schemeId}/stream`);
    source.addEventListener("domain-event", (e) => {
      const evt = JSON.parse((e as MessageEvent).data) as DomainEvent;
      setEvents((prev) =>
        prev.some((p) => p.id === evt.id) ? prev : [evt, ...prev].slice(0, 100),
      );
    });
    return () => source.close();
  }, [schemeId]);

  return events;
}
