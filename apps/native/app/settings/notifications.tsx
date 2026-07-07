import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { StyleSheet, Switch, Text, View } from "react-native";
import {
  Card,
  ErrorState,
  Screen,
  SectionHeader,
  Skeleton,
  space,
  type as t,
  useTheme,
} from "../../src/components";
import { api, apiPatch } from "../../src/lib/api";

// Mirrors GET/PATCH /profile/notification-preferences (apps/web NotificationsSection).
type Channel = "in_app" | "email" | "sms";
interface PrefType {
  type: string;
  label: string;
  help: string;
  channels: Record<Channel, boolean>;
}
interface PrefGroup {
  key: string;
  label: string;
  types: PrefType[];
}
interface PrefsPayload {
  smsAvailable: boolean;
  phone: string | null;
  groups: PrefGroup[];
}

const PREFS_KEY = ["notification-preferences"] as const;
const CHANNELS: { key: Channel; label: string }[] = [
  { key: "in_app", label: "In-app" },
  { key: "email", label: "Email" },
  { key: "sms", label: "SMS" },
];

/** Immutably flip one (type, channel) in the cached payload for optimistic UI. */
function withChannel(p: PrefsPayload, type: string, channel: Channel, enabled: boolean): PrefsPayload {
  return {
    ...p,
    groups: p.groups.map((g) => ({
      ...g,
      types: g.types.map((ty) =>
        ty.type === type ? { ...ty, channels: { ...ty.channels, [channel]: enabled } } : ty,
      ),
    })),
  };
}

export default function NotificationSettings() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const prefsQuery = useQuery({
    queryKey: PREFS_KEY,
    queryFn: () => api<PrefsPayload>("/api/profile/notification-preferences"),
  });

  // Per-toggle optimistic autosave: flip the cached value now, PATCH one
  // { type, channel, enabled }, revert on error.
  const patch = useMutation({
    mutationFn: (v: { type: string; channel: Channel; enabled: boolean }) =>
      apiPatch("/api/profile/notification-preferences", v),
    onMutate: async (v) => {
      await queryClient.cancelQueries({ queryKey: PREFS_KEY });
      const prev = queryClient.getQueryData<PrefsPayload>(PREFS_KEY);
      if (prev) queryClient.setQueryData(PREFS_KEY, withChannel(prev, v.type, v.channel, v.enabled));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(PREFS_KEY, ctx.prev);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: PREFS_KEY }),
  });

  const data = prefsQuery.data;

  return (
    <Screen
      title="Notifications"
      refreshing={prefsQuery.isRefetching}
      onRefresh={() => prefsQuery.refetch()}
    >
      {prefsQuery.isPending ? (
        <Card>
          <Skeleton width="60%" height={16} />
          <View style={{ marginTop: space(4), gap: space(3) }}>
            <Skeleton width="80%" height={14} />
            <Skeleton width="70%" height={14} />
          </View>
        </Card>
      ) : prefsQuery.isError && !data ? (
        <ErrorState onRetry={() => prefsQuery.refetch()} />
      ) : data ? (
        <>
          <Text style={{ ...t.bodySmall, color: theme.muted, marginBottom: space(2) }}>
            Choose what reaches you, and how. In-app shows in your bell; add email or text for the
            ones that matter.
          </Text>
          {!data.smsAvailable ? (
            <Text style={{ ...t.caption, color: theme.muted, marginBottom: space(2) }}>
              Add a mobile number to your profile to turn on SMS.
            </Text>
          ) : null}
          {data.groups.map((group) => (
            <View key={group.key}>
              <SectionHeader label={group.label} />
              <Card padded={false} style={{ paddingHorizontal: space(4) }}>
                {group.types.map((ty, i) => (
                  <TypeRow
                    key={ty.type}
                    type={ty}
                    smsAvailable={data.smsAvailable}
                    divider={i < group.types.length - 1}
                    onToggle={(channel, enabled) => patch.mutate({ type: ty.type, channel, enabled })}
                  />
                ))}
              </Card>
            </View>
          ))}
        </>
      ) : null}
    </Screen>
  );
}

function TypeRow({
  type: ty,
  smsAvailable,
  divider,
  onToggle,
}: {
  type: PrefType;
  smsAvailable: boolean;
  divider: boolean;
  onToggle: (channel: Channel, enabled: boolean) => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        paddingVertical: space(3),
        borderBottomWidth: divider ? StyleSheet.hairlineWidth : 0,
        borderBottomColor: theme.line,
      }}
    >
      <Text style={{ ...t.body, color: theme.text }}>{ty.label}</Text>
      {ty.help ? (
        <Text style={{ ...t.caption, color: theme.muted, marginTop: 2 }}>{ty.help}</Text>
      ) : null}
      <View style={{ flexDirection: "row", gap: space(6), marginTop: space(3) }}>
        {CHANNELS.map((ch) => {
          const disabled = ch.key === "sms" && !smsAvailable;
          return (
            <View
              key={ch.key}
              style={{ alignItems: "center", gap: space(1), opacity: disabled ? 0.4 : 1 }}
            >
              <Switch
                value={ty.channels[ch.key]}
                onValueChange={(v) => onToggle(ch.key, v)}
                disabled={disabled}
                trackColor={{ true: theme.accent, false: theme.line }}
              />
              <Text style={{ ...t.caption, color: theme.muted }}>{ch.label}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}
