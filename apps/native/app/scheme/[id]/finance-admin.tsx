import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { type ReactNode, useState } from "react";
import { Text, View } from "react-native";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Figure,
  FormField,
  formatDate,
  humanise,
  ListRow,
  PressableScale,
  plate,
  Screen,
  SectionHeader,
  Sheet,
  Skeleton,
  StatusPill,
  space,
  statusTone,
  type as t,
  useTheme,
} from "../../../src/components";
import { api, apiPost } from "../../../src/lib/api";
import { downloadAndShare } from "../../../src/lib/files";
import { schemeQueryOptions, useIsOfficer } from "../../../src/lib/roles";

interface Budget {
  id: string;
  fiscalYearStart: string;
  status: string;
  lines: { fundKind: string; amountCents: number }[];
  adoptedByMotionId?: string | null;
}
interface Schedule {
  id: string;
  budgetId: string;
  frequency: string;
  instalments: number;
  firstDueOn: string;
}
interface Notice {
  id: string;
  noticeNumber: string;
  lotId: string;
  instalment: number;
  totalCents: number;
  dueOn: string;
  status: string;
  payid: string | null;
}
interface Payment {
  id: string;
  amountCents: number;
  paidAt: string;
  payerName: string | null;
  status: string;
  receiptNumber: string | null;
  noticeNumber: string | null;
}
interface Lot {
  id: string;
  lotNumber: string;
}
interface FinancialStatement {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  requiredReviewKind: "audit" | "independent_review" | null;
  review: { kind: string; outcome: string } | null;
}
interface InterestAuthorisation {
  id: string;
  rateBps: number;
  effectiveFrom: string;
  effectiveUntil: string | null;
}

type SheetKind =
  | "budget"
  | "adopt_budget"
  | "schedule"
  | "special_fee"
  | "statement"
  | "review"
  | "interest"
  | "payment"
  | "match"
  | "writeoff"
  | "refund"
  | null;

function dollars(value: string): number {
  return Math.round(Number(value || "0") * 100);
}

