import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  FormField,
  formatDate,
  formatMoneyLabel,
  humanise,
  Screen,
  SectionHeader,
  Skeleton,
  StatusPill,
  space,
  type as t,
  useTheme,
} from "../../../src/components";
import { api, apiPost } from "../../../src/lib/api";
import { useIsOfficer } from "../../../src/lib/roles";

interface Policy {
  id: string;
  kind: string;
  insurer: string;
  policyNumber: string;
  periodEnd: string;
  status: string;
}
interface InsuranceData {
  policies: Policy[];
  readiness: {
    ready: boolean;
    reasons: string[];
    buildingRequired: boolean;
    publicLiabilityRequired: boolean;
  };
}
interface PlanItem {
  id: string;
  name: string;
  scheduledOn: string;
  estimatedCostCents: number;
}
interface Plan {
  id: string;
  title: string;
  status: string;
  forecastTotalCents: number;
  items: PlanItem[];
}
interface PlanData {
  required: boolean;
  fund: { balanceCents: number };
  plans: Plan[];
}
interface Doc {
  id: string;
  title: string;
}

export default function BuildingComplianceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const schemeId = String(id ?? "");
  const theme = useTheme();
  const officer = useIsOfficer(schemeId);
  const [addingPolicy, setAddingPolicy] = useState(false);
  const [addingPlan, setAddingPlan] = useState(false);
  const insurance = useQuery({
    queryKey: ["scheme", schemeId, "insurance"],
    queryFn: () => api<InsuranceData>(`/api/schemes/${schemeId}/insurance`),
    enabled: !!schemeId,
  });
  const plans = useQuery({
    queryKey: ["scheme", schemeId, "maintenance-plans"],
    queryFn: () => api<PlanData>(`/api/schemes/${schemeId}/maintenance-plans`),
    enabled: !!schemeId,
  });
  const refresh = () => Promise.all([insurance.refetch(), plans.refetch()]);
  if ((insurance.isPending || plans.isPending) && !insurance.data && !plans.data)
    return (
      <Screen title="Insurance & plan" topInset={false}>
        <Card>
          <Skeleton width="80%" height={20} />
          <Skeleton width="60%" height={16} />
        </Card>
      </Screen>
    );
  if (!insurance.data || !plans.data)
    return (
      <Screen title="Insurance & plan" topInset={false}>
        <ErrorState onRetry={refresh} />
      </Screen>
    );
  const plan = plans.data.plans.find((p) => p.status === "approved") ?? plans.data.plans[0];
  return (
    <Screen
      title="Insurance & plan"
      topInset={false}
      refreshing={insurance.isRefetching || plans.isRefetching}
      onRefresh={refresh}
    >
      <Card>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            gap: space(3),
          }}
        >
          <Text style={[t.title, { color: theme.text, flex: 1 }]}>Insurance readiness</Text>
          <StatusPill
            tone={insurance.data.readiness.ready ? "ok" : "crit"}
            label={insurance.data.readiness.ready ? "Ready" : "Action required"}
          />
        </View>
        {insurance.data.readiness.reasons.map((reason) => (
          <Text key={reason} style={[t.bodySmall, { color: theme.crit, marginTop: space(2) }]}>
            {reason}
          </Text>
        ))}
        <Text style={[t.bodySmall, { color: theme.muted, marginTop: space(2) }]}>
          Building {insurance.data.readiness.buildingRequired ? "required" : "not required"} ·
          public liability{" "}
          {insurance.data.readiness.publicLiabilityRequired ? "required" : "not required"}
        </Text>
        {officer ? (
          <View style={{ marginTop: space(3) }}>
            <Button
              label={addingPolicy ? "Close policy form" : "Record policy"}
              variant="secondary"
              onPress={() => setAddingPolicy((v) => !v)}
            />
          </View>
        ) : null}
      </Card>
      {addingPolicy ? <PolicyForm schemeId={schemeId} /> : null}
      <Card>
        <View
          style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}
        >
          <Text style={[t.title, { color: theme.text }]}>Ten-year plan</Text>
          <StatusPill
            tone={plan?.status === "approved" ? "ok" : plans.data.required ? "warn" : "neutral"}
            label={plan?.status ?? "Not recorded"}
          />
        </View>
        <Text style={[t.figureSmall, { color: theme.text, marginTop: space(3) }]}>
          {formatMoneyLabel(plan?.forecastTotalCents ?? 0)}
        </Text>
        <Text style={[t.bodySmall, { color: theme.muted }]}>
          Forecast works · fund {formatMoneyLabel(plans.data.fund.balanceCents)}
          {plans.data.required ? " · mandatory for this tier" : ""}
        </Text>
        {officer ? (
          <View style={{ marginTop: space(3) }}>
            <Button
              label={addingPlan ? "Close plan form" : "Create draft plan"}
              variant="secondary"
              onPress={() => setAddingPlan((v) => !v)}
            />
          </View>
        ) : null}
      </Card>
      {addingPlan ? <PlanForm schemeId={schemeId} /> : null}
      {officer && plan?.status === "draft" ? (
        <PlanItemForm schemeId={schemeId} plan={plan} />
      ) : null}
      <SectionHeader label="Policies" />
      {insurance.data.policies.length === 0 ? (
        <EmptyState
          icon="shield-checkmark-outline"
          title="No structured policies"
          body="Upload the certificate in Documents, then record the policy."
        />
      ) : (
        <Card>
          {insurance.data.policies.map((p) => (
            <View
              key={p.id}
              style={{
                paddingVertical: space(2),
                borderBottomWidth: 1,
                borderBottomColor: theme.line,
              }}
            >
              <Text style={[t.body, { color: theme.text }]}>
                {humanise(p.kind)} · {p.insurer}
              </Text>
              <Text style={[t.bodySmall, { color: theme.muted }]}>
                {p.policyNumber} · expires {formatDate(p.periodEnd)}
              </Text>
            </View>
          ))}
        </Card>
      )}
      <SectionHeader label="Capital items" />
      {!plan || plan.items.length === 0 ? (
        <EmptyState
          icon="construct-outline"
          title="No capital items"
          body="Add present condition, work timing, cost and expected life before approving the plan."
        />
      ) : (
        <Card>
          {plan.items.map((item) => (
            <View
              key={item.id}
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                paddingVertical: space(2),
              }}
            >
              <View>
                <Text style={[t.body, { color: theme.text }]}>{item.name}</Text>
                <Text style={[t.bodySmall, { color: theme.muted }]}>
                  {formatDate(item.scheduledOn)}
                </Text>
              </View>
              <Text style={[t.body, { color: theme.text }]}>
                {formatMoneyLabel(item.estimatedCostCents)}
              </Text>
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}

function PolicyForm({ schemeId }: { schemeId: string }) {
  const theme = useTheme();
  const qc = useQueryClient();
  const docs = useQuery({
    queryKey: ["scheme", schemeId, "insurance-docs"],
    queryFn: () =>
      api<{ documents: Doc[] }>(`/api/schemes/${schemeId}/documents?category=insurance`),
  });
  const [kind, setKind] = useState<"building" | "public_liability">("building");
  const [insurer, setInsurer] = useState("");
  const [number, setNumber] = useState("");
  const [cover, setCover] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [doc, setDoc] = useState("");
  const save = useMutation({
    mutationFn: () =>
      apiPost(`/api/schemes/${schemeId}/insurance/policies`, {
        kind,
        insurer,
        policyNumber: number,
        sumInsuredCents: Math.round(Number(cover) * 100),
        periodStart: start,
        periodEnd: end,
        reinstatementAndReplacement: kind === "building",
        certificateDocumentId: doc,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["scheme", schemeId, "insurance"] }),
  });
  return (
    <Card>
      <Text style={[t.title, { color: theme.text }]}>Record policy</Text>
      <View style={{ flexDirection: "row", gap: space(2), marginVertical: space(3) }}>
        <Button
          label="Building"
          variant={kind === "building" ? "primary" : "secondary"}
          onPress={() => setKind("building")}
        />
        <Button
          label="Public liability"
          variant={kind === "public_liability" ? "primary" : "secondary"}
          onPress={() => setKind("public_liability")}
        />
      </View>
      <FormField label="Insurer" value={insurer} onChangeText={setInsurer} />
      <FormField label="Policy number" value={number} onChangeText={setNumber} />
      <FormField
        label="Sum insured (dollars)"
        keyboardType="decimal-pad"
        value={cover}
        onChangeText={setCover}
      />
      <FormField label="Starts (YYYY-MM-DD)" value={start} onChangeText={setStart} />
      <FormField label="Ends (YYYY-MM-DD)" value={end} onChangeText={setEnd} />
      <Text style={[t.label, { color: theme.muted, marginTop: space(2) }]}>
        Certificate document
      </Text>
      {docs.data?.documents.map((d) => (
        <Button
          key={d.id}
          label={`${doc === d.id ? "✓ " : ""}${d.title}`}
          variant="secondary"
          onPress={() => setDoc(d.id)}
        />
      ))}
      <Button
        label={save.isPending ? "Saving…" : "Record policy"}
        disabled={save.isPending || !doc}
        onPress={() => save.mutate()}
      />
      {save.error ? (
        <Text style={[t.bodySmall, { color: theme.crit }]}>{save.error.message}</Text>
      ) : null}
    </Card>
  );
}

function PlanForm({ schemeId }: { schemeId: string }) {
  const theme = useTheme();
  const qc = useQueryClient();
  const [title, setTitle] = useState("Ten-year maintenance plan");
  const [preparedOn, setPreparedOn] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const save = useMutation({
    mutationFn: () =>
      apiPost(`/api/schemes/${schemeId}/maintenance-plans`, {
        title,
        preparedOn,
        coverageStartOn: startsOn,
        approvedFormVersion: "CAV approved form — current at preparation",
      }),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ["scheme", schemeId, "maintenance-plans"] }),
  });
  return (
    <Card>
      <Text style={[t.title, { color: theme.text }]}>Create statutory plan</Text>
      <FormField label="Title" value={title} onChangeText={setTitle} />
      <FormField label="Prepared on (YYYY-MM-DD)" value={preparedOn} onChangeText={setPreparedOn} />
      <FormField label="Coverage starts (YYYY-MM-DD)" value={startsOn} onChangeText={setStartsOn} />
      <Button
        label={save.isPending ? "Creating…" : "Create ten-year draft"}
        disabled={save.isPending}
        onPress={() => save.mutate()}
      />
      {save.error ? (
        <Text style={[t.bodySmall, { color: theme.crit }]}>{save.error.message}</Text>
      ) : null}
    </Card>
  );
}

