import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  humanise,
  PressableScale,
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
import { api, apiPost } from "../../../src/lib/api";
import { schemeQueryOptions, useIsOfficer } from "../../../src/lib/roles";

const COMMITTEE_ROLES = ["chair", "secretary", "treasurer", "committee_member"] as const;
type CommitteeRole = (typeof COMMITTEE_ROLES)[number];

interface CommitteeMembership {
  userId: string;
  role: string;
}

interface SchemeMember {
  userId: string;
  name: string;
  email: string;
}

interface MeetingOption {
  id: string;
  title: string | null;
  kind: string;
  status: string;
  scheduledAt: string;
}

export default function CommitteeScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const schemeId = String(params.id ?? "");
  const isOfficer = useIsOfficer(schemeId);
  const queryClient = useQueryClient();
  const theme = useTheme();
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedRole, setSelectedRole] = useState<CommitteeRole>("chair");
  const [assignedMessage, setAssignedMessage] = useState<string | null>(null);
  const [electionMeetingId, setElectionMeetingId] = useState("");
  const [electedUserIds, setElectedUserIds] = useState<string[]>([]);

  const schemeQuery = useQuery({ ...schemeQueryOptions(schemeId), enabled: !!schemeId });
  const committeeQuery = useQuery({
    queryKey: ["scheme", schemeId, "committee"],
    queryFn: () => api<{ committee: CommitteeMembership[] }>(`/api/schemes/${schemeId}/committee`),
    enabled: !!schemeId,
  });
  const membersQuery = useQuery({
    queryKey: ["scheme", schemeId, "members"],
    queryFn: () => api<{ members: SchemeMember[] }>(`/api/schemes/${schemeId}/members`),
    enabled: !!schemeId,
  });
  const meetingsQuery = useQuery({
    queryKey: ["scheme", schemeId, "meetings"],
    queryFn: () => api<{ meetings: MeetingOption[] }>(`/api/schemes/${schemeId}/meetings`),
    enabled: !!schemeId && isOfficer,
  });

  const assignRole = useMutation({
    mutationFn: (assignment: { userId: string; role: CommitteeRole }) =>
      apiPost<{ ok: true }>(`/api/schemes/${schemeId}/committee`, assignment),
    onMutate: () => setAssignedMessage(null),
    onSuccess: (_result, assignment) => {
      const member = membersQuery.data?.members.find((item) => item.userId === assignment.userId);
      setAssignedMessage(`${member?.name ?? "Member"} assigned as ${humanise(assignment.role)}.`);
      setSelectedUserId("");
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["scheme", schemeId, "committee"] }),
        queryClient.invalidateQueries({ queryKey: ["scheme", schemeId, "members"] }),
        queryClient.invalidateQueries({ queryKey: ["scheme", schemeId] }),
      ]);
    },
  });
  const recordElection = useMutation({
    mutationFn: () =>
      apiPost(`/api/schemes/${schemeId}/committee/elections`, {
        meetingId: electionMeetingId,
        electedUserIds,
      }),
    onSuccess: () => {
      setElectionMeetingId("");
      setElectedUserIds([]);
      setAssignedMessage("AGM committee election recorded.");
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["scheme", schemeId, "committee"] }),
        queryClient.invalidateQueries({ queryKey: ["scheme", schemeId] }),
      ]);
    },
  });

  const membersById = useMemo(
    () => new Map((membersQuery.data?.members ?? []).map((member) => [member.userId, member])),
    [membersQuery.data?.members],
  );
  const officers = useMemo(() => {
    const roster = new Map<string, string[]>();
    for (const membership of committeeQuery.data?.committee ?? []) {
      if (membership.role === "owner" || membership.role === "tenant") continue;
      roster.set(membership.userId, [...(roster.get(membership.userId) ?? []), membership.role]);
    }
    return [...roster.entries()];
  }, [committeeQuery.data?.committee]);

  const refresh = () =>
    Promise.all([committeeQuery.refetch(), membersQuery.refetch(), meetingsQuery.refetch()]);

  return (
    <Screen
      title="Committee"
      topInset={false}
      eyebrow={plate(schemeQuery.data?.scheme)}
      reserveEyebrow
      refreshing={committeeQuery.isRefetching || membersQuery.isRefetching}
      onRefresh={refresh}
    >
      <SectionHeader label="Current committee" />
      {committeeQuery.isPending ? (
        <CommitteeSkeleton />
      ) : committeeQuery.isError && !committeeQuery.data ? (
        <ErrorState
          detail={
            committeeQuery.error instanceof Error
              ? committeeQuery.error.message
              : "The committee register could not be loaded."
          }
          onRetry={() => committeeQuery.refetch()}
        />
      ) : officers.length === 0 ? (
        <Card>
          <EmptyState
            icon="people-outline"
            title="No office holders yet"
            body={
              isOfficer
                ? "Assign a member below to record the committee."
                : "Office holders will appear here once assigned."
            }
          />
        </Card>
      ) : (
        <Card padded={false} style={{ paddingHorizontal: space(4) }}>
          {officers.map(([userId, roles], index) => {
            const member = membersById.get(userId);
            return (
              <View
                key={userId}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space(3),
                  paddingVertical: space(4),
                  borderBottomWidth: index < officers.length - 1 ? StyleSheet.hairlineWidth : 0,
                  borderBottomColor: theme.line,
                }}
              >
                <View
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: radius.pill,
                    backgroundColor: theme.infoSoft,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name="person-outline" size={18} color={theme.info} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...t.body, color: theme.text }} numberOfLines={1}>
                    {member?.name ?? userId}
                  </Text>
                  {member?.email ? (
                    <Text
                      style={{ ...t.caption, color: theme.muted, marginTop: 1 }}
                      numberOfLines={1}
                    >
                      {member.email}
                    </Text>
                  ) : null}
                  <View
                    style={{
                      flexDirection: "row",
                      flexWrap: "wrap",
                      gap: space(1),
                      marginTop: space(2),
                    }}
                  >
                    {roles.map((role) => (
                      <StatusPill key={role} tone="info" label={humanise(role)} />
                    ))}
                  </View>
                </View>
              </View>
            );
          })}
        </Card>
      )}

      {isOfficer ? (
        <>
          <SectionHeader label="AGM election" />
          <Card>
            <Text style={{ ...t.title, color: theme.text }}>Record elected committee</Text>
            <Text style={{ ...t.bodySmall, color: theme.muted, marginTop: space(1) }}>
              Select an issued AGM and 3–7 elected owners. Committees of 8–12 can be recorded on the
              web app with their carried expansion motion.
            </Text>

            <Text style={{ ...t.label, color: theme.muted, marginTop: space(4) }}>AGM</Text>
            <View style={{ gap: space(2), marginTop: space(2) }}>
              {meetingsQuery.data?.meetings
                .filter((meeting) => meeting.kind === "agm" && meeting.status !== "draft")
                .map((meeting) => (
                  <PressableScale
                    key={meeting.id}
                    onPress={() => setElectionMeetingId(meeting.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: electionMeetingId === meeting.id }}
                    style={{
                      minHeight: 48,
                      justifyContent: "center",
                      paddingHorizontal: space(3),
                      borderRadius: radius.control,
                      borderWidth: 1,
                      borderColor: electionMeetingId === meeting.id ? theme.accent : theme.line,
                      backgroundColor:
                        electionMeetingId === meeting.id ? theme.accentSoft : theme.surface,
                    }}
                  >
                    <Text style={{ ...t.bodySmall, color: theme.text }}>
                      {meeting.title || "Annual general meeting"}
                    </Text>
                    <Text style={{ ...t.caption, color: theme.muted }}>
                      {new Date(meeting.scheduledAt).toLocaleDateString("en-AU")}
                    </Text>
                  </PressableScale>
                ))}
            </View>

            <Text style={{ ...t.label, color: theme.muted, marginTop: space(4) }}>
              Elected owners ({electedUserIds.length})
            </Text>
            <View style={{ gap: space(2), marginTop: space(2) }}>
              {membersQuery.data?.members.map((member) => {
                const selected = electedUserIds.includes(member.userId);
                return (
                  <MemberOption
                    key={member.userId}
                    member={member}
                    selected={selected}
                    onPress={() =>
                      setElectedUserIds((current) =>
                        selected
                          ? current.filter((id) => id !== member.userId)
                          : current.length < 7
                            ? [...current, member.userId]
                            : current,
                      )
                    }
                  />
                );
              })}
            </View>

            {recordElection.error ? (
              <Text style={{ ...t.bodySmall, color: theme.crit, marginTop: space(3) }}>
                {recordElection.error instanceof Error
                  ? recordElection.error.message
                  : "The election could not be recorded."}
              </Text>
            ) : null}

            <View style={{ marginTop: space(4) }}>
              <Button
                label="Record election"
                onPress={() => recordElection.mutate()}
                pending={recordElection.isPending}
                disabled={!electionMeetingId || electedUserIds.length < 3}
              />
            </View>
          </Card>

          <SectionHeader label="Assign role" />
          <Card>
            <Text style={{ ...t.title, color: theme.text }}>Appoint a member</Text>
            <Text style={{ ...t.bodySmall, color: theme.muted, marginTop: space(1) }}>
              Choose a joined member and the office they will hold.
            </Text>

            {membersQuery.isPending ? (
              <View style={{ gap: space(3), marginTop: space(4) }}>
                <Skeleton width="76%" height={46} />
                <Skeleton width="64%" height={46} />
              </View>
            ) : membersQuery.isError && !membersQuery.data ? (
              <ErrorState
                title="Couldn't load members"
                detail={
                  membersQuery.error instanceof Error
                    ? membersQuery.error.message
                    : "The member list could not be loaded."
                }
                onRetry={() => membersQuery.refetch()}
              />
            ) : (membersQuery.data?.members.length ?? 0) === 0 ? (
              <EmptyState
                icon="person-add-outline"
                title="No joined members"
                body="Invite people from the People screen before assigning committee roles."
              />
            ) : (
              <>
                <Text style={{ ...t.label, color: theme.muted, marginTop: space(4) }}>Member</Text>
                <View style={{ gap: space(2), marginTop: space(2) }}>
                  {membersQuery.data?.members.map((member) => (
                    <MemberOption
                      key={member.userId}
                      member={member}
                      selected={member.userId === selectedUserId}
                      onPress={() => setSelectedUserId(member.userId)}
                    />
                  ))}
                </View>

                <Text style={{ ...t.label, color: theme.muted, marginTop: space(4) }}>Role</Text>
                <View
                  style={{
                    flexDirection: "row",
                    flexWrap: "wrap",
                    gap: space(2),
                    marginTop: space(2),
                  }}
                >
                  {COMMITTEE_ROLES.map((role) => (
                    <RoleOption
                      key={role}
                      role={role}
                      selected={role === selectedRole}
                      onPress={() => setSelectedRole(role)}
                    />
                  ))}
                </View>

                <Text style={{ ...t.caption, color: theme.muted, marginTop: space(3) }}>
                  Assigning Chair, Secretary or Treasurer replaces the current holder of that
                  office.
                </Text>
              </>
            )}

            {assignRole.error ? (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "flex-start",
                  gap: space(2),
                  marginTop: space(3),
                }}
              >
                <Ionicons name="alert-circle-outline" size={18} color={theme.crit} />
                <Text style={{ ...t.bodySmall, color: theme.crit, flex: 1 }}>
                  {assignRole.error instanceof Error
                    ? assignRole.error.message
                    : "The committee role could not be assigned."}
                </Text>
              </View>
            ) : null}

            {assignedMessage ? (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space(2),
                  marginTop: space(3),
                }}
              >
                <StatusPill tone="ok" label="Assigned" />
                <Text style={{ ...t.caption, color: theme.muted, flex: 1 }}>{assignedMessage}</Text>
              </View>
            ) : null}

            <View style={{ marginTop: space(4) }}>
              <Button
                label="Assign role"
                onPress={() => assignRole.mutate({ userId: selectedUserId, role: selectedRole })}
                pending={assignRole.isPending}
                disabled={!selectedUserId || membersQuery.isPending || membersQuery.isError}
              />
            </View>
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