export default function FinanceAdmin() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ id: string; focus?: string }>();
  const schemeId = String(params.id ?? "");
  const focus = String(params.focus ?? "");
  const isOfficer = useIsOfficer(schemeId);
  const queryClient = useQueryClient();
  const scheme = useQuery({ ...schemeQueryOptions(schemeId), enabled: !!schemeId });
  const budgets = useQuery({
    queryKey: ["scheme", schemeId, "budgets"],
    queryFn: () => api<{ budgets: Budget[] }>(`/api/schemes/${schemeId}/budgets`),
    enabled: !!schemeId && isOfficer,
  });
  const schedules = useQuery({
    queryKey: ["scheme", schemeId, "levy-schedules"],
    queryFn: () => api<{ schedules: Schedule[] }>(`/api/schemes/${schemeId}/levy-schedules`),
    enabled: !!schemeId && isOfficer,
  });
  const notices = useQuery({
    queryKey: ["scheme", schemeId, "levy-notices"],
    queryFn: () => api<{ notices: Notice[] }>(`/api/schemes/${schemeId}/levy-notices`),
    enabled: !!schemeId && isOfficer,
  });
  const payments = useQuery({
    queryKey: ["scheme", schemeId, "payments"],
    queryFn: () => api<{ payments: Payment[] }>(`/api/schemes/${schemeId}/payments`),
    enabled: !!schemeId && isOfficer,
  });
  const lots = useQuery({
    queryKey: ["scheme", schemeId, "lots"],
    queryFn: () => api<{ lots: Lot[] }>(`/api/schemes/${schemeId}/lots`),
    enabled: !!schemeId && isOfficer,
  });
  const statements = useQuery({
    queryKey: ["scheme", schemeId, "financial-statements"],
    queryFn: () =>
      api<{ statements: FinancialStatement[] }>(`/api/schemes/${schemeId}/financial-statements`),
    enabled: !!schemeId && isOfficer,
  });
  const interestAuthorisations = useQuery({
    queryKey: ["scheme", schemeId, "interest-authorisations"],
    queryFn: () =>
      api<{ authorisations: InterestAuthorisation[] }>(
        `/api/schemes/${schemeId}/interest-authorisations`,
      ),
    enabled: !!schemeId && isOfficer,
  });

  const [sheet, setSheet] = useState<SheetKind>(null);
  const [targetId, setTargetId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fyStart, setFyStart] = useState("");
  const [admin, setAdmin] = useState("");
  const [maintenance, setMaintenance] = useState("");
  const [budgetId, setBudgetId] = useState("");
  const [firstDue, setFirstDue] = useState("");
  const [noticeId, setNoticeId] = useState("");
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState("");
  const [payer, setPayer] = useState("");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [motionId, setMotionId] = useState("");
  const [description, setDescription] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [reviewerName, setReviewerName] = useState("");
  const [reportDocumentId, setReportDocumentId] = useState("");
  const [completedAt, setCompletedAt] = useState("");
  const [interestRate, setInterestRate] = useState("10");

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["scheme", schemeId] }),
      queryClient.invalidateQueries({ queryKey: ["scheme", schemeId, "budgets"] }),
      queryClient.invalidateQueries({ queryKey: ["scheme", schemeId, "levy-schedules"] }),
      queryClient.invalidateQueries({ queryKey: ["scheme", schemeId, "levy-notices"] }),
      queryClient.invalidateQueries({ queryKey: ["scheme", schemeId, "payments"] }),
      queryClient.invalidateQueries({ queryKey: ["scheme", schemeId, "financial-statements"] }),
      queryClient.invalidateQueries({ queryKey: ["scheme", schemeId, "interest-authorisations"] }),
    ]);
  };
  const close = () => {
    setSheet(null);
    setError(null);
    setReason("");
    setMotionId("");
    setDescription("");
  };

  const action = useMutation({
    mutationFn: async () => {
      switch (sheet) {
        case "budget":
          return apiPost(`/api/schemes/${schemeId}/budgets`, {
            fiscalYearStart: fyStart,
            adminCents: dollars(admin),
            maintenanceCents: dollars(maintenance),
          });
        case "adopt_budget":
          return apiPost(`/api/schemes/${schemeId}/budgets/${targetId}/adopt`, { motionId });
        case "schedule":
          return apiPost(`/api/schemes/${schemeId}/levy-schedules`, {
            budgetId,
            frequency: "quarterly",
            firstDueOn: firstDue,
          });
        case "special_fee":
          return apiPost(`/api/schemes/${schemeId}/special-fees`, {
            description,
            totalCents: dollars(amount),
            fundKind: "admin",
            dueOn: firstDue,
            motionId,
            allocationMethod: "liability",
          });
        case "statement":
          return apiPost(`/api/schemes/${schemeId}/financial-statements`, {
            periodStart,
            periodEnd,
            accountingBasis: "special_purpose_accrual",
          });
        case "review": {
          const statement = statements.data?.statements.find((row) => row.id === targetId);
          const kind = statement?.requiredReviewKind ?? "independent_review";
          return apiPost(`/api/schemes/${schemeId}/financial-statements/${targetId}/review`, {
            kind,
            reviewerName,
            professionalBody: kind === "audit" ? "ASIC" : "CA ANZ",
            independentDeclaration:
              "I declare that I have no direct or indirect personal or financial interest in this owners corporation.",
            outcome: "unmodified",
            reportDocumentId,
            completedAt: `${completedAt}T00:00:00.000Z`,
          });
        }
        case "interest":
          return apiPost(`/api/schemes/${schemeId}/interest-authorisations`, {
            motionId,
            rateBps: Math.round(Number(interestRate) * 100),
            effectiveFrom: periodStart,
          });
        case "payment":
          return apiPost(`/api/schemes/${schemeId}/payments/manual`, {
            levyNoticeId: noticeId,
            amountCents: dollars(amount),
            paidAt,
            payerName: payer.trim() || undefined,
            reference: reference.trim() || undefined,
          });
        case "match":
          return apiPost(`/api/schemes/${schemeId}/payments/${targetId}/match`, {
            levyNoticeId: noticeId,
          });
        case "writeoff":
          return apiPost(`/api/schemes/${schemeId}/levy-notices/${targetId}/write-off`, {
            reason: reason.trim(),
          });
        case "refund":
          return apiPost(`/api/schemes/${schemeId}/payments/${targetId}/refund`, {
            reason: reason.trim(),
          });
        default:
          return null;
      }
    },
    onSuccess: async () => {
      await invalidate();
      close();
    },
    onError: (caught) => setError(caught instanceof Error ? caught.message : "That action failed."),
  });

  const issue = useMutation({
    mutationFn: ({ scheduleId, instalment }: { scheduleId: string; instalment: number }) =>
      apiPost(`/api/schemes/${schemeId}/levy-schedules/${scheduleId}/issue`, { instalment }),
    onSuccess: invalidate,
  });
  const issueFinal = useMutation({
    mutationFn: (lotId: string) =>
      apiPost(`/api/schemes/${schemeId}/lots/${lotId}/final-fee-notice`, {
        serviceMethod: "email",
      }),
    onSuccess: invalidate,
  });

  const lotNumber = (lotId: string) =>
    lots.data?.lots.find((lot) => lot.id === lotId)?.lotNumber ?? "—";
  const adopted = (budgets.data?.budgets ?? []).filter((budget) => budget.status === "adopted");
  const openNotices = (notices.data?.notices ?? []).filter((notice) =>
    ["issued", "partially_paid", "overdue"].includes(notice.status),
  );
  const loading = [budgets, schedules, notices, payments, statements, interestAuthorisations].some(
    (query) => query.isPending,
  );
  const failed = [budgets, schedules, notices, payments, statements, interestAuthorisations].some(
    (query) => query.isError && !query.data,
  );

  if (!isOfficer && scheme.data) {
    return (
      <Screen title="Finance officer tools" topInset={false}>
        <EmptyState
          icon="lock-closed-outline"
          title="Officer access required"
          body="Budgets, levy runs and payment matching are committee records."
        />
      </Screen>
    );
  }

  return (
    <Screen
      title="Finance officer tools"
      topInset={false}
      eyebrow={plate(scheme.data?.scheme)}
      reserveEyebrow
      onRefresh={invalidate}
    >
      {loading ? (
        <Card>
          <Skeleton width="75%" height={20} />
        </Card>
      ) : failed ? (
        <ErrorState onRetry={invalidate} />
      ) : (
        <>
          <SectionHeader
            label="Budgets"
            right={<QuietAction label="New budget" onPress={() => setSheet("budget")} />}
          />
          {(budgets.data?.budgets ?? []).length === 0 ? (
            <EmptyState icon="wallet-outline" title="No budgets yet" />
          ) : (
            <Card padded={false} style={{ paddingHorizontal: space(4) }}>
              {(budgets.data?.budgets ?? []).map((budget, index, rows) => (
                <ListRow
                  key={budget.id}
                  title={`FY from ${formatDate(budget.fiscalYearStart)}`}
                  subtitle={budget.lines
                    .map(
                      (line) =>
                        `${humanise(line.fundKind)} ${(line.amountCents / 100).toLocaleString("en-AU", { style: "currency", currency: "AUD" })}`,
                    )
                    .join(" · ")}
                  right={
                    <View style={{ alignItems: "flex-end", gap: space(1) }}>
                      <StatusPill
                        tone={statusTone(budget.status)}
                        label={humanise(budget.status)}
                      />
                      {budget.status === "committee_review" ? (
                        <QuietAction
                          label="Record adoption"
                          onPress={() => {
                            setTargetId(budget.id);
                            setSheet("adopt_budget");
                          }}
                        />
                      ) : null}
                    </View>
                  }
                  divider={index < rows.length - 1}
                />
              ))}
            </Card>
          )}

          <SectionHeader
            label="Statutory finance"
            right={<QuietAction label="Prepare statements" onPress={() => setSheet("statement")} />}
          />
          <View style={{ gap: space(3) }}>
            <Card>
              <Text style={[t.body, { color: theme.text }]}>Annual financial statements</Text>
              {(statements.data?.statements ?? []).length === 0 ? (
                <Text style={[t.bodySmall, { color: theme.muted, marginTop: space(1) }]}>
                  None prepared
                </Text>
              ) : (
                (statements.data?.statements ?? []).map((statement) => (
                  <View key={statement.id} style={{ marginTop: space(3), gap: space(1) }}>
                    <Text style={[t.bodySmall, { color: theme.text }]}>
                      {formatDate(statement.periodStart)} – {formatDate(statement.periodEnd)}
                    </Text>
                    <StatusPill
                      tone={statusTone(statement.status)}
                      label={humanise(statement.status)}
                    />
                    {statement.requiredReviewKind && !statement.review ? (
                      <QuietAction
                        label={`Record ${humanise(statement.requiredReviewKind)}`}
                        onPress={() => {
                          setTargetId(statement.id);
                          setSheet("review");
                        }}
                      />
                    ) : null}
                  </View>
                ))
              )}
            </Card>
            <Card>
              <Text style={[t.body, { color: theme.text }]}>Resolution-authorised interest</Text>
              <Text style={[t.bodySmall, { color: theme.muted, marginTop: space(1) }]}>
                {interestAuthorisations.data?.authorisations[0]
                  ? `${interestAuthorisations.data.authorisations[0].rateBps / 100}% p.a. from ${formatDate(interestAuthorisations.data.authorisations[0].effectiveFrom)}`
                  : "No authority recorded — interest will not accrue."}
              </Text>
              <View style={{ marginTop: space(2) }}>
                <QuietAction label="Record authority" onPress={() => setSheet("interest")} />
              </View>
            </Card>
            <Card>
              <Text style={[t.body, { color: theme.text }]}>Special fees</Text>
              <Text style={[t.bodySmall, { color: theme.muted, marginTop: space(1) }]}>
                Resolution-gated and allocated by lot liability. Fees over twice the annual budget
                require a special resolution.
              </Text>
              <View style={{ marginTop: space(2) }}>
                <QuietAction label="Create special fee" onPress={() => setSheet("special_fee")} />
              </View>
            </Card>
          </View>

          <SectionHeader
            label="Levy schedules"
            right={
              adopted.length > 0 ? (
                <QuietAction label="New schedule" onPress={() => setSheet("schedule")} />
              ) : undefined
            }
          />
          {(schedules.data?.schedules ?? []).length === 0 ? (
            <EmptyState icon="calendar-outline" title="No schedules yet" />
          ) : (
            <View style={{ gap: space(3) }}>
              {(schedules.data?.schedules ?? []).map((schedule) => (
                <Card key={schedule.id}>
                  <Text style={[t.body, { color: theme.text }]}>
                    {humanise(schedule.frequency)} · {schedule.instalments} instalments
                  </Text>
                  <Text style={[t.bodySmall, { color: theme.muted, marginTop: space(1) }]}>
                    First due {formatDate(schedule.firstDueOn)}
                  </Text>
                  <View
                    style={{
                      flexDirection: "row",
                      flexWrap: "wrap",
                      gap: space(2),
                      marginTop: space(3),
                    }}
                  >
                    {Array.from({ length: schedule.instalments }, (_, index) => index + 1).map(
                      (instalment) => (
                        <Button
                          key={instalment}
                          variant="secondary"
                          label={`Issue ${instalment}`}
                          pending={
                            issue.isPending &&
                            issue.variables?.scheduleId === schedule.id &&
                            issue.variables.instalment === instalment
                          }
                          onPress={() => issue.mutate({ scheduleId: schedule.id, instalment })}
                        />
                      ),
                    )}
                  </View>
                  {issue.isError && issue.variables?.scheduleId === schedule.id ? (
                    <Text style={[t.bodySmall, { color: theme.crit, marginTop: space(2) }]}>
                      {issue.error.message}
                    </Text>
                  ) : null}
                </Card>
              ))}
            </View>
          )}

          <SectionHeader
            label="Payments"
            right={<QuietAction label="Record payment" onPress={() => setSheet("payment")} />}
          />
          <Card padded={false} style={{ paddingHorizontal: space(4) }}>
            {(payments.data?.payments ?? []).map((payment, index, rows) => (
              <ListRow
                key={payment.id}
                title={payment.payerName ?? "Payment received"}
                highlighted={focus === payment.id}
                subtitle={[formatDate(payment.paidAt), payment.noticeNumber]
                  .filter(Boolean)
                  .join(" · ")}
                right={<Figure cents={payment.amountCents} size="small" />}
                onPress={() => {
                  setTargetId(payment.id);
                  setNoticeId("");
                  setSheet(payment.status === "unmatched" ? "match" : "refund");
                }}
                accessibilityHint={
                  payment.status === "unmatched" ? "Match payment" : "Refund or open receipt"
                }
                divider={index < rows.length - 1}
              />
            ))}
          </Card>

          <SectionHeader label="Levy notices" />
          <View style={{ gap: space(3) }}>
            {(notices.data?.notices ?? []).map((notice) => (
              <Card
                key={notice.id}
                style={{ backgroundColor: focus === notice.id ? theme.accentSoft : theme.surface }}
              >
                <View
                  style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2) }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[t.figureSmall, { color: theme.text }]}>
                      {notice.noticeNumber}
                    </Text>
                    <Text style={[t.bodySmall, { color: theme.muted, marginTop: space(1) }]}>
                      Lot {lotNumber(notice.lotId)} · due {formatDate(notice.dueOn)}
                    </Text>
                  </View>
                  <Figure cents={notice.totalCents} size="small" />
                </View>
                <View style={{ marginTop: space(2) }}>
                  <StatusPill tone={statusTone(notice.status)} label={humanise(notice.status)} />
                </View>
                <View
                  style={{
                    flexDirection: "row",
                    flexWrap: "wrap",
                    gap: space(2),
                    marginTop: space(3),
                  }}
                >
                  <Button
                    variant="secondary"
                    label="Open PDF"
                    onPress={() =>
                      void downloadAndShare(
                        `/api/schemes/${schemeId}/documents/levy-notices/${notice.id}/pdf`,
                        `Levy-Notice-${notice.noticeNumber}.pdf`,
                      )
                    }
                  />
                  {["issued", "partially_paid", "overdue"].includes(notice.status) ? (
                    <Button
                      variant="secondary"
                      label="Write off"
                      onPress={() => {
                        setTargetId(notice.id);
                        setSheet("writeoff");
                      }}
                    />
                  ) : null}
                  {notice.status === "overdue" ? (
                    <Button
                      variant="secondary"
                      label="Issue final notice"
                      pending={issueFinal.isPending && issueFinal.variables === notice.lotId}
                      onPress={() => issueFinal.mutate(notice.lotId)}
                    />
                  ) : null}
                </View>
                {issueFinal.isError && issueFinal.variables === notice.lotId ? (
                  <Text style={[t.bodySmall, { color: theme.crit, marginTop: space(2) }]}>
                    {issueFinal.error.message}
                  </Text>
                ) : null}
              </Card>
            ))}
          </View>
        </>
      )}

      <Sheet visible={sheet !== null} onClose={close}>
        {sheet &&
        ["adopt_budget", "special_fee", "statement", "review", "interest"].includes(sheet) ? (
          <StatutoryActionForm
            kind={sheet}
            motionId={motionId}
            setMotionId={setMotionId}
            description={description}
            setDescription={setDescription}
            amount={amount}
            setAmount={setAmount}
            dueOn={firstDue}
            setDueOn={setFirstDue}
            periodStart={periodStart}
            setPeriodStart={setPeriodStart}
            periodEnd={periodEnd}
            setPeriodEnd={setPeriodEnd}
            reviewerName={reviewerName}
            setReviewerName={setReviewerName}
            reportDocumentId={reportDocumentId}
            setReportDocumentId={setReportDocumentId}
            completedAt={completedAt}
            setCompletedAt={setCompletedAt}
            interestRate={interestRate}
            setInterestRate={setInterestRate}
            pending={action.isPending}
            error={error}
            onSubmit={() => action.mutate()}
          />
        ) : (
          <ActionForm
            kind={sheet}
            budgets={adopted}
            notices={openNotices}
            budgetId={budgetId}
            setBudgetId={setBudgetId}
            noticeId={noticeId}
            setNoticeId={setNoticeId}
            fyStart={fyStart}
            setFyStart={setFyStart}
            admin={admin}
            setAdmin={setAdmin}
            maintenance={maintenance}
            setMaintenance={setMaintenance}
            firstDue={firstDue}
            setFirstDue={setFirstDue}
            amount={amount}
            setAmount={setAmount}
            paidAt={paidAt}
            setPaidAt={setPaidAt}
            payer={payer}
            setPayer={setPayer}
            reference={reference}
            setReference={setReference}
            reason={reason}
            setReason={setReason}
            pending={action.isPending}
            error={error}
            onSubmit={() => action.mutate()}
            onReceipt={() => {
              const payment = payments.data?.payments.find((row) => row.id === targetId);
              if (payment?.receiptNumber) {
                void downloadAndShare(
                  `/api/schemes/${schemeId}/documents/payments/${payment.id}/receipt.pdf`,
                  `Receipt-${payment.receiptNumber}.pdf`,
                );
              }
            }}
          />
        )}
      </Sheet>
    </Screen>
  );
}

