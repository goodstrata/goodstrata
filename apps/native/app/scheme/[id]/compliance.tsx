import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";
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
  space,
  type as t,
  useListEntering,
  useTheme,
} from "../../../src/components";
import { api, apiPost } from "../../../src/lib/api";
import { schemeQueryOptions, useIsOfficer } from "../../../src/lib/roles";

// ---------------------------------------------------------------------------
// Mirror of GET /schemes/:id/compliance (see apps/web ComplianceTab)
// ---------------------------------------------------------------------------

interface Obligation {
  id: string;
  schemeId: string | null;
  kind: string;
  title: string;
  dueOn: string;
  status: string;
  escalationState: string;
  responsibleRole: string | null;
  completedAt: string | null;
}

interface ComplianceResponse {
  obligations: Obligation[];
}

const KIND_LABEL: Record<string, string> = {
  agm_due: "AGM due",
  insurance_renewal: "Insurance renewal",
  valuation: "Insurance valuation",
  esm_inspection: "Essential safety measures",
  financial_statements: "Financial statements",
  bas: "BAS lodgement",
  registration_renewal: "Manager registration renewal",
  pi_expiry: "Manager PI insurance",
  custom: "Other obligations",
};
// Calendar order (mirrors the web KINDS).
const KIND_ORDER = [
  "agm_due",
  "insurance_renewal",
  "valuation",
  "esm_inspection",
  "financial_statements",
  "bas",
  "registration_renewal",
  "pi_expiry",
  "custom",
];

const OPEN_STATUSES = new Set(["upcoming", "due", "overdue"]);

/** escalationState → StatusPill tone (kit has ok/warn/crit) + short label. */
const ESCALATION: Record<string, { tone: "warn" | "crit" | "info" | "neutral"; label: string }> = {
  overdue: { tone: "crit", label: "Overdue" },
  due: { tone: "crit", label: "Due now" },
  t_30: { tone: "warn", label: "≤ 30 days" },
  t_60: { tone: "info", label: "≤ 60 days" },
  t_90: { tone: "info", label: "≤ 90 days" },
  none: { tone: "neutral", label: "> 90 days" },
};

const RAISABLE_KINDS = [
  "custom",
  "agm_due",
  "insurance_renewal",
  "esm_inspection",
  "financial_statements",
  "bas",
  "valuation",
] as const;
type RaisableKind = (typeof RAISABLE_KINDS)[number];

const RESPONSIBLE_ROLES = ["default", "chair", "secretary", "treasurer", "manager_admin"] as const;
type ResponsibleRole = (typeof RESPONSIBLE_ROLES)[number];

