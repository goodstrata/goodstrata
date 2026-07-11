import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  FormField,
  formatDate,
  humanise,
  plate,
  radius,
  Screen,
  SectionHeader,
  Sheet,
  Skeleton,
  StatusPill,
  type StatusToneName,
  space,
  type as t,
  useTheme,
} from "../../../src/components";
import { api, apiPost } from "../../../src/lib/api";
import { schemeQueryOptions, useIsOfficer } from "../../../src/lib/roles";

// Mirrors GET /schemes/:id/complaints(/mine) + POST /complaints (apps/web GrievancesTab).
interface Complaint {
  id: string;
  complainantPersonId: string;
  respondentPersonId: string | null;
  subject: string;
  details: string;
  approvedForm: boolean;
  status: string;
  receivedAt: string;
  meetByDate: string;
  resolvedAt: string | null;
}

interface ComplaintEvent {
  id: string;
  kind: string;
  note: string | null;
  at: string;
}

interface BreachNotice {
  id: string;
  complaintId: string | null;
  subjectLotId: string | null;
  subjectPersonId: string | null;
  ruleRef: string;
  type: "notice_to_rectify" | "final_notice";
  issuedAt: string;
  rectifyByDate: string;
  status: string;
  details: string;
}

interface ComplaintDetail {
  complaint: Complaint;
  events: ComplaintEvent[];
  breachNotices: BreachNotice[];
}

const NEXT_STATUSES: Record<string, string[]> = {
  received: ["under_discussion", "resolved", "withdrawn"],
  under_discussion: ["notice_to_rectify", "resolved", "withdrawn", "vcat"],
  notice_to_rectify: ["final_notice", "resolved", "withdrawn", "vcat"],
  final_notice: ["vcat", "resolved", "withdrawn"],
  resolved: [],
  withdrawn: [],
  vcat: ["resolved", "withdrawn"],
};

const CLOSED = new Set(["resolved", "withdrawn"]);

// ComplaintStatus → kit tone (mirrors the web STATUS_TONE, mapped onto ok/warn/crit).
function complaintTone(status: string): StatusToneName {
  if (status === "resolved" || status === "withdrawn") return "ok";
  if (status === "final_notice" || status === "vcat") return "crit";
  return "warn";
}
function complaintLabel(status: string): string {
  if (status === "vcat") return "VCAT";
  return humanise(status);
}

export default function GrievancesScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ id: string; focus?: string }>();
  const schemeId = String(params.id ?? "");
  const isOfficer = useIsOfficer(schemeId);
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(params.focus ?? null);

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
      title={selectedId ? "Grievance detail" : "Grievances"}
      topInset={false}
      eyebrow={plate(schemeQuery.data?.scheme)}
      reserveEyebrow
      refreshing={complaintsQuery.isRefetching}
      onRefresh={() => complaintsQuery.refetch()}
    >
      {selectedId && isOfficer ? (
        <ComplaintDetailView
          schemeId={schemeId}
          complaintId={selectedId}
          onBack={() => setSelectedId(null)}
          onChanged={() => {
            void queryClient.invalidateQueries({ queryKey: ["scheme", schemeId, "complaints"] });
          }}
        />
      ) : (
        <>
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
                <Text style={{ ...t.bodySmall, color: theme.crit }}>
                  Couldn't file that. Try again.
                </Text>
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
                <ComplaintRow
                  key={c.id}
                  complaint={c}
                  focused={params.focus === c.id}
                  onPress={isOfficer ? () => setSelectedId(c.id) : undefined}
                  divider={i < complaints.length - 1}
                />
              ))}
            </Card>
          )}
        </>
      )}
    </Screen>
  );
}