function PlanItemForm({ schemeId, plan }: { schemeId: string; plan: Plan }) {
  const theme = useTheme();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [action, setAction] = useState("");
  const [scheduledOn, setScheduledOn] = useState("");
  const [cost, setCost] = useState("");
  const [life, setLife] = useState("");
  const [approvedOn, setApprovedOn] = useState("");
  const [resolutionId, setResolutionId] = useState("");
  const [meetingId, setMeetingId] = useState("");
  const refresh = () =>
    qc.invalidateQueries({ queryKey: ["scheme", schemeId, "maintenance-plans"] });
  const add = useMutation({
    mutationFn: () =>
      apiPost(`/api/schemes/${schemeId}/maintenance-plans/${plan.id}/items`, {
        name,
        presentCondition: "unknown",
        plannedAction: action,
        scheduledOn,
        estimatedCostCents: Math.round(Number(cost) * 100),
        expectedLifeAfterWorksYears: Number(life),
      }),
    onSuccess: refresh,
  });
  const approve = useMutation({
    mutationFn: () =>
      apiPost(`/api/schemes/${schemeId}/maintenance-plans/${plan.id}/approve`, {
        approvedOn,
        approvalResolutionId: resolutionId,
        approvedAtMeetingId: meetingId,
      }),
    onSuccess: refresh,
  });
  return (
    <Card>
      <Text style={[t.title, { color: theme.text }]}>Complete draft</Text>
      <FormField label="Capital item" value={name} onChangeText={setName} />
      <FormField label="Repair or replacement" value={action} onChangeText={setAction} />
      <FormField
        label="Scheduled on (YYYY-MM-DD)"
        value={scheduledOn}
        onChangeText={setScheduledOn}
      />
      <FormField
        label="Estimated cost (dollars)"
        keyboardType="decimal-pad"
        value={cost}
        onChangeText={setCost}
      />
      <FormField
        label="Expected life after works (years)"
        keyboardType="number-pad"
        value={life}
        onChangeText={setLife}
      />
      <Button
        label={add.isPending ? "Adding…" : "Add capital item"}
        disabled={add.isPending}
        onPress={() => add.mutate()}
      />
      <View style={{ height: 1, backgroundColor: theme.line, marginVertical: space(3) }} />
      <FormField label="Approved on (YYYY-MM-DD)" value={approvedOn} onChangeText={setApprovedOn} />
      <FormField
        label="Ordinary resolution ID"
        value={resolutionId}
        onChangeText={setResolutionId}
      />
      <FormField label="Meeting ID" value={meetingId} onChangeText={setMeetingId} />
      <Button
        label={approve.isPending ? "Approving…" : "Approve plan"}
        disabled={approve.isPending || plan.items.length === 0}
        onPress={() => approve.mutate()}
      />
      {add.error || approve.error ? (
        <Text style={[t.bodySmall, { color: theme.crit }]}>
          {(add.error ?? approve.error)?.message}
        </Text>
      ) : null}
    </Card>
  );
}
