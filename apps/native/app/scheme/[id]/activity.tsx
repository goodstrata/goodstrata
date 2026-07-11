import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetch as expoFetch } from "expo/fetch";
import { useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";
import {
  Card,
  EmptyState,
  ErrorState,
  formatRelativeTime,
  humanise,
  plate,
  radius,
  Screen,
  SectionHeader,
  Skeleton,
  StatusPill,
  space,
  type as t,
  useTheme,
} from "../../../src/components";
import { api } from "../../../src/lib/api";
import { authClient } from "../../../src/lib/auth";
import { API_ORIGIN } from "../../../src/lib/config";
import { schemeQueryOptions } from "../../../src/lib/roles";

type EventActor =
  | { kind: "agent"; id: string; agentRunId?: string }
  | { kind: "user"; id: string }
  | { kind: "system"; id: string }
  | { kind: string; id: string };

interface DomainEvent {
  id: string;
  seq: number;
  type: string;
  stream: string;
  payload: unknown;
  actor: EventActor;
  /** Present on REST history; the compact SSE frame deliberately omits it. */
  correlationId?: string;
  causationId?: string | null;
  occurredAt: string;
}

export default function ActivityScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const schemeId = String(params.id ?? "");
  const theme = useTheme();
  const queryClient = useQueryClient();

  const schemeQuery = useQuery({ ...schemeQueryOptions(schemeId), enabled: !!schemeId });
  const eventsQuery = useQuery({
    queryKey: ["scheme", schemeId, "events"],
    queryFn: () => api<{ events: DomainEvent[] }>(`/api/schemes/${schemeId}/events?limit=100`),
    enabled: !!schemeId,
  });
  useDomainEventStream(schemeId, eventsQuery.isSuccess, queryClient);

  const events = eventsQuery.data?.events ?? [];

  return (
    <Screen
      title="Activity"
      topInset={false}
      eyebrow={plate(schemeQuery.data?.scheme)}
      reserveEyebrow
      refreshing={eventsQuery.isRefetching}
      onRefresh={() => eventsQuery.refetch()}
    >
      <Text style={{ ...t.bodySmall, color: theme.muted }}>
        Live domain events across this scheme, resumed automatically after interruptions.
      </Text>
      <SectionHeader label="Event feed" />
      {eventsQuery.isPending ? (
        <ActivitySkeleton />
      ) : eventsQuery.isError && !eventsQuery.data ? (
        <ErrorState
          detail={
            eventsQuery.error instanceof Error
              ? eventsQuery.error.message
              : "The activity feed could not be loaded."
          }
          onRetry={() => eventsQuery.refetch()}
        />
      ) : events.length === 0 ? (
        <Card>
          <EmptyState
            icon="pulse-outline"
            title="No activity yet"
            body="Levies, meetings, maintenance and other scheme work will appear here."
          />
        </Card>
      ) : (
        <Card padded={false} style={{ paddingHorizontal: space(4) }}>
          {events.map((event, index) => (
            <EventRow key={event.id} event={event} divider={index < events.length - 1} />
          ))}
        </Card>
      )}
    </Screen>
  );
}