function ComplaintRow({
  complaint: c,
  focused,
  onPress,
  divider,
}: {
  complaint: Complaint;
  focused: boolean;
  onPress?: () => void;
  divider: boolean;
}) {
  const theme = useTheme();
  const closed = CLOSED.has(c.status);
  const meta = closed
    ? c.resolvedAt
      ? `Closed ${formatDate(c.resolvedAt.slice(0, 10))}`
      : `Received ${formatDate(c.receivedAt.slice(0, 10))}`
    : `Respond by ${formatDate(c.meetByDate)}`;

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={onPress ? `Open ${c.subject}` : undefined}
      style={{
        backgroundColor: focused ? theme.accentSoft : "transparent",
        marginHorizontal: focused ? -space(2) : 0,
        paddingHorizontal: focused ? space(2) : 0,
        borderRadius: focused ? radius.control : 0,
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
    </Pressable>
  );
}

interface RollPerson {
  id: string;
  givenName: string | null;
  familyName: string | null;
  companyName: string | null;
  email: string | null;
}

function rollName(person: RollPerson | undefined): string {
  if (!person) return "Unknown";
  return (
    [person.givenName, person.familyName].filter(Boolean).join(" ") ||
    person.companyName ||
    person.email ||
    "Unnamed"
  );
}

function ComplaintDetailView({
  schemeId,
  complaintId,
  onBack,
  onChanged,
}: {
  schemeId: string;
  complaintId: string;
  onBack: () => void;
  onChanged: () => void;
}) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [showStatus, setShowStatus] = useState(false);
  const [showNotice, setShowNotice] = useState(false);
  const detailQuery = useQuery({
    queryKey: ["scheme", schemeId, "complaint", complaintId],
    queryFn: () => api<ComplaintDetail>(`/api/schemes/${schemeId}/complaints/${complaintId}`),
  });
  const peopleQuery = useQuery({
    queryKey: ["scheme", schemeId, "people"],
    queryFn: () => api<{ people: RollPerson[] }>(`/api/schemes/${schemeId}/people`),
  });
  const refresh = async () => {
    await queryClient.invalidateQueries({
      queryKey: ["scheme", schemeId, "complaint", complaintId],
    });
    onChanged();
  };

  if (detailQuery.isPending) {
    return (
      <Card style={{ gap: space(3) }}>
        <Skeleton width="75%" height={20} />
        <Skeleton width="100%" height={70} />
      </Card>
    );
  }
  if (detailQuery.isError || !detailQuery.data) {
    return <ErrorState onRetry={() => detailQuery.refetch()} />;
  }

  const { complaint, events, breachNotices } = detailQuery.data;
  const people = peopleQuery.data?.people ?? [];
  const nameOf = (id: string | null) =>
    id ? rollName(people.find((person) => person.id === id)) : null;
  const next = NEXT_STATUSES[complaint.status] ?? [];

  return (
    <View style={{ gap: space(4) }}>
      <View style={{ alignItems: "flex-start" }}>
        <Button variant="secondary" label="Back to register" onPress={onBack} />
      </View>
      <Card>
        <View style={{ gap: space(3) }}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space(2) }}>
            <Text style={{ ...t.title, color: theme.text, flex: 1 }}>{complaint.subject}</Text>
            <StatusPill
              tone={complaintTone(complaint.status)}
              label={complaintLabel(complaint.status)}
            />
          </View>
          <View style={{ gap: space(1) }}>
            <DetailLine
              label="Complainant"
              value={nameOf(complaint.complainantPersonId) ?? "Unknown"}
            />
            <DetailLine
              label="About"
              value={nameOf(complaint.respondentPersonId) ?? "The owners corporation generally"}
            />
            <DetailLine label="Received" value={formatDate(complaint.receivedAt.slice(0, 10))} />
            <DetailLine label="Approved form" value={complaint.approvedForm ? "Yes" : "No"} />
          </View>
          <Text style={{ ...t.body, color: theme.text }}>{complaint.details}</Text>
          {!CLOSED.has(complaint.status) ? (
            <Text style={{ ...t.bodySmall, color: theme.muted }}>
              Must be dealt with by {formatDate(complaint.meetByDate)}
            </Text>
          ) : null}
        </View>
      </Card>

      {next.length > 0 ? (
        <View style={{ alignItems: "flex-start" }}>
          <Button label="Progress complaint" onPress={() => setShowStatus(true)} />
        </View>
      ) : (
        <Card>
          <Text style={{ ...t.bodySmall, color: theme.muted }}>
            This complaint is closed. No further status changes are available.
          </Text>
        </Card>
      )}

      {complaint.respondentPersonId ? (
        <View style={{ alignItems: "flex-start" }}>
          <Button
            variant="secondary"
            label="Issue breach notice"
            onPress={() => setShowNotice(true)}
          />
        </View>
      ) : (
        <Text style={{ ...t.bodySmall, color: theme.muted }}>
          A breach notice needs a named respondent.
        </Text>
      )}

      {breachNotices.length > 0 ? (
        <View>
          <SectionHeader label="Breach notices" />
          <View style={{ gap: space(3) }}>
            {breachNotices.map((notice) => (
              <BreachNoticeCard
                key={notice.id}
                schemeId={schemeId}
                notice={notice}
                onChanged={refresh}
              />
            ))}
          </View>
        </View>
      ) : null}

      <View>
        <SectionHeader label="History" />
        <Card>
          {events.map((event, index) => (
            <View
              key={event.id}
              style={{
                paddingVertical: space(2),
                borderBottomWidth: index < events.length - 1 ? StyleSheet.hairlineWidth : 0,
                borderBottomColor: theme.line,
              }}
            >
              <Text style={{ ...t.label, color: theme.text }}>{humanise(event.kind)}</Text>
              {event.note ? (
                <Text style={{ ...t.bodySmall, color: theme.muted }}>{event.note}</Text>
              ) : null}
              <Text style={{ ...t.caption, color: theme.muted }}>
                {new Date(event.at).toLocaleString("en-AU")}
              </Text>
            </View>
          ))}
        </Card>
      </View>

      <StatusChangeSheet
        visible={showStatus}
        schemeId={schemeId}
        complaint={complaint}
        onClose={() => setShowStatus(false)}
        onChanged={refresh}
      />
      <BreachNoticeSheet
        visible={showNotice}
        schemeId={schemeId}
        complaint={complaint}
        onClose={() => setShowNotice(false)}
        onChanged={refresh}
      />
    </View>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: "row", gap: space(2) }}>
      <Text style={{ ...t.caption, color: theme.muted, width: 82 }}>{label}</Text>
      <Text style={{ ...t.bodySmall, color: theme.text, flex: 1 }}>{value}</Text>
    </View>
  );
}

