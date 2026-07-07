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
  Screen,
  SectionHeader,
  Skeleton,
  StatusPill,
  formatDate,
  plate,
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
const ESCALATION: Record<string, { tone: "warn" | "crit"; label: string }> = {
  overdue: { tone: "crit", label: "Overdue" },
  due: { tone: "crit", label: "Due now" },
  t_30: { tone: "warn", label: "≤ 30 days" },
};

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
  return role ? role.replace(/_/g, " ") : null;
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function ComplianceScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const schemeId = String(params.id ?? "");
  // Any scheme member sees the calendar; closing an obligation is an officer act.
  const isOfficer = useIsOfficer(schemeId);
  const [showClosed, setShowClosed] = useState(false);
  const window = showClosed ? "all" : "open";
  const queryClient = useQueryClient();

  const schemeQuery = useQuery({ ...schemeQueryOptions(schemeId), enabled: !!schemeId });
  const complianceQuery = useQuery({
    queryKey: ["scheme", schemeId, "compliance", window],
    queryFn: () =>
      api<ComplianceResponse>(`/api/schemes/${schemeId}/compliance?window=${window}`),
    enabled: !!schemeId,
  });

  const [closingId, setClosingId] = useState<string | null>(null);
  const complete = useMutation({
    mutationFn: (obligationId: string) =>
      apiPost(`/api/schemes/${schemeId}/compliance/${obligationId}/complete`, { waived: false }),
    onMutate: (obligationId: string) => setClosingId(obligationId),
    onSettled: () => setClosingId(null),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["scheme", schemeId, "compliance"] });
    },
  });

  const obligations = complianceQuery.data?.obligations ?? [];
  const open = obligations.filter((o) => OPEN_STATUSES.has(o.status));
  const overdue = open.filter((o) => o.escalationState === "overdue").length;
  const dueSoon = open.filter((o) => o.escalationState === "due" || o.escalationState === "t_30")
    .length;

  const groups = KIND_ORDER.map((k) => ({
    key: k,
    label: KIND_LABEL[k] ?? k,
    items: obligations
      .filter((o) => o.kind === k)
      .sort((a, b) => a.dueOn.localeCompare(b.dueOn)),
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
                  closing={complete.isPending && closingId === o.id}
                  disabled={complete.isPending}
                  onDone={() => complete.mutate(o.id)}
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
      eyebrow={eyebrow}
      reserveEyebrow
      refreshing={complianceQuery.isRefetching}
      onRefresh={() => complianceQuery.refetch()}
    >
      <View style={{ alignItems: "flex-start", marginBottom: space(3) }}>
        <Button
          variant="secondary"
          label={showClosed ? "Hide completed" : "Show completed"}
          onPress={() => setShowClosed((v) => !v)}
        />
      </View>
      {content}
    </Screen>
  );
}

function ObligationRow({
  obligation: o,
  isOfficer,
  closing,
  disabled,
  onDone,
  divider,
}: {
  obligation: Obligation;
  isOfficer: boolean;
  closing: boolean;
  disabled: boolean;
  onDone: () => void;
  divider: boolean;
}) {
  const theme = useTheme();
  const isOpen = OPEN_STATUSES.has(o.status);
  const esc = ESCALATION[o.escalationState];
  const role = humanRole(o.responsibleRole);
  const done = o.status === "done";

  const subtitleParts = [formatDate(o.dueOn)];
  if (isOpen) subtitleParts.push(relativeDue(o.dueOn));
  else if (o.completedAt) subtitleParts.push(`closed ${formatDate(o.completedAt.slice(0, 10))}`);
  if (role) subtitleParts.push(role);

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
        <View style={{ marginTop: space(3), alignItems: "flex-start" }}>
          <Button
            variant="secondary"
            label="Mark done"
            onPress={onDone}
            pending={closing}
            disabled={disabled}
          />
        </View>
      ) : null}
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
