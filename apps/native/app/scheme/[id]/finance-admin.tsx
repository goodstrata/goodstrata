import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
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

type SheetKind = "budget" | "schedule" | "payment" | "match" | "writeoff" | "refund" | null;

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

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["scheme", schemeId] }),
      queryClient.invalidateQueries({ queryKey: ["scheme", schemeId, "budgets"] }),
      queryClient.invalidateQueries({ queryKey: ["scheme", schemeId, "levy-schedules"] }),
      queryClient.invalidateQueries({ queryKey: ["scheme", schemeId, "levy-notices"] }),
      queryClient.invalidateQueries({ queryKey: ["scheme", schemeId, "payments"] }),
    ]);
  };
  const close = () => {
    setSheet(null);
    setError(null);
    setReason("");
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
        case "schedule":
          return apiPost(`/api/schemes/${schemeId}/levy-schedules`, {
            budgetId,
            frequency: "quarterly",
            firstDueOn: firstDue,
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

  const lotNumber = (lotId: string) =>
    lots.data?.lots.find((lot) => lot.id === lotId)?.lotNumber ?? "—";
  const adopted = (budgets.data?.budgets ?? []).filter((budget) => budget.status === "adopted");
  const openNotices = (notices.data?.notices ?? []).filter((notice) =>
    ["issued", "partially_paid", "overdue"].includes(notice.status),
  );
  const loading = [budgets, schedules, notices, payments].some((query) => query.isPending);
  const failed = [budgets, schedules, notices, payments].some(
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
                    <StatusPill tone={statusTone(budget.status)} label={humanise(budget.status)} />
                  }
                  divider={index < rows.length - 1}
                />
              ))}
            </Card>
          )}

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
                </View>
              </Card>
            ))}
          </View>
        </>
      )}

      <Sheet visible={sheet !== null} onClose={close}>
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
      </Sheet>
    </Screen>
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