interface StatutoryActionProps {
  kind: Exclude<SheetKind, null>;
  motionId: string;
  setMotionId: (value: string) => void;
  description: string;
  setDescription: (value: string) => void;
  amount: string;
  setAmount: (value: string) => void;
  dueOn: string;
  setDueOn: (value: string) => void;
  periodStart: string;
  setPeriodStart: (value: string) => void;
  periodEnd: string;
  setPeriodEnd: (value: string) => void;
  reviewerName: string;
  setReviewerName: (value: string) => void;
  reportDocumentId: string;
  setReportDocumentId: (value: string) => void;
  completedAt: string;
  setCompletedAt: (value: string) => void;
  interestRate: string;
  setInterestRate: (value: string) => void;
  pending: boolean;
  error: string | null;
  onSubmit: () => void;
}

function StatutoryActionForm(props: StatutoryActionProps) {
  const theme = useTheme();
  const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
  const motionField = (
    <FormField
      label="Carried resolution motion ID"
      value={props.motionId}
      onChangeText={props.setMotionId}
    />
  );
  let title = "Statutory finance action";
  let fields: ReactNode = null;
  let disabled = false;

  if (props.kind === "adopt_budget") {
    title = "Record budget adoption";
    fields = motionField;
    disabled = !props.motionId;
  } else if (props.kind === "special_fee") {
    title = "Create special fee";
    fields = (
      <>
        {motionField}
        <FormField label="Purpose" value={props.description} onChangeText={props.setDescription} />
        <FormField
          label="Total ($)"
          value={props.amount}
          onChangeText={props.setAmount}
          keyboardType="decimal-pad"
        />
        <FormField
          label="Due date (YYYY-MM-DD)"
          value={props.dueOn}
          onChangeText={props.setDueOn}
        />
      </>
    );
    disabled =
      !props.motionId ||
      props.description.trim().length < 3 ||
      dollars(props.amount) <= 0 ||
      !isDate(props.dueOn);
  } else if (props.kind === "statement") {
    title = "Prepare annual statements";
    fields = (
      <>
        <FormField
          label="Period start (YYYY-MM-DD)"
          value={props.periodStart}
          onChangeText={props.setPeriodStart}
        />
        <FormField
          label="Period end (YYYY-MM-DD)"
          value={props.periodEnd}
          onChangeText={props.setPeriodEnd}
        />
      </>
    );
    disabled = !isDate(props.periodStart) || !isDate(props.periodEnd);
  } else if (props.kind === "review") {
    title = "Record independent report";
    fields = (
      <>
        <FormField
          label="Reviewer name"
          value={props.reviewerName}
          onChangeText={props.setReviewerName}
        />
        <FormField
          label="Report document ID"
          value={props.reportDocumentId}
          onChangeText={props.setReportDocumentId}
        />
        <FormField
          label="Completed date (YYYY-MM-DD)"
          value={props.completedAt}
          onChangeText={props.setCompletedAt}
        />
      </>
    );
    disabled =
      props.reviewerName.trim().length < 2 || !props.reportDocumentId || !isDate(props.completedAt);
  } else if (props.kind === "interest") {
    title = "Record interest authority";
    fields = (
      <>
        {motionField}
        <FormField
          label="Rate (% p.a., maximum 10)"
          value={props.interestRate}
          onChangeText={props.setInterestRate}
          keyboardType="decimal-pad"
        />
        <FormField
          label="Effective from (YYYY-MM-DD)"
          value={props.periodStart}
          onChangeText={props.setPeriodStart}
        />
      </>
    );
    disabled =
      !props.motionId ||
      Number(props.interestRate) < 0 ||
      Number(props.interestRate) > 10 ||
      !isDate(props.periodStart);
  }

  return (
    <View style={{ gap: space(3) }}>
      <Text style={[t.title, { color: theme.text }]}>{title}</Text>
      {fields}
      <Button
        full
        label="Save statutory record"
        pending={props.pending}
        disabled={disabled}
        onPress={props.onSubmit}
      />
      {props.error ? <Text style={[t.bodySmall, { color: theme.crit }]}>{props.error}</Text> : null}
    </View>
  );
}