function StatusChangeSheet({
  visible,
  schemeId,
  complaint,
  onClose,
  onChanged,
}: {
  visible: boolean;
  schemeId: string;
  complaint: Complaint;
  onClose: () => void;
  onChanged: () => Promise<unknown>;
}) {
  const theme = useTheme();
  const next = NEXT_STATUSES[complaint.status] ?? [];
  const [target, setTarget] = useState(next[0] ?? "");
  const [note, setNote] = useState("");
  const mutation = useMutation({
    mutationFn: () =>
      apiPost(`/api/schemes/${schemeId}/complaints/${complaint.id}/advance`, {
        status: target,
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    onSuccess: async () => {
      setNote("");
      await onChanged();
      onClose();
    },
  });
  return (
    <Sheet visible={visible} onClose={() => !mutation.isPending && onClose()}>
      <View style={{ gap: space(4) }}>
        <View style={{ gap: space(1) }}>
          <Text style={{ ...t.title, color: theme.text }}>Progress complaint</Text>
          <Text style={{ ...t.bodySmall, color: theme.muted }}>
            Every change is recorded in the statutory audit trail.
          </Text>
        </View>
        <ChoicePills values={next} value={target} onChange={setTarget} />
        <FormField
          label="Note for the record (optional)"
          value={note}
          onChangeText={setNote}
          multiline
          maxLength={5000}
        />
        {mutation.isError ? (
          <Text style={{ ...t.bodySmall, color: theme.critFill }}>{mutation.error.message}</Text>
        ) : null}
        <Button
          label="Update status"
          full
          pending={mutation.isPending}
          disabled={!target}
          onPress={() => mutation.mutate()}
        />
      </View>
    </Sheet>
  );
}

function BreachNoticeSheet({
  visible,
  schemeId,
  complaint,
  onClose,
  onChanged,
}: {
  visible: boolean;
  schemeId: string;
  complaint: Complaint;
  onClose: () => void;
  onChanged: () => Promise<unknown>;
}) {
  const theme = useTheme();
  const [type, setType] = useState<"notice_to_rectify" | "final_notice">("notice_to_rectify");
  const [ruleRef, setRuleRef] = useState("");
  const [details, setDetails] = useState("");
  const mutation = useMutation({
    mutationFn: () => {
      if (!ruleRef.trim()) throw new Error("Name the rule that was contravened.");
      if (details.trim().length < 3) throw new Error("Describe what must be rectified.");
      return apiPost(`/api/schemes/${schemeId}/breach-notices`, {
        complaintId: complaint.id,
        subjectPersonId: complaint.respondentPersonId,
        ruleRef: ruleRef.trim(),
        type,
        details: details.trim(),
      });
    },
    onSuccess: async () => {
      setRuleRef("");
      setDetails("");
      await onChanged();
      onClose();
    },
  });
  return (
    <Sheet visible={visible} onClose={() => !mutation.isPending && onClose()}>
      <View style={{ gap: space(4) }}>
        <View style={{ gap: space(1) }}>
          <Text style={{ ...t.title, color: theme.text }}>Issue breach notice</Text>
          <Text style={{ ...t.bodySmall, color: theme.muted }}>
            The named party has 28 days to rectify the breach.
          </Text>
        </View>
        <ChoicePills
          values={["notice_to_rectify", "final_notice"] as const}
          value={type}
          onChange={setType}
        />
        <FormField
          label="Rule contravened"
          placeholder="Model Rule 4.1 (noise)"
          value={ruleRef}
          onChangeText={setRuleRef}
        />
        <FormField
          label="What must be rectified?"
          value={details}
          onChangeText={setDetails}
          multiline
          maxLength={5000}
        />
        {mutation.isError ? (
          <Text style={{ ...t.bodySmall, color: theme.critFill }}>{mutation.error.message}</Text>
        ) : null}
        <Button
          label="Issue notice"
          full
          pending={mutation.isPending}
          onPress={() => mutation.mutate()}
        />
      </View>
    </Sheet>
  );
}

function BreachNoticeCard({
  schemeId,
  notice,
  onChanged,
}: {
  schemeId: string;
  notice: BreachNotice;
  onChanged: () => Promise<unknown>;
}) {
  const theme = useTheme();
  const close = useMutation({
    mutationFn: (status: "rectified" | "escalated" | "withdrawn") =>
      apiPost(`/api/schemes/${schemeId}/breach-notices/${notice.id}/close`, { status }),
    onSuccess: () => onChanged(),
  });
  return (
    <Card>
      <View style={{ gap: space(2) }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
          <Text style={{ ...t.label, color: theme.text, flex: 1 }}>{humanise(notice.type)}</Text>
          <StatusPill
            tone={
              notice.status === "rectified" ? "ok" : notice.status === "escalated" ? "crit" : "info"
            }
            label={humanise(notice.status)}
          />
        </View>
        <Text style={{ ...t.bodySmall, color: theme.muted }}>
          {notice.ruleRef} · rectify by {formatDate(notice.rectifyByDate)}
        </Text>
        <Text style={{ ...t.bodySmall, color: theme.text }}>{notice.details}</Text>
        {close.isError ? (
          <Text style={{ ...t.caption, color: theme.critFill }}>{close.error.message}</Text>
        ) : null}
        {notice.status === "issued" ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
            <Button
              variant="secondary"
              label="Rectified"
              disabled={close.isPending}
              onPress={() => close.mutate("rectified")}
            />
            <Button
              variant="secondary"
              label="Escalated"
              disabled={close.isPending}
              onPress={() => close.mutate("escalated")}
            />
            <Button
              variant="secondary"
              label="Withdraw"
              disabled={close.isPending}
              onPress={() => close.mutate("withdrawn")}
            />
          </View>
        ) : null}
      </View>
    </Card>
  );
}

function ChoicePills<T extends string>({
  values,
  value,
  onChange,
}: {
  values: readonly T[];
  value: T;
  onChange: (value: T) => void;
}) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
      {values.map((option) => {
        const selected = value === option;
        return (
          <Text
            key={option}
            onPress={() => onChange(option)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            style={{
              ...t.bodySmall,
              color: selected ? theme.onPrimary : theme.text,
              backgroundColor: selected ? theme.accentFill : theme.surface,
              borderWidth: 1,
              borderColor: selected ? theme.accentFill : theme.line,
              borderRadius: radius.pill,
              paddingHorizontal: space(3),
              paddingVertical: space(2),
              overflow: "hidden",
            }}
          >
            {humanise(option)}
          </Text>
        );
      })}
    </View>
  );
}