function daysUntil(dueOn: string): number {
  const due = new Date(`${dueOn}T00:00:00`);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

/** "3 days overdue" / "due today" / "due in 12 days" — mirrors the web copy. */
function relativeDue(dueOn: string): string {
  const d = daysUntil(dueOn);
  if (d < 0) return `${-d} day${d === -1 ? "" : "s"} overdue`;
  if (d === 0) return "due today";
  if (d === 1) return "due tomorrow";
  return `due in ${d} days`;
}

function humanRole(role: string | null): string | null {
  return role ? humanise(role) : null;
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function ComplianceScreen() {
  const params = useLocalSearchParams<{ id: string; focus?: string }>();
  const schemeId = String(params.id ?? "");
  // Any scheme member sees the calendar; closing an obligation is an officer act.
  const isOfficer = useIsOfficer(schemeId);
  const [showClosed, setShowClosed] = useState(false);
  const window = showClosed ? "all" : "open";
  const queryClient = useQueryClient();
  const theme = useTheme();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [kind, setKind] = useState<RaisableKind>("custom");
  const [responsibleRole, setResponsibleRole] = useState<ResponsibleRole>("default");
  const [addError, setAddError] = useState<string | null>(null);

  const schemeQuery = useQuery({ ...schemeQueryOptions(schemeId), enabled: !!schemeId });
  const complianceQuery = useQuery({
    queryKey: ["scheme", schemeId, "compliance", window],
    queryFn: () => api<ComplianceResponse>(`/api/schemes/${schemeId}/compliance?window=${window}`),
    enabled: !!schemeId,
  });

  const [closing, setClosing] = useState<{ id: string; waived: boolean } | null>(null);
  const complete = useMutation({
    mutationFn: ({ id, waived }: { id: string; waived: boolean }) =>
      apiPost(`/api/schemes/${schemeId}/compliance/${id}/complete`, { waived }),
    onMutate: (input) => setClosing(input),
    onSettled: () => setClosing(null),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["scheme", schemeId, "compliance"] });
    },
  });
  const addObligation = useMutation({
    mutationFn: () => {
      const cleanTitle = title.trim();
      if (!cleanTitle) throw new Error("Give the obligation a name.");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) throw new Error("Enter a due date as YYYY-MM-DD.");
      return apiPost<{ obligation: Obligation }>(`/api/schemes/${schemeId}/compliance`, {
        title: cleanTitle,
        kind,
        dueOn,
        ...(responsibleRole === "default" ? {} : { responsibleRole }),
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["scheme", schemeId, "compliance"] });
      setTitle("");
      setDueOn("");
      setKind("custom");
      setResponsibleRole("default");
      setAddError(null);
      setAdding(false);
    },
    onError: (error) =>
      setAddError(error instanceof Error ? error.message : "Couldn't add the obligation."),
  });

  const obligations = complianceQuery.data?.obligations ?? [];
  const open = obligations.filter((o) => OPEN_STATUSES.has(o.status));
  const overdue = open.filter((o) => o.escalationState === "overdue").length;
  const dueSoon = open.filter(
    (o) => o.escalationState === "due" || o.escalationState === "t_30",
  ).length;

  const groups = KIND_ORDER.map((k) => ({
    key: k,
    label: KIND_LABEL[k] ?? k,
    items: obligations.filter((o) => o.kind === k).sort((a, b) => a.dueOn.localeCompare(b.dueOn)),
  })).filter((g) => g.items.length > 0);

  const hadDataRef = useRef(false);
  const firstLoad = !hadDataRef.current && complianceQuery.isSuccess;
  useEffect(() => {
    if (complianceQuery.isSuccess) hadDataRef.current = true;
  }, [complianceQuery.isSuccess]);
  const entering = useListEntering(firstLoad);

  const eyebrow = plate(schemeQuery.data?.scheme);

  let content: React.ReactNode;
  if (complianceQuery.isPending) {
    content = <ComplianceSkeleton />;
  } else if (complianceQuery.isError && !complianceQuery.data) {
    content = <ErrorState onRetry={() => complianceQuery.refetch()} />;
  } else if (obligations.length === 0) {
    content = (
      <EmptyState
        icon="shield-checkmark-outline"
        title={showClosed ? "Nothing on the calendar" : "Nothing due"}
      />
    );
  } else {
    let stagger = 0;
    content = (
      <>
        {overdue > 0 || dueSoon > 0 ? (
          <View style={{ flexDirection: "row", gap: space(2), marginBottom: space(2) }}>
            {overdue > 0 ? <StatusPill tone="crit" label={`${overdue} overdue`} /> : null}
            {dueSoon > 0 ? <StatusPill tone="warn" label={`${dueSoon} due soon`} /> : null}
          </View>
        ) : null}
        {groups.map((group) => (
          <Animated.View key={group.key} entering={entering(stagger++)}>
            <SectionHeader label={group.label} />
            <Card padded={false} style={{ paddingHorizontal: space(4) }}>
              {group.items.map((o, i) => (
                <ObligationRow
                  key={o.id}
                  obligation={o}
                  isOfficer={isOfficer}
                  focused={params.focus === o.id}
                  closing={
                    complete.isPending && closing?.id === o.id
                      ? closing.waived
                        ? "waive"
                        : "done"
                      : null
                  }
                  disabled={complete.isPending}
                  onClose={(waived) => complete.mutate({ id: o.id, waived })}
                  divider={i < group.items.length - 1}
                />
              ))}
            </Card>
          </Animated.View>
        ))}
      </>
    );
  }

  return (
    <Screen
      title="Compliance"
      topInset={false}
      eyebrow={eyebrow}
      reserveEyebrow
      refreshing={complianceQuery.isRefetching}
      onRefresh={() => complianceQuery.refetch()}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          flexWrap: "wrap",
          gap: space(2),
          marginBottom: space(3),
        }}
      >
        <Button
          variant="secondary"
          label={showClosed ? "Hide completed" : "Show completed"}
          onPress={() => setShowClosed((v) => !v)}
        />
        {isOfficer ? (
          <Button
            label="Add obligation"
            onPress={() => {
              setAddError(null);
              setAdding(true);
            }}
          />
        ) : null}
      </View>
      {content}
      <Sheet visible={adding} onClose={() => !addObligation.isPending && setAdding(false)}>
        <View style={{ gap: space(4) }}>
          <View style={{ gap: space(1) }}>
            <Text style={{ ...t.title, color: theme.text }}>Add an obligation</Text>
            <Text style={{ ...t.bodySmall, color: theme.muted }}>
              Track a deadline that is not raised automatically. It will escalate as the date nears.
            </Text>
          </View>
          <FormField
            label="Title"
            placeholder="Fire panel annual service"
            value={title}
            onChangeText={setTitle}
            maxLength={200}
          />
          <FormField
            label="Due date (YYYY-MM-DD)"
            placeholder="2026-08-31"
            value={dueOn}
            onChangeText={setDueOn}
            keyboardType="numbers-and-punctuation"
            maxLength={10}
          />
          <OptionPicker
            label="Category"
            values={RAISABLE_KINDS}
            value={kind}
            labelFor={(value) =>
              value === "custom" ? "Other / custom" : (KIND_LABEL[value] ?? humanise(value))
            }
            onChange={setKind}
          />
          <OptionPicker
            label="Responsible"
            values={RESPONSIBLE_ROLES}
            value={responsibleRole}
            labelFor={(value) => (value === "default" ? "Category default" : humanise(value))}
            onChange={setResponsibleRole}
          />
          {addError ? (
            <Text style={{ ...t.bodySmall, color: theme.critFill }}>{addError}</Text>
          ) : null}
          <Button
            label="Add to calendar"
            full
            pending={addObligation.isPending}
            onPress={() => {
              setAddError(null);
              addObligation.mutate();
            }}
          />
        </View>
      </Sheet>
    </Screen>
  );
}