function MemberOption({
  member,
  selected,
  onPress,
}: {
  member: SchemeMember;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${member.name}, ${member.email}`}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space(3),
        minHeight: 54,
        paddingHorizontal: space(3),
        paddingVertical: space(2),
        borderRadius: radius.control,
        borderWidth: 1,
        borderColor: selected ? theme.accent : theme.line,
        backgroundColor: selected ? theme.accentSoft : theme.surface,
      }}
    >
      <Ionicons
        name={selected ? "radio-button-on" : "radio-button-off"}
        size={20}
        color={selected ? theme.accent : theme.muted}
      />
      <View style={{ flex: 1 }}>
        <Text style={{ ...t.bodySmall, color: theme.text }} numberOfLines={1}>
          {member.name}
        </Text>
        <Text style={{ ...t.caption, color: theme.muted }} numberOfLines={1}>
          {member.email}
        </Text>
      </View>
    </PressableScale>
  );
}

function RoleOption({
  role,
  selected,
  onPress,
}: {
  role: CommitteeRole;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={{
        minHeight: 44,
        justifyContent: "center",
        paddingHorizontal: space(3),
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: selected ? theme.accent : theme.line,
        backgroundColor: selected ? theme.accentSoft : "transparent",
      }}
    >
      <Text style={{ ...t.label, color: selected ? theme.accent : theme.text }}>
        {humanise(role)}
      </Text>
    </PressableScale>
  );
}

function CommitteeSkeleton() {
  return (
    <Card padded={false} style={{ paddingHorizontal: space(4) }}>
      {[0, 1, 2].map((index) => (
        <View key={index} style={{ paddingVertical: space(4), gap: space(2) }}>
          <Skeleton width={index === 1 ? "52%" : "64%"} height={16} />
          <Skeleton width="38%" height={14} />
        </View>
      ))}
    </Card>
  );
}
