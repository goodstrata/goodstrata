import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import {
  Card,
  EmptyState,
  ErrorState,
  Screen,
  Skeleton,
  StatusPill,
  plate,
  space,
  type as t,
  useTheme,
} from "../../../src/components";
import { api } from "../../../src/lib/api";
import { schemeQueryOptions, useIsOfficer } from "../../../src/lib/roles";

// Mirrors GET /schemes/:id/people (peopleService.listPeople — the roll).
interface Person {
  id: string;
  givenName: string | null;
  familyName: string | null;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  userId: string | null;
  pendingInvite: boolean;
  lots: { lotId: string; lotNumber: string }[];
}

function personName(p: Person): string {
  const full = `${p.givenName ?? ""} ${p.familyName ?? ""}`.trim();
  return full || p.companyName || p.email || "Unnamed";
}

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  const chars = parts.slice(0, 2).map((w) => w[0]);
  return (chars.join("") || "?").toUpperCase();
}

export default function PeopleScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const schemeId = String(params.id ?? "");
  const isOfficer = useIsOfficer(schemeId);

  const schemeQuery = useQuery({ ...schemeQueryOptions(schemeId), enabled: !!schemeId });
  const peopleQuery = useQuery({
    queryKey: ["scheme", schemeId, "people"],
    queryFn: () => api<{ people: Person[] }>(`/api/schemes/${schemeId}/people`),
    enabled: !!schemeId,
  });

  const people = peopleQuery.data?.people ?? [];

  return (
    <Screen
      title="People"
      eyebrow={plate(schemeQuery.data?.scheme)}
      reserveEyebrow
      refreshing={peopleQuery.isRefetching}
      onRefresh={() => peopleQuery.refetch()}
    >
      {peopleQuery.isPending ? (
        <Card padded={false} style={{ paddingHorizontal: space(4) }}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={{ paddingVertical: space(3) }}>
              <Skeleton width={i % 2 ? "55%" : "68%"} height={16} />
            </View>
          ))}
        </Card>
      ) : peopleQuery.isError && !peopleQuery.data ? (
        <ErrorState onRetry={() => peopleQuery.refetch()} />
      ) : people.length === 0 ? (
        <EmptyState icon="people-outline" title="No one on the roll yet" />
      ) : (
        <Card padded={false} style={{ paddingHorizontal: space(4) }}>
          {people.map((p, i) => (
            <PersonRow key={p.id} person={p} isOfficer={isOfficer} divider={i < people.length - 1} />
          ))}
        </Card>
      )}
    </Screen>
  );
}

function PersonRow({
  person: p,
  isOfficer,
  divider,
}: {
  person: Person;
  isOfficer: boolean;
  divider: boolean;
}) {
  const theme = useTheme();
  const name = personName(p);
  const lots = p.lots.length
    ? p.lots.map((l) => `Lot ${l.lotNumber}`).join(" · ")
    : "No lot on the roll";
  // Contact details are officer-only (privacy); everyone sees names + lots.
  const contact = isOfficer ? [p.email, p.phone].filter(Boolean).join(" · ") : "";

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space(3),
        paddingVertical: space(3),
        borderBottomWidth: divider ? StyleSheet.hairlineWidth : 0,
        borderBottomColor: theme.line,
      }}
    >
      <View
        style={{
          width: 38,
          height: 38,
          borderRadius: 19,
          backgroundColor: theme.surface,
          borderWidth: 1,
          borderColor: theme.line,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ ...t.label, color: theme.muted }}>{initials(name)}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
          <Text style={{ ...t.body, color: theme.text, flex: 1 }} numberOfLines={1}>
            {name}
          </Text>
          {p.pendingInvite ? <StatusPill tone="warn" label="Invite pending" /> : null}
        </View>
        <Text style={{ ...t.bodySmall, color: theme.muted, marginTop: 2 }} numberOfLines={1}>
          {lots}
        </Text>
        {contact ? (
          <Text style={{ ...t.caption, color: theme.muted, marginTop: 1 }} numberOfLines={1}>
            {contact}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
