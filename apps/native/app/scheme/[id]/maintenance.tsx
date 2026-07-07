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
  formatMoney,
  plate,
  space,
  type as t,
  useTheme,
} from "../../../src/components";
import { api, apiPost } from "../../../src/lib/api";
import { schemeQueryOptions, useIsOfficer } from "../../../src/lib/roles";

// ---------------------------------------------------------------------------
// Mirrors GET /schemes/:id/maintenance + /work-orders (see apps/web MaintenanceTab)
// ---------------------------------------------------------------------------

interface Request {
  id: string;
  title: string;
  description: string;
  category: string | null;
  urgency: string | null;
  isCommonProperty: boolean | null;
  aiTriage: { reasoning?: string; declineExplanation?: string } | null;
  status: string;
  createdAt: string;
}

interface WorkOrder {
  id: string;
  scope: string;
  approvedAmountCents: number;
  status: string;
  contractorId: string;
  contractorName: string | null;
  requestTitle: string | null;
}

/** Officer statuses where a work order can still be marked completed. */
const COMPLETABLE_STATUSES = new Set(["dispatched", "accepted", "scheduled", "in_progress"]);

// Owner-facing status → friendly label + tone (mirrors ReportIssueDialog's
// ownerStatusLabel/Tone, collapsed onto the kit's ok/warn/crit palette).
function ownerLabel(status: string): string {
  switch (status) {
    case "open":
    case "reported":
    case "received":
      return "Reported";
    case "scheduled":
      return "Scheduled";
    case "completed":
      return "Done";
    case "rejected":
      return "Not proceeding";
    default:
      return "Being looked at";
  }
}
function ownerTone(status: string): StatusToneName {
  if (status === "completed") return "ok";
  if (status === "rejected") return "crit";
  return "warn";
}

function money(cents: number): string {
  const m = formatMoney(cents);
  return `${m.dollars}${m.cents}`;
}

// ---------------------------------------------------------------------------

