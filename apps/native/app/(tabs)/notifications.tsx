import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { FlatList, RefreshControl, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import {
  EmptyState,
  ErrorState,
  ListRow,
  PressableScale,
  Screen,
  Skeleton,
  useListEntering,
  useTheme,
} from "../../src/components";
import { api, apiPost } from "../../src/lib/api";
import { formatRelativeTime } from "../../src/lib/format";
import { space, type as t } from "../../src/theme/tokens";

// ── API shapes ──────────────────────────────────────────────────────────────

interface SchemeEntry {
  scheme: { id: string; name: string };
  roles: string[];
}
interface SchemesResponse {
  schemes: SchemeEntry[];
}

type NotificationCategory = "finance" | "maintenance" | "meeting" | "decision" | "general";

interface AppNotification {
  id: string;
  schemeId: string;
  userId: string;
  title: string;
  body: string;
  category: NotificationCategory;
  related: { type: string; id: string } | null;
  readAt: string | null;
  createdAt: string;
}
interface NotificationsResponse {
  notifications: AppNotification[];
}

type FeedItem = AppNotification & { schemeName: string };

// ── Feed: every scheme's notifications, merged, newest first ────────────────

function useNotificationsFeed() {
  const schemesQuery = useQuery({
    queryKey: ["schemes"],
    queryFn: () => api<SchemesResponse>("/api/schemes"),
  });
  const schemes = schemesQuery.data?.schemes ?? [];

  const notifQueries = useQueries({
    queries: schemes.map((entry) => ({
      queryKey: ["scheme", entry.scheme.id, "notifications"],
      queryFn: () =>
        api<NotificationsResponse>(`/api/schemes/${entry.scheme.id}/notifications`),
    })),
  });

  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of schemes) map.set(entry.scheme.id, entry.scheme.name);
    return map;
  }, [schemes]);

  const items = useMemo<FeedItem[]>(() => {
    const merged: FeedItem[] = [];
    for (const q of notifQueries) {
      for (const n of q.data?.notifications ?? []) {
        merged.push({ ...n, schemeName: nameById.get(n.schemeId) ?? "" });
      }
    }
    merged.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    return merged;
  }, [notifQueries, nameById]);

  const unreadCount = useMemo(() => items.filter((n) => !n.readAt).length, [items]);

  const anyData = notifQueries.some((q) => q.data !== undefined);
  const loading =
    schemesQuery.isPending ||
    (schemes.length > 0 && !anyData && notifQueries.some((q) => q.isPending));
  const errored =
    (schemesQuery.isError && schemesQuery.data === undefined) ||
    (schemes.length > 0 && !anyData && notifQueries.every((q) => q.isError));
  const refetching = schemesQuery.isRefetching || notifQueries.some((q) => q.isRefetching);

  const refetchAll = () => {
    void schemesQuery.refetch();
    for (const q of notifQueries) void q.refetch();
  };

  return { schemes, items, unreadCount, loading, errored, refetching, refetchAll };
}

/**
 * Unread total across all schemes — same query cache as the screen, so the
 * tab badge and the inbox never disagree. Exported for the tab layout owner.
 */
export function useUnreadNotificationsCount(): number {
  return useNotificationsFeed().unreadCount;
}

// ── Screen ──────────────────────────────────────────────────────────────────

export default function Notifications() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { schemes, items, unreadCount, loading, errored, refetching, refetchAll } =
    useNotificationsFeed();

  // List entrance runs on first successful load only (§2 rule 2).
  const [hasEntered, setHasEntered] = useState(false);
  useEffect(() => {
    if (!loading && !errored) setHasEntered(true);
  }, [loading, errored]);
  const entering = useListEntering(!hasEntered);

  const markRead = useMutation({
    mutationFn: (vars: { schemeId: string; notificationId?: string; all?: boolean }) =>
      apiPost<{ ok: true }>(
        `/api/schemes/${vars.schemeId}/notifications/read`,
        vars.all ? { all: true } : { notificationId: vars.notificationId },
      ),
    onMutate: async (vars) => {
      const key = ["scheme", vars.schemeId, "notifications"] as const;
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<NotificationsResponse>(key);
      queryClient.setQueryData<NotificationsResponse>(key, (old) =>
        old
          ? {
              notifications: old.notifications.map((n) =>
                !n.readAt && (vars.all || n.id === vars.notificationId)
                  ? { ...n, readAt: new Date().toISOString() }
                  : n,
              ),
            }
          : old,
      );
      return { key, prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(ctx.key, ctx.prev);
    },
    onSettled: (_data, _err, vars) => {
      void queryClient.invalidateQueries({
        queryKey: ["scheme", vars.schemeId, "notifications"],
      });
    },
  });

  const markAllRead = () => {
    const schemeIds = new Set(items.filter((n) => !n.readAt).map((n) => n.schemeId));
    for (const schemeId of schemeIds) markRead.mutate({ schemeId, all: true });
  };

  const headerRight =
    unreadCount > 0 ? (
      <PressableScale
        onPress={markAllRead}
        haptic
        accessibilityRole="button"
        accessibilityLabel="Mark all as read"
        style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
      >
        <Ionicons name="checkmark-done-outline" size={20} color={theme.accent} />
      </PressableScale>
    ) : undefined;

  let content: React.ReactNode;
  if (loading) {
    content = (
      <View>
        {Array.from({ length: 6 }, (_, i) => (
          <View key={i} style={{ paddingVertical: space(3), gap: space(2) }}>
            <Skeleton width="55%" height={16} />
            <Skeleton width="82%" height={12} />
          </View>
        ))}
      </View>
    );
  } else if (errored) {
    content = <ErrorState onRetry={refetchAll} />;
  } else {
    content = (
      <FlatList
        data={items}
        keyExtractor={(n) => n.id}
        contentContainerStyle={{ paddingBottom: space(10), flexGrow: 1 }}
        refreshControl={
          <RefreshControl refreshing={refetching} onRefresh={refetchAll} tintColor={theme.muted} />
        }
        ListEmptyComponent={
          <View style={{ paddingTop: space(4) }}>
            <EmptyState icon="checkmark-done-outline" title="You're all caught up" />
          </View>
        }
        renderItem={({ item, index }) => {
          const unread = !item.readAt;
          const subtitle =
            item.body || (schemes.length > 1 ? item.schemeName : undefined);
          const row = (
            <ListRow
              title={item.title}
              subtitle={subtitle}
              unread={unread}
              chevron={false}
              divider={index < items.length - 1}
              onPress={
                unread
                  ? () => markRead.mutate({ schemeId: item.schemeId, notificationId: item.id })
                  : undefined
              }
              right={
                <Text style={[t.figureSmall, { color: theme.muted }]}>
                  {formatRelativeTime(item.createdAt)}
                </Text>
              }
            />
          );
          const anim = entering(index);
          return anim ? <Animated.View entering={anim}>{row}</Animated.View> : row;
        }}
      />
    );
  }

  return (
    <Screen
      title="Notifications"
      eyebrow={unreadCount > 0 ? `${unreadCount} unread` : undefined}
      scroll={false}
      headerRight={headerRight}
    >
      {content}
    </Screen>
  );
}
