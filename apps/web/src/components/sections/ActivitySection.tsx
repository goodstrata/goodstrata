import { Activity, Bot, User } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

interface DomainEvent {
  id: string;
  seq: number;
  type: string;
  stream: string;
  payload: unknown;
  actor: { kind: string; id: string };
  occurredAt: string;
}

function ActorBadge({ actor }: { actor: DomainEvent["actor"] }) {
  if (actor.kind === "agent") {
    return (
      <Badge tone="agent" className="shrink-0 gap-1">
        <Bot aria-hidden="true" className="size-3" /> {actor.id}
      </Badge>
    );
  }
  if (actor.kind === "user") {
    return (
      <Badge tone="neutral" className="shrink-0 gap-1">
        <User aria-hidden="true" className="size-3" /> user
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="shrink-0 text-muted-foreground">
      {actor.kind}
    </Badge>
  );
}

export function ActivitySection({ schemeId }: { schemeId: string }) {
  const events = useEventStream(schemeId);
  return (
    <div className="max-w-3xl">
      <p className="text-sm text-muted-foreground">
        Live event feed — every domain event on this scheme's bus, as it happens.
      </p>
      {events.length === 0 ? (
        <div className="mt-4" data-testid="event-feed" aria-live="polite">
          <EmptyState
            icon={Activity}
            title="No activity yet"
            description="Every levy, meeting and maintenance job on the scheme's bus will appear here."
          />
        </div>
      ) : (
        <ol
          className="relative mt-4 space-y-0 border-l border-border pl-6"
          data-testid="event-feed"
          aria-live="polite"
        >
          {events.map((evt) => (
            <li key={evt.id} className="relative pb-5 last:pb-0">
              <span
                aria-hidden="true"
                className={cn(
                  "absolute top-1.5 -left-[30px] size-2.5 rounded-full ring-4 ring-background",
                  evt.actor.kind === "agent" ? "bg-agent" : "bg-foreground",
                )}
              />
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="min-w-0 flex-1 truncate font-mono text-sm font-medium">
                  {evt.type}
                </span>
                <ActorBadge actor={evt.actor} />
                <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
                  #{evt.seq} · {formatTime(evt.occurredAt)}
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
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