export default function MaintenanceScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const schemeId = String(params.id ?? "");
  const isOfficer = useIsOfficer(schemeId);
  const queryClient = useQueryClient();

  const schemeQuery = useQuery({ ...schemeQueryOptions(schemeId), enabled: !!schemeId });
  const requestsQuery = useQuery({
    queryKey: ["scheme", schemeId, "maintenance"],
    queryFn: () => api<{ requests: Request[] }>(`/api/schemes/${schemeId}/maintenance`),
    enabled: !!schemeId,
  });
  const workOrdersQuery = useQuery({
    queryKey: ["scheme", schemeId, "work-orders"],
    queryFn: () => api<{ workOrders: WorkOrder[] }>(`/api/schemes/${schemeId}/work-orders`),
    enabled: !!schemeId && isOfficer,
  });

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const report = useMutation({
    mutationFn: () =>
      apiPost(`/api/schemes/${schemeId}/maintenance`, { title: title.trim(), description: description.trim() }),
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTitle("");
      setDescription("");
      void queryClient.invalidateQueries({ queryKey: ["scheme", schemeId, "maintenance"] });
      void queryClient.invalidateQueries({ queryKey: ["scheme", schemeId, "overview"] });
    },
  });

  const [completingId, setCompletingId] = useState<string | null>(null);
  const complete = useMutation({
    mutationFn: (workOrderId: string) =>
      apiPost(`/api/schemes/${schemeId}/work-orders/${workOrderId}/complete`, {}),
    onMutate: (id: string) => setCompletingId(id),
    onSettled: () => setCompletingId(null),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["scheme", schemeId, "work-orders"] });
      void queryClient.invalidateQueries({ queryKey: ["scheme", schemeId, "maintenance"] });
    },
  });

  const canReport = title.trim().length >= 3 && description.trim().length >= 3 && !report.isPending;
  const requests = requestsQuery.data?.requests ?? [];
  const workOrders = workOrdersQuery.data?.workOrders ?? [];

  return (
    <Screen
      title={isOfficer ? "Maintenance" : "Report an issue"}
      eyebrow={plate(schemeQuery.data?.scheme)}
      reserveEyebrow
      refreshing={requestsQuery.isRefetching || workOrdersQuery.isRefetching}
      onRefresh={() => {
        void requestsQuery.refetch();
        if (isOfficer) void workOrdersQuery.refetch();
      }}
    >
      {/* Report form — any member. The maintenance agent triages automatically. */}
      <Card>
        <ReportForm
          title={title}
          description={description}
          onTitle={setTitle}
          onDescription={setDescription}
          onSubmit={() => report.mutate()}
          canSubmit={canReport}
          pending={report.isPending}
          error={report.isError ? "Couldn't send that report. Try again." : null}
        />
      </Card>

      <SectionHeader label={isOfficer ? "Reported issues" : "What I've reported"} />
      {requestsQuery.isPending ? (
        <Card>
          <Skeleton width="70%" height={16} />
          <View style={{ marginTop: space(3) }}>
            <Skeleton width="50%" height={14} />
          </View>
        </Card>
      ) : requestsQuery.isError && !requestsQuery.data ? (
        <ErrorState onRetry={() => requestsQuery.refetch()} />
      ) : requests.length === 0 ? (
        <EmptyState icon="construct-outline" title="Nothing reported yet" />
      ) : (
        <Card padded={false} style={{ paddingHorizontal: space(4) }}>
          {requests.map((r, i) => (
            <RequestRow key={r.id} request={r} isOfficer={isOfficer} divider={i < requests.length - 1} />
          ))}
        </Card>
      )}

      {isOfficer && workOrders.length > 0 ? (
        <>
          <SectionHeader label="Work orders" />
          <Card padded={false} style={{ paddingHorizontal: space(4) }}>
            {workOrders.map((wo, i) => (
              <WorkOrderRow
                key={wo.id}
                workOrder={wo}
                completing={complete.isPending && completingId === wo.id}
                disabled={complete.isPending}
                onComplete={() => complete.mutate(wo.id)}
                divider={i < workOrders.length - 1}
              />
            ))}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

function ReportForm({
  title,
  description,
  onTitle,
  onDescription,
  onSubmit,
  canSubmit,
  pending,
  error,
}: {
  title: string;
  description: string;
  onTitle: (v: string) => void;
  onDescription: (v: string) => void;
  onSubmit: () => void;
  canSubmit: boolean;
  pending: boolean;
  error: string | null;
}) {
  return (
    <View style={{ gap: space(3) }}>
      <FormField
        label="What's wrong?"
        value={title}
        onChangeText={onTitle}
        placeholder="e.g. Leaking tap in the car park"
        returnKeyType="next"
        maxLength={200}
      />
      <FormField
        label="Any detail that helps"
        value={description}
        onChangeText={onDescription}
        placeholder="Where it is, how bad, since when…"
        multiline
        maxLength={5000}
      />
      {error ? <Text style={{ ...t.bodySmall, color: "#c0392b" }}>{error}</Text> : null}
      <View style={{ alignItems: "flex-start", marginTop: space(1) }}>
        <Button label="Report issue" onPress={onSubmit} disabled={!canSubmit} pending={pending} />
      </View>
    </View>
  );
}

function RequestRow({
  request: r,
  isOfficer,
  divider,
}: {
  request: Request;
  isOfficer: boolean;
  divider: boolean;
}) {
  const theme = useTheme();
  const meta: string[] = [formatDate(r.createdAt.slice(0, 10))];
  if (isOfficer && r.category) meta.push(r.category);
  if (isOfficer && r.urgency) meta.push(r.urgency);
  const triage =
    r.status === "rejected" ? r.aiTriage?.declineExplanation : isOfficer ? r.aiTriage?.reasoning : undefined;

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
          {r.title}
        </Text>
        <StatusPill tone={ownerTone(r.status)} label={ownerLabel(r.status)} />
      </View>
      {r.description ? (
        <Text style={{ ...t.bodySmall, color: theme.muted, marginTop: 2 }} numberOfLines={2}>
          {r.description}
        </Text>
      ) : null}
      <Text style={{ ...t.caption, color: theme.muted, marginTop: space(1) }}>{meta.join(" · ")}</Text>
      {triage ? (
        <Text style={{ ...t.caption, color: theme.muted, marginTop: space(1), fontStyle: "italic" }} numberOfLines={3}>
          {triage}
        </Text>
      ) : null}
    </View>
  );
}

function WorkOrderRow({
  workOrder: wo,
  completing,
  disabled,
  onComplete,
  divider,
}: {
  workOrder: WorkOrder;
  completing: boolean;
  disabled: boolean;
  onComplete: () => void;
  divider: boolean;
}) {
  const theme = useTheme();
  const canComplete = COMPLETABLE_STATUSES.has(wo.status);
  const meta = [wo.contractorName ?? "Unassigned", money(wo.approvedAmountCents)];

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
          {wo.requestTitle ?? wo.scope}
        </Text>
        <StatusPill tone={wo.status === "completed" ? "ok" : "warn"} label={wo.status.replace(/_/g, " ")} />
      </View>
      <Text style={{ ...t.bodySmall, color: theme.muted, marginTop: 2 }}>{meta.join(" · ")}</Text>
      {canComplete ? (
        <View style={{ marginTop: space(3), alignItems: "flex-start" }}>
          <Button
            variant="secondary"
            label="Mark complete"
            onPress={onComplete}
            pending={completing}
            disabled={disabled}
          />
        </View>
      ) : null}
    </View>
  );
}
