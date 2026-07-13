import { Activity, Bot, RotateCw, Search, User } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime, formatTime } from "@/lib/format";
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

type ActorFilter = "all" | "people" | "agents" | "system";
type StreamStatus = "connecting" | "live" | "reconnecting";

const ACTOR_FILTERS: { value: ActorFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "people", label: "People" },
  { value: "agents", label: "Agents" },
  { value: "system", label: "System" },
];

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
        <User aria-hidden="true" className="size-3" /> person
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="shrink-0 text-muted-foreground">
      {actor.kind}
    </Badge>
  );
}

function eventLabel(type: string): string {
  const words = type
    .split(/[._-]+/)
    .filter(Boolean)
    .join(" ");
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Recorded activity";
}

function matchesActor(event: DomainEvent, filter: ActorFilter): boolean {
  if (filter === "all") return true;
  if (filter === "people") return event.actor.kind === "user";
  if (filter === "agents") return event.actor.kind === "agent";
  return event.actor.kind !== "user" && event.actor.kind !== "agent";
}

export function ActivitySection({ schemeId }: { schemeId: string }) {
  const { events, status, reconnect } = useEventStream(schemeId);
  const [query, setQuery] = useState("");
  const [actorFilter, setActorFilter] = useState<ActorFilter>("all");
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());
  const filteredEvents = useMemo(
    () =>
      events.filter((event) => {
        if (!matchesActor(event, actorFilter)) return false;
        if (!deferredQuery) return true;
        return [event.type, event.stream, event.actor.kind, event.actor.id]
          .join(" ")
          .toLocaleLowerCase()
          .includes(deferredQuery);
      }),
    [events, actorFilter, deferredQuery],
  );
  const filtering = query.trim() !== "" || actorFilter !== "all";

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h2 className="font-display text-2xl font-semibold tracking-tight">Activity</h2>
          <p className="text-sm text-muted-foreground">
            A live audit trail of changes made by people, agents and the system.
          </p>
        </div>
        <Badge
          tone={status === "live" ? "positive" : "caution"}
          role="status"
          aria-live="polite"
          className="mt-0.5 gap-1.5"
        >
          <span
            aria-hidden="true"
            className={cn(
              "size-1.5 rounded-full",
              status === "live"
                ? "bg-positive"
                : "animate-pulse bg-caution motion-reduce:animate-none",
            )}
          />
          {status === "live" ? "Live" : status === "connecting" ? "Connecting" : "Reconnecting"}
        </Badge>
      </div>

      {(events.length > 0 || filtering) && (
        <div className="space-y-3 rounded-lg border bg-card p-3">
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search event, stream or actor"
              aria-label="Search activity"
              className="pl-9"
            />
          </div>
          <fieldset className="flex flex-wrap items-center gap-1.5 border-0 p-0">
            <legend className="sr-only">Filter activity by actor</legend>
            {ACTOR_FILTERS.map((filter) => (
              <Button
                key={filter.value}
                type="button"
                size="sm"
                variant={actorFilter === filter.value ? "secondary" : "ghost"}
                aria-pressed={actorFilter === filter.value}
                onClick={() => setActorFilter(filter.value)}
              >
                {filter.label}
              </Button>
            ))}
            <span className="ml-auto text-xs text-muted-foreground" role="status">
              {filteredEvents.length} of {events.length} shown
            </span>
          </fieldset>
        </div>
      )}

      {events.length === 0 && status === "connecting" ? (
        <div className="space-y-3" role="status" aria-label="Connecting to live activity">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
          <span className="sr-only">Connecting to live activity…</span>
        </div>
      ) : events.length === 0 && status === "reconnecting" ? (
        <ErrorState
          title="Reconnecting to live activity"
          message="New changes will appear when the connection returns. Try reconnecting now if it is taking too long."
          onRetry={reconnect}
        />
      ) : events.length === 0 ? (
        <div data-testid="event-feed">
          <EmptyState
            icon={Activity}
            title="No activity yet"
            description="Levies, meetings, maintenance and other recorded changes will appear here."
          />
        </div>
      ) : filteredEvents.length === 0 ? (
        <div
          data-testid="event-feed"
          className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center"
          role="status"
        >
          <Search aria-hidden="true" className="size-5 text-muted-foreground" />
          <p className="text-sm font-medium">No activity matches these filters</p>
          <p className="text-sm text-muted-foreground">Try another search or show every actor.</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setQuery("");
              setActorFilter("all");
            }}
          >
            Clear filters
          </Button>
        </div>
      ) : (
        <ol
          className="relative space-y-0 border-l border-border pl-6"
          data-testid="event-feed"
          aria-label="Scheme activity"
        >
          {filteredEvents.map((event) => (
            <li key={event.id} className="relative pb-5 last:pb-0">
              <span
                aria-hidden="true"
                className={cn(
                  "absolute top-1.5 -left-[30px] size-2.5 rounded-full ring-4 ring-background",
                  event.actor.kind === "agent" ? "bg-agent" : "bg-foreground",
                )}
              />
              <div className="space-y-1">
                <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
                  <span className="min-w-0 flex-1 text-sm font-medium">
                    {eventLabel(event.type)}
                  </span>
                  <ActorBadge actor={event.actor} />
                  <time
                    dateTime={event.occurredAt}
                    title={formatDateTime(event.occurredAt)}
                    className="ml-auto shrink-0 font-mono text-xs text-muted-foreground tabular-nums"
                  >
                    #{event.seq} · {formatTime(event.occurredAt)}
                  </time>
                </div>
                <div className="flex min-w-0 flex-wrap gap-x-2 font-mono text-xs text-muted-foreground">
                  <span>{event.type}</span>
                  <span aria-hidden="true">·</span>
                  <span className="truncate" title={event.stream}>
                    {event.stream}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}

      {status === "reconnecting" && events.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-caution/25 bg-caution/8 px-3 py-2 text-sm">
          <span>Live updates are reconnecting. The activity already shown is still available.</span>
          <Button type="button" variant="outline" size="sm" onClick={reconnect}>
            <RotateCw aria-hidden="true" className="size-3.5" />
            Reconnect
          </Button>
        </div>
      )}
    </div>
  );
}

/** Live event feed over SSE with automatic resume (Last-Event-ID = seq). */
function useEventStream(schemeId: string): {
  events: DomainEvent[];
  status: StreamStatus;
  reconnect: () => void;
} {
  const [events, setEvents] = useState<DomainEvent[]>([]);
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const [connectionAttempt, setConnectionAttempt] = useState(0);

  useEffect(() => {
    setEvents([]);
    setStatus("connecting");
  }, [schemeId]);

  useEffect(() => {
    setStatus((current) => (current === "live" ? "reconnecting" : "connecting"));
    const source = new EventSource(`/api/schemes/${schemeId}/stream`);
    source.onopen = () => setStatus("live");
    source.onerror = () => setStatus("reconnecting");
    source.addEventListener("domain-event", (rawEvent) => {
      try {
        const event = JSON.parse((rawEvent as MessageEvent).data) as DomainEvent;
        if (!event.id || typeof event.seq !== "number") return;
        setEvents((current) =>
          current.some((item) => item.id === event.id)
            ? current
            : [event, ...current].slice(0, 100),
        );
      } catch {
        // Ignore a malformed frame; EventSource remains connected for the next record.
      }
    });
    return () => source.close();
  }, [schemeId, connectionAttempt]);

  return {
    events,
    status,
    reconnect: () => setConnectionAttempt((attempt) => attempt + 1),
  };
}