function ObligationRow({
  obligation: o,
  isOfficer,
  focused,
  closing,
  disabled,
  onClose,
  divider,
}: {
  obligation: Obligation;
  isOfficer: boolean;
  focused: boolean;
  closing: "done" | "waive" | null;
  disabled: boolean;
  onClose: (waived: boolean) => void;
  divider: boolean;
}) {
  const theme = useTheme();
  const isOpen = OPEN_STATUSES.has(o.status);
  const esc = ESCALATION[o.escalationState];
  const role = humanRole(o.responsibleRole);
  const done = o.status === "done";
  const [confirmWaive, setConfirmWaive] = useState(false);

  const subtitleParts = [formatDate(o.dueOn)];
  if (isOpen) subtitleParts.push(relativeDue(o.dueOn));
  else if (o.completedAt) subtitleParts.push(`closed ${formatDate(o.completedAt.slice(0, 10))}`);
  if (role) subtitleParts.push(role);

  return (
    <View
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
          {o.title}
        </Text>
        {isOpen && esc ? (
          <StatusPill tone={esc.tone} label={esc.label} />
        ) : done ? (
          <StatusPill tone="ok" label="Done" />
        ) : null}
      </View>
      <Text style={{ ...t.bodySmall, color: theme.muted, marginTop: 2 }}>
        {subtitleParts.join(" · ")}
      </Text>
      {isOfficer && isOpen ? (
        <View
          style={{ marginTop: space(3), flexDirection: "row", gap: space(2), flexWrap: "wrap" }}
        >
          <Button
            variant={confirmWaive ? "destructive" : "secondary"}
            label={confirmWaive ? "Confirm waive" : "Waive"}
            onPress={() => {
              if (confirmWaive) {
                setConfirmWaive(false);
                onClose(true);
              } else {
                setConfirmWaive(true);
              }
            }}
            pending={closing === "waive"}
            disabled={disabled}
          />
          <Button
            variant="secondary"
            label="Mark done"
            onPress={() => onClose(false)}
            pending={closing === "done"}
            disabled={disabled}
          />
        </View>
      ) : null}
    </View>
  );
}

function OptionPicker<T extends string>({
  label,
  values,
  value,
  labelFor,
  onChange,
}: {
  label: string;
  values: readonly T[];
  value: T;
  labelFor: (value: T) => string;
  onChange: (value: T) => void;
}) {
  const theme = useTheme();
  return (
    <View style={{ gap: space(2) }}>
      <Text style={{ ...t.label, color: theme.muted }}>{label}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
        {values.map((option) => {
          const selected = option === value;
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
                borderColor: selected ? theme.accentFill : theme.line,
                borderWidth: 1,
                borderRadius: radius.pill,
                paddingHorizontal: space(3),
                paddingVertical: space(2),
                overflow: "hidden",
              }}
            >
              {labelFor(option)}
            </Text>
          );
        })}
      </View>
    </View>
  );
}

function ComplianceSkeleton() {
  return (
    <View>
      <SectionHeader label="Insurance renewal" />
      <Card padded={false} style={{ paddingHorizontal: space(4), paddingVertical: space(3) }}>
        <View style={{ gap: space(4), paddingVertical: space(1) }}>
          <Skeleton width="72%" height={16} />
          <Skeleton width="58%" height={16} />
        </View>
      </Card>
    </View>
  );
}