function QuietAction({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      style={{ minHeight: 44, justifyContent: "center" }}
    >
      <Text style={[t.label, { color: theme.accent }]}>{label}</Text>
    </PressableScale>
  );
}

function ChoiceList<T extends { id: string }>({
  items,
  selected,
  label,
  onSelect,
}: {
  items: T[];
  selected: string;
  label: (item: T) => string;
  onSelect: (id: string) => void;
}) {
  const theme = useTheme();
  return (
    <View style={{ gap: space(2) }}>
      {items.map((item) => (
        <PressableScale
          key={item.id}
          onPress={() => onSelect(item.id)}
          accessibilityRole="radio"
          accessibilityState={{ selected: selected === item.id }}
          style={{
            minHeight: 44,
            justifyContent: "center",
            borderWidth: 1,
            borderColor: selected === item.id ? theme.accent : theme.line,
            backgroundColor: selected === item.id ? theme.accentSoft : theme.surface,
            borderRadius: space(2),
            paddingHorizontal: space(3),
          }}
        >
          <Text style={[t.bodySmall, { color: theme.text }]}>{label(item)}</Text>
        </PressableScale>
      ))}
    </View>
  );
}

interface ActionFormProps {
  kind: SheetKind;
  budgets: Budget[];
  notices: Notice[];
  budgetId: string;
  setBudgetId: (value: string) => void;
  noticeId: string;
  setNoticeId: (value: string) => void;
  fyStart: string;
  setFyStart: (value: string) => void;
  admin: string;
  setAdmin: (value: string) => void;
  maintenance: string;
  setMaintenance: (value: string) => void;
  firstDue: string;
  setFirstDue: (value: string) => void;
  amount: string;
  setAmount: (value: string) => void;
  paidAt: string;
  setPaidAt: (value: string) => void;
  payer: string;
  setPayer: (value: string) => void;
  reference: string;
  setReference: (value: string) => void;
  reason: string;
  setReason: (value: string) => void;
  pending: boolean;
  error: string | null;
  onSubmit: () => void;
  onReceipt: () => void;
}

