import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  FormField,
  plate,
  radius,
  Screen,
  SectionHeader,
  Sheet,
  Skeleton,
  StatusPill,
  space,
  type as t,
  useTheme,
} from "../../../src/components";
import { api, apiPost } from "../../../src/lib/api";
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
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [givenName, setGivenName] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const schemeQuery = useQuery({ ...schemeQueryOptions(schemeId), enabled: !!schemeId });
  const peopleQuery = useQuery({
    queryKey: ["scheme", schemeId, "people"],
    queryFn: () => api<{ people: Person[] }>(`/api/schemes/${schemeId}/people`),
    enabled: !!schemeId,
  });

  const people = peopleQuery.data?.people ?? [];
  const refreshPeople = () =>
    queryClient.invalidateQueries({ queryKey: ["scheme", schemeId, "people"] });
  const addPerson = useMutation({
    mutationFn: () => {
      const trimmed = {
        givenName: givenName.trim() || undefined,
        familyName: familyName.trim() || undefined,
        companyName: companyName.trim() || undefined,
        email: email.trim().toLowerCase() || undefined,
        phone: phone.trim() || undefined,
      };
      if (!trimmed.givenName && !trimmed.familyName && !trimmed.companyName && !trimmed.email) {
        throw new Error("Add a name, company or email address.");
      }
      return apiPost<{ person: Person }>(`/api/schemes/${schemeId}/people`, trimmed);
    },
    onSuccess: async () => {
      await refreshPeople();
      setGivenName("");
      setFamilyName("");
      setCompanyName("");
      setEmail("");
      setPhone("");
      setFormError(null);
      setAdding(false);
    },
    onError: (error) =>
      setFormError(error instanceof Error ? error.message : "Couldn't add person."),
  });

  return (
    <Screen
      title="People"
      topInset={false}
      eyebrow={plate(schemeQuery.data?.scheme)}
      reserveEyebrow
      refreshing={peopleQuery.isRefetching}
      onRefresh={() => peopleQuery.refetch()}
    >
      {isOfficer ? (
        <SectionHeader
          label="The roll"
          right={
            <Pressable
              onPress={() => {
                setFormError(null);
                setAdding(true);
              }}
              accessibilityRole="button"
              accessibilityLabel="Add person"
              hitSlop={8}
              style={{ flexDirection: "row", alignItems: "center", gap: space(1) }}
            >
              <Ionicons name="add" size={18} color={theme.accent} />
              <Text style={{ ...t.label, color: theme.accent }}>Add person</Text>
            </Pressable>
          }
        />
      ) : null}
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
            <PersonRow
              key={p.id}
              person={p}
              schemeId={schemeId}
              isOfficer={isOfficer}
              divider={i < people.length - 1}
              onChanged={refreshPeople}
            />
          ))}
        </Card>
      )}
      <Sheet visible={adding} onClose={() => !addPerson.isPending && setAdding(false)}>
        <View style={{ gap: space(4) }}>
          <View style={{ gap: space(1) }}>
            <Text style={{ ...t.title, color: theme.text }}>Add a person</Text>
            <Text style={{ ...t.bodySmall, color: theme.muted }}>
              Record an owner or contact. Add an email so they can be invited to GoodStrata.
            </Text>
          </View>
          <View style={{ flexDirection: "row", gap: space(3) }}>
            <View style={{ flex: 1 }}>
              <FormField label="Given name" value={givenName} onChangeText={setGivenName} />
            </View>
            <View style={{ flex: 1 }}>
              <FormField label="Family name" value={familyName} onChangeText={setFamilyName} />
            </View>
          </View>
          <FormField label="Company" value={companyName} onChangeText={setCompanyName} />
          <FormField
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <FormField label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
          {formError ? (
            <Text style={{ ...t.bodySmall, color: theme.critFill }}>{formError}</Text>
          ) : null}
          <Button
            label="Add person"
            full
            pending={addPerson.isPending}
            onPress={() => {
              setFormError(null);
              addPerson.mutate();
            }}
          />
        </View>
      </Sheet>
    </Screen>
  );
}

function PersonRow({
  person: p,
  schemeId,
  isOfficer,
  divider,
  onChanged,
}: {
  person: Person;
  schemeId: string;
  isOfficer: boolean;
  divider: boolean;
  onChanged: () => Promise<unknown>;
}) {
  const theme = useTheme();
  const name = personName(p);
  const lots = p.lots.length
    ? p.lots.map((l) => `Lot ${l.lotNumber}`).join(" · ")
    : "No lot on the roll";
  // Contact details are officer-only (privacy); everyone sees names + lots.
  const contact = isOfficer ? [p.email, p.phone].filter(Boolean).join(" · ") : "";
  const invite = useMutation({
    mutationFn: () =>
      apiPost<{ linked: boolean; expiresAt: string | null }>(
        `/api/schemes/${schemeId}/people/${p.id}/invite`,
        { role: "owner" },
      ),
    onSuccess: () => onChanged(),
  });

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
          borderRadius: radius.pill,
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
          {p.userId ? (
            <StatusPill tone="ok" label="Joined" />
          ) : p.pendingInvite ? (
            <StatusPill tone="warn" label="Invite pending" />
          ) : isOfficer && p.email ? (
            <Pressable
              onPress={() => invite.mutate()}
              disabled={invite.isPending}
              accessibilityRole="button"
              accessibilityLabel={`Invite ${name}`}
              hitSlop={8}
            >
              <Text style={{ ...t.label, color: theme.accent }}>
                {invite.isPending ? "Sending…" : "Invite"}
              </Text>
            </Pressable>
          ) : null}
        </View>
        <Text style={{ ...t.bodySmall, color: theme.muted, marginTop: 2 }} numberOfLines={1}>
          {lots}
        </Text>
        {contact ? (
          <Text style={{ ...t.caption, color: theme.muted, marginTop: 1 }} numberOfLines={1}>
            {contact}
          </Text>
        ) : null}
        {invite.isError ? (
          <Text style={{ ...t.caption, color: theme.critFill, marginTop: 2 }} numberOfLines={2}>
            {invite.error instanceof Error ? invite.error.message : "Couldn't send invite."}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