function useDomainEventStream(
  schemeId: string,
  ready: boolean,
  queryClient: ReturnType<typeof useQueryClient>,
): void {
  useEffect(() => {
    if (!schemeId || !ready) return;
    const key = ["scheme", schemeId, "events"] as const;
    let alive = true;
    let controller: AbortController | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let running = false;

    const stop = () => {
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      controller?.abort();
      controller = null;
      running = false;
    };

    const schedule = () => {
      if (!alive || AppState.currentState !== "active" || retryTimer) return;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void connect();
      }, 3000);
    };

    const merge = (event: DomainEvent) => {
      queryClient.setQueryData<{ events: DomainEvent[] }>(key, (old) => {
        const existing = old?.events ?? [];
        if (existing.some((item) => item.id === event.id)) return old;
        return {
          events: [event, ...existing].sort((a, b) => b.seq - a.seq).slice(0, 100),
        };
      });
    };

    const connect = async () => {
      if (!alive || running || AppState.currentState !== "active") return;
      running = true;
      controller = new AbortController();
      const cached = queryClient.getQueryData<{ events: DomainEvent[] }>(key)?.events ?? [];
      let cursor = cached.reduce((max, event) => Math.max(max, event.seq), 0);
      try {
        const cookie = authClient.getCookie();
        const response = await expoFetch(`${API_ORIGIN}/api/schemes/${schemeId}/stream`, {
          headers: {
            Accept: "text/event-stream",
            ...(cookie ? { Cookie: cookie } : {}),
            ...(cursor > 0 ? { "Last-Event-ID": String(cursor) } : {}),
          },
          signal: controller.signal,
        });
        if (!response.ok || !response.body) throw new Error(`Stream returned ${response.status}`);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (alive && AppState.currentState === "active") {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
          let boundary = buffer.indexOf("\n\n");
          while (boundary >= 0) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const lines = frame.split("\n");
            const eventName = lines
              .find((line) => line.startsWith("event:"))
              ?.slice(6)
              .trim();
            const id = lines
              .find((line) => line.startsWith("id:"))
              ?.slice(3)
              .trim();
            const data = lines
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trimStart())
              .join("\n");
            if (eventName === "domain-event" && data) {
              const event = JSON.parse(data) as DomainEvent;
              if (event.id && event.seq > cursor) {
                cursor = event.seq;
                merge(event);
              }
            }
            if (id) cursor = Math.max(cursor, Number.parseInt(id, 10) || cursor);
            boundary = buffer.indexOf("\n\n");
          }
        }
        await reader.cancel("Activity stream paused").catch(() => undefined);
      } catch (error) {
        if (!(error instanceof Error && error.name === "AbortError")) schedule();
      } finally {
        controller = null;
        running = false;
        schedule();
      }
    };

    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") void connect();
      else stop();
    });
    void connect();
    return () => {
      alive = false;
      appState.remove();
      stop();
    };
  }, [queryClient, ready, schemeId]);
}

function EventRow({ event, divider }: { event: DomainEvent; divider: boolean }) {
  const theme = useTheme();
  const isAgent = event.actor.kind === "agent";
  return (
    <View
      style={{
        flexDirection: "row",
        gap: space(3),
        paddingVertical: space(4),
        borderBottomWidth: divider ? StyleSheet.hairlineWidth : 0,
        borderBottomColor: theme.line,
      }}
    >
      <View
        style={{
          width: 9,
          height: 9,
          borderRadius: radius.pill,
          backgroundColor: isAgent ? theme.agent : theme.text,
          marginTop: space(2),
        }}
      />
      <View style={{ flex: 1 }}>
        <Text style={{ ...t.figureSmall, color: theme.text }} numberOfLines={2}>
          {event.type}
        </Text>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            flexWrap: "wrap",
            gap: space(2),
            marginTop: space(2),
          }}
        >
          <ActorPill actor={event.actor} />
          <Text style={{ ...t.eyebrow, color: theme.muted }}>
            #{event.seq} · {formatRelativeTime(event.occurredAt)}
          </Text>
        </View>
      </View>
    </View>
  );
}

function ActorPill({ actor }: { actor: EventActor }) {
  if (actor.kind === "agent") {
    return <StatusPill tone="agent" label={`Agent · ${humanise(actor.id)}`} />;
  }
  if (actor.kind === "user") {
    return <StatusPill tone="neutral" label="Member" />;
  }
  if (actor.kind === "system") {
    return <StatusPill tone="info" label={`System · ${humanise(actor.id)}`} />;
  }
  return <StatusPill tone="neutral" label={humanise(actor.kind)} />;
}

function ActivitySkeleton() {
  return (
    <Card padded={false} style={{ paddingHorizontal: space(4) }}>
      {[0, 1, 2, 3].map((index) => (
        <View key={index} style={{ paddingVertical: space(4), gap: space(2) }}>
          <Skeleton width={index % 2 === 0 ? "68%" : "54%"} height={16} />
          <Skeleton width="44%" height={14} />
        </View>
      ))}
    </Card>
  );
}