function ActionForm(props: ActionFormProps) {
  const theme = useTheme();
  const submit = (label: string, disabled = false) => (
    <Button
      full
      label={label}
      onPress={props.onSubmit}
      pending={props.pending}
      disabled={disabled}
    />
  );
  return (
    <View style={{ gap: space(3) }}>
      {props.kind === "budget" ? (
        <>
          <Text style={[t.title, { color: theme.text }]}>Draft a budget</Text>
          <FormField
            label="Fiscal year start (YYYY-MM-DD)"
            value={props.fyStart}
            onChangeText={props.setFyStart}
          />
          <FormField
            label="Admin fund ($/year)"
            value={props.admin}
            onChangeText={props.setAdmin}
            keyboardType="decimal-pad"
          />
          <FormField
            label="Maintenance fund ($/year)"
            value={props.maintenance}
            onChangeText={props.setMaintenance}
            keyboardType="decimal-pad"
          />
          {submit(
            "Draft budget",
            !/^\d{4}-\d{2}-\d{2}$/.test(props.fyStart) || dollars(props.admin) <= 0,
          )}
        </>
      ) : props.kind === "schedule" ? (
        <>
          <Text style={[t.title, { color: theme.text }]}>Create quarterly schedule</Text>
          <ChoiceList
            items={props.budgets}
            selected={props.budgetId}
            onSelect={props.setBudgetId}
            label={(budget) => `FY from ${formatDate(budget.fiscalYearStart)}`}
          />
          <FormField
            label="First due (YYYY-MM-DD)"
            value={props.firstDue}
            onChangeText={props.setFirstDue}
          />
          {submit(
            "Create schedule",
            !props.budgetId || !/^\d{4}-\d{2}-\d{2}$/.test(props.firstDue),
          )}
        </>
      ) : props.kind === "payment" ? (
        <>
          <Text style={[t.title, { color: theme.text }]}>Record a bank transfer</Text>
          <ChoiceList
            items={props.notices}
            selected={props.noticeId}
            onSelect={props.setNoticeId}
            label={(notice) =>
              `${notice.noticeNumber} · ${(notice.totalCents / 100).toLocaleString("en-AU", { style: "currency", currency: "AUD" })}`
            }
          />
          <FormField
            label="Amount ($)"
            value={props.amount}
            onChangeText={props.setAmount}
            keyboardType="decimal-pad"
          />
          <FormField
            label="Date received (YYYY-MM-DD)"
            value={props.paidAt}
            onChangeText={props.setPaidAt}
          />
          <FormField label="Payer (optional)" value={props.payer} onChangeText={props.setPayer} />
          <FormField
            label="Bank reference (optional)"
            value={props.reference}
            onChangeText={props.setReference}
          />
          {submit(
            "Record payment",
            !props.noticeId ||
              dollars(props.amount) <= 0 ||
              !/^\d{4}-\d{2}-\d{2}$/.test(props.paidAt),
          )}
        </>
      ) : props.kind === "match" ? (
        <>
          <Text style={[t.title, { color: theme.text }]}>Match payment</Text>
          <ChoiceList
            items={props.notices}
            selected={props.noticeId}
            onSelect={props.setNoticeId}
            label={(notice) => notice.noticeNumber}
          />
          {submit("Match payment", !props.noticeId)}
        </>
      ) : props.kind === "writeoff" ? (
        <>
          <Text style={[t.title, { color: theme.text }]}>Write off notice</Text>
          <FormField label="Reason" value={props.reason} onChangeText={props.setReason} multiline />
          {submit("Write off notice", props.reason.trim().length === 0)}
        </>
      ) : props.kind === "refund" ? (
        <>
          <Text style={[t.title, { color: theme.text }]}>Payment actions</Text>
          <Button variant="secondary" full label="Open receipt PDF" onPress={props.onReceipt} />
          <FormField
            label="Refund reason"
            value={props.reason}
            onChangeText={props.setReason}
            multiline
          />
          {submit("Refund payment", props.reason.trim().length === 0)}
        </>
      ) : null}
      {props.error ? <Text style={[t.bodySmall, { color: theme.crit }]}>{props.error}</Text> : null}
    </View>
  );
}
