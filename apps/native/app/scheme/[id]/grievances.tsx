import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  FormField,
  Screen,
  SectionHeader,
  Skeleton,
  StatusPill,
  type StatusToneName,
  formatDate,
  plate,
  space,
  type as t,
  useTheme,
} from "../../../src/components";
import { api, apiPost } from "../../../src/lib/api";
import { schemeQueryOptions, useIsOfficer } from "../../../src/lib/roles";

// Mirrors GET /schemes/:id/complaints(/mine) + POST /complaints (apps/web GrievancesTab).
interface Complaint {
  id: string;
  subject: string;
  details: string;
  status: string;
  receivedAt: string;
  meetByDate: string;
  resolvedAt: string | null;
}

const CLOSED = new Set(["resolved", "withdrawn"]);

// ComplaintStatus → kit tone (mirrors the web STATUS_TONE, mapped onto ok/warn/crit).
function complaintTone(status: string): StatusToneName {
  if (status === "resolved" || status === "withdrawn") return "ok";
  if (status === "final_notice" || status === "vcat") return "crit";
  return "warn";
}
function complaintLabel(status: string): string {
  if (status === "vcat") return "VCAT";
  const s = status.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function GrievancesScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const schemeId = String(params.id ?? "");
  const isOfficer = useIsOfficer(schemeId);
  const queryClient = useQueryClient();

  const schemeQuery = useQuery({ ...schemeQueryOptions(schemeId), enabled: !!schemeId });
  // Officers see every complaint; everyone else sees only their own.
  const scope = isOfficer ? "all" : "mine";
  const listPath = isOfficer
    ? `/api/schemes/${schemeId}/complaints`
    : `/api/schemes/${schemeId}/complaints/mine`;
  const complaintsQuery = useQuery({
    queryKey: ["scheme", schemeId, "complaints", scope],
    queryFn: () => api<{ complaints: Complaint[] }>(listPath),
    enabled: !!schemeId,
  });

  const [subject, setSubject] = useState("");
  const [details, setDetails] = useState("");
  const file = useMutation({
    mutationFn: () =>
      apiPost(`/api/schemes/${schemeId}/complaints`, {
        subject: subject.trim(),
        details: details.trim(),
      }),
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSubject("");
      setDetails("");
      void queryClient.invalidateQueries({ queryKey: ["scheme", schemeId, "complaints"] });
    },
  });

  const canFile = subject.trim().length >= 3 && details.trim().length >= 3 && !file.isPending;
  const complaints = complaintsQuery.data?.complaints ?? [];

  return (
    <Screen
      title="Grievances"
      eyebrow={plate(schemeQuery.data?.scheme)}
      reserveEyebrow
      refreshing={complaintsQuery.isRefetching}
      onRefresh={() => complaintsQuery.refetch()}
    >
      {/* File a grievance — any member. Complainant defaults to the filer. */}
      <Card>
        <View style={{ gap: space(3) }}>
          <FormField
            label="What's the concern?"
            value={subject}
            onChangeText={setSubject}
            placeholder="e.g. Ongoing noise from Lot 4"
            maxLength={200}
          />
          <FormField
            label="Details"
            value={details}
            onChangeText={setDetails}
            placeholder="What's happened, when, and who's involved…"
            multiline
            maxLength={5000}
          />
          {file.isError ? (
            <Text style={{ ...t.bodySmall, color: "#c0392b" }}>Couldn't file that. Try again.</Text>
          ) : null}
          <View style={{ alignItems: "flex-start", marginTop: space(1) }}>
            <Button
              label="Raise grievance"
              onPress={() => file.mutate()}
              disabled={!canFile}
              pending={file.isPending}
            />
          </View>
        </View>
      </Card>

      <SectionHeader label={isOfficer ? "All grievances" : "My grievances"} />
      {complaintsQuery.isPending ? (
        <Card>
          <Skeleton width="70%" height={16} />
          <View style={{ marginTop: space(3) }}>
            <Skeleton width="45%" height={14} />
          </View>
        </Card>
      ) : complaintsQuery.isError && !complaintsQuery.data ? (
        <ErrorState onRetry={() => complaintsQuery.refetch()} />
      ) : complaints.length === 0 ? (
        <EmptyState icon="chatbox-ellipses-outline" title="No grievances" />
      ) : (
        <Card padded={false} style={{ paddingHorizontal: space(4) }}>
          {complaints.map((c, i) => (
            <ComplaintRow key={c.id} complaint={c} divider={i < complaints.length - 1} />
          ))}
        </Card>
      )}
    </Screen>
  );
}

function ComplaintRow({ complaint: c, divider }: { complaint: Complaint; divider: boolean }) {
  const theme = useTheme();
  const closed = CLOSED.has(c.status);
  const meta = closed
    ? c.resolvedAt
      ? `Closed ${formatDate(c.resolvedAt.slice(0, 10))}`
      : `Received ${formatDate(c.receivedAt.slice(0, 10))}`
    : `Respond by ${formatDate(c.meetByDate)}`;

  return (
    <View
      style={{
        paddingVertical: space(3),
        borderBottomWidth: divider ? StyleSheet.hairlineWidth : 0,
        borderBottomColor: theme.line,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
        <Text style={{ ...t.body, color: theme.text, flex: 1 }} numberOfLines={2}>
          {c.subject}
        </Text>
        <StatusPill tone={complaintTone(c.status)} label={complaintLabel(c.status)} />
      </View>
      {c.details ? (
        <Text style={{ ...t.bodySmall, color: theme.muted, marginTop: 2 }} numberOfLines={2}>
          {c.details}
        </Text>
      ) : null}
      <Text style={{ ...t.caption, color: theme.muted, marginTop: space(1) }}>{meta}</Text>
    </View>
  );
}
