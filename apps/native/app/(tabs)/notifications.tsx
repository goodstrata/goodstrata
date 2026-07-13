import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { FlatList, RefreshControl, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import {
  Button,
  Card,
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
import { resolveNotificationTarget } from "../../src/lib/notificationTarget";
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

const NOTIFICATION_SKELETON_KEYS = [
  "notification-skeleton-1",
  "notification-skeleton-2",
  "notification-skeleton-3",
  "notification-skeleton-4",
  "notification-skeleton-5",
  "notification-skeleton-6",
] as const;

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
      queryFn: () => api<NotificationsResponse>(`/api/schemes/${entry.scheme.id}/notifications`),
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
  const pendingCount = notifQueries.filter((q) => q.isPending).length;
  const failedCount = notifQueries.filter((q) => q.isError).length;
  const loading =
    schemesQuery.isPending ||
    (schemes.length > 0 && !anyData && notifQueries.some((q) => q.isPending));
  const errored =
    (schemesQuery.isError && schemesQuery.data === undefined) ||
    (schemes.length > 0 && !anyData && notifQueries.every((q) => q.isError));
  const refetchAll = () =>
    Promise.all([schemesQuery.refetch(), ...notifQueries.map((q) => q.refetch())]);

  return {
    schemes,
    items,
    unreadCount,
    loading,
    errored,
    pendingCount,
    failedCount,
    refetchAll,
  };
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
  const { schemes, items, unreadCount, loading, errored, pendingCount, failedCount, refetchAll } =
    useNotificationsFeed();
  const [pulling, setPulling] = useState(false);
  const refresh = async () => {
    setPulling(true);
    try {
      await refetchAll();
    } finally {
      setPulling(false);
    }
  };

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

  // Tap = notification center: clear unread (if any) AND deep-link to the entity.
  const openNotification = (item: FeedItem) => {
    if (!item.readAt) {
      markRead.mutate({ schemeId: item.schemeId, notificationId: item.id });
    }
    const target = resolveNotificationTarget(item);
    if (target) router.push(target);
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
        {NOTIFICATION_SKELETON_KEYS.map((key) => (
          <View key={key} style={{ paddingVertical: space(3), gap: space(2) }}>
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
          <RefreshControl refreshing={pulling} onRefresh={refresh} tintColor={theme.muted} />
        }
        ListHeaderComponent={
          items.length > 0 && (failedCount > 0 || pendingCount > 0) ? (
            <Card style={{ marginBottom: space(3) }}>
              <View
                accessibilityRole={failedCount > 0 ? "alert" : undefined}
                accessibilityLiveRegion="polite"
                style={{ flexDirection: "row", alignItems: "center", gap: space(3) }}
              >
                <Ionicons
                  name={failedCount > 0 ? "cloud-offline-outline" : "sync-outline"}
                  size={20}
                  color={failedCount > 0 ? theme.warn : theme.muted}
                />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[t.bodySmall, { color: theme.text }]}>
                    {failedCount > 0
                      ? `${failedCount} ${failedCount === 1 ? "building" : "buildings"} couldn't be checked`
                      : `Checking ${pendingCount} more ${pendingCount === 1 ? "building" : "buildings"}`}
                  </Text>
                  <Text style={[t.caption, { color: theme.muted, marginTop: 2 }]}>
                    {failedCount > 0
                      ? "Showing the notifications that are available."
                      : "New results will appear here automatically."}
                  </Text>
                </View>
                {failedCount > 0 ? (
                  <Button variant="secondary" label="Retry" onPress={() => void refetchAll()} />
                ) : null}
              </View>
            </Card>
          ) : null
        }
        ListEmptyComponent={
          <View style={{ paddingTop: space(4) }}>
            {failedCount > 0 ? (
              <ErrorState
                title="Couldn't check every building"
                detail="No complete notification view is available yet. Try the failed buildings again."
                onRetry={refetchAll}
              />
            ) : pendingCount > 0 ? (
              <View
                accessibilityRole="progressbar"
                accessibilityLabel={`Checking ${pendingCount} ${pendingCount === 1 ? "building" : "buildings"} for notifications`}
                accessibilityLiveRegion="polite"
                style={{ gap: space(3) }}
              >
                <Skeleton width="55%" height={16} />
                <Skeleton width="82%" height={12} />
                <Text style={[t.bodySmall, { color: theme.muted }]}>Checking your buildings…</Text>
              </View>
            ) : (
              <EmptyState icon="checkmark-done-outline" title="You're all caught up" />
            )}
          </View>
        }
        renderItem={({ item, index }) => {
          const unread = !item.readAt;
          const subtitle =
            [item.body, schemes.length > 1 ? item.schemeName : undefined]
              .filter(Boolean)
              .join(" · ") || undefined;
          const row = (
            <ListRow
              title={item.title}
              titleLines={2}
              subtitle={subtitle}
              unread={unread}
              divider={index < items.length - 1}
              onPress={() => openNotification(item)}
              accessibilityLabel={[item.title, subtitle, unread ? "Unread" : undefined]
                .filter(Boolean)
                .join(". ")}
              accessibilityHint="Opens the related item"
              right={
                <Text style={[t.eyebrow, { color: theme.muted }]}>
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
