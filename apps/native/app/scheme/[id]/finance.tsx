import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Figure,
  formatDate,
  formatMoney,
  ListRow,
  PressableScale,
  Screen,
  SectionHeader,
  Skeleton,
  StatusPill,
  space,
  type as t,
  useListEntering,
  useTheme,
} from "../../../src/components";
import { api } from "../../../src/lib/api";
import { downloadAndShare } from "../../../src/lib/files";
import { useIsOfficer } from "../../../src/lib/roles";

interface SchemeOverview {
  scheme: {
    id: string;
    name: string;
    planOfSubdivision: string | null;
    tier: number | string | null;
    status: string;
  };
  finance: {
    hasBudget: boolean;
    fiscalYearStart: string | null;
    adminCents: number;
    maintenanceCents: number;
    leviedCents: number;
    noticeCount: number;
    arrearsCents: number;
    arrearsOutstandingCents: number;
    lotsInArrears: number;
  };
}

interface PaymentsStatus {
  status: {
    provider: string | null;
    trustAccount: {
      status: string;
      bsb: string;
      accountNumber: string;
      payidRoot: string | null;
      provider: string;
    } | null;
    unmatchedCount: number;
    lastPaymentAt: string | null;
  };
}

interface Payment {
  id: string;
  provider: string | null;
  amountCents: number;
  paidAt: string;
  payerName: string | null;
  status: string;
  receiptNumber: string | null;
  noticeNumber: string | null;
}

interface ArrearsEntry {
  lotId: string;
  lotNumber: string | number;
  outstandingCents: number;
  daysOverdue: number;
  /** Arrears-ladder stage number, 0 = none (SPEC §2.3). */
  stage: number;
  interestAccruedCents: number;
  earliestDueOn: string;
}

interface OwnerLot {
  id: string;
  lotNumber: string;
  unitNumber: string | null;
}

interface OwnerStatement {
  balanceCents: number;
}

/** Ladder stage → pill vocabulary, mirroring packages/core arrears-ladder kinds. */
const ARREARS_STAGE_LABEL: Record<number, string> = {
  1: "Friendly reminder",
  2: "Formal reminder",
  3: "Final notice",
  4: "Recovery decision",
};

/** "$1,234.56" as one string — for muted breakdown lines, not Figures. */
function money(cents: number): string {
  const m = formatMoney(cents);
  return `${m.dollars}${m.cents}`;
}

/**
 * One row of the how-to-pay card: label left, mono value right. The value
 * is selectable and the whole row is a one-tap copy target.
 */
function PayRow({ label, value, divider }: { label: string; value: string; divider?: boolean }) {
  const theme = useTheme();
  const [copied, setCopied] = useState(false);
  return (
    <View>
      <PressableScale
        onPress={async () => {
          await Clipboard.setStringAsync(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
        accessibilityRole="button"
        accessibilityLabel={`Copy ${label}, ${value}`}
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          minHeight: 44,
          paddingVertical: space(2),
        }}
      >
        <Text style={[t.label, { color: theme.muted }]}>{label}</Text>
        <View style={{ alignItems: "flex-end", marginLeft: space(3), flexShrink: 1 }}>
          <Text selectable style={[t.figureSmall, { color: theme.text }]}>
            {value}
          </Text>
          <Text style={[t.caption, { color: copied ? theme.ok : theme.muted }]}>
            {copied ? "Copied" : "Tap to copy"}
          </Text>
        </View>
      </PressableScale>
      {divider ? (
        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.line }} />
      ) : null}
    </View>
  );
}

export default function SchemeFinance() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string; focus?: string; focusType?: string }>();
  const schemeId = typeof params.id === "string" ? params.id : "";
  const focus = typeof params.focus === "string" ? params.focus : "";
  const focusType = typeof params.focusType === "string" ? params.focusType : "";
  const isOfficer = useIsOfficer(schemeId);
  const queryClient = useQueryClient();
  const [showAllPayments, setShowAllPayments] = useState(false);

  const overviewQuery = useQuery({
    queryKey: ["scheme", schemeId, "overview"],
    queryFn: () => api<SchemeOverview>(`/api/schemes/${schemeId}/overview`),
    enabled: !!schemeId,
  });
  const payStatusQuery = useQuery({
    queryKey: ["scheme", schemeId, "payments", "status"],
    queryFn: () => api<PaymentsStatus>(`/api/schemes/${schemeId}/payments/status`),
    enabled: !!schemeId,
  });
  const paymentsQuery = useQuery({
    queryKey: ["scheme", schemeId, "payments"],
    queryFn: () => api<{ payments: Payment[] }>(`/api/schemes/${schemeId}/payments`),
    enabled: !!schemeId && isOfficer,
  });
  const focusedPaymentQuery = useQuery({
    queryKey: ["scheme", schemeId, "payments", "focused", focus],
    queryFn: () => api<{ payment: Payment }>(`/api/schemes/${schemeId}/payments/${focus}`),
    enabled: !!schemeId && !!focus && focusType === "payment",
    retry: false,
  });
  const arrearsQuery = useQuery({
    queryKey: ["scheme", schemeId, "arrears"],
    queryFn: () => api<{ arrears: ArrearsEntry[] }>(`/api/schemes/${schemeId}/arrears`),
    enabled: !!schemeId && isOfficer,
  });
  const myLotsQuery = useQuery({
    queryKey: ["scheme", schemeId, "lots", "mine"],
    queryFn: () => api<{ lots: OwnerLot[] }>(`/api/schemes/${schemeId}/lots/mine`),
    enabled: !!schemeId && !isOfficer,
  });
  const myLots = myLotsQuery.data?.lots ?? [];
  const myStatementQueries = useQueries({
    queries: myLots.map((lot) => ({
      queryKey: ["scheme", schemeId, "lot-statement", lot.id] as const,
      queryFn: () => api<OwnerStatement>(`/api/schemes/${schemeId}/lots/${lot.id}/statement`),
      enabled: !isOfficer,
    })),
  });

  const overview = overviewQuery.data;
  const finance = overview?.finance;
  const trust = payStatusQuery.data?.status.trustAccount ?? null;
  const payments = paymentsQuery.data?.payments ?? [];
  const arrears = arrearsQuery.data?.arrears ?? [];

  const entering = useListEntering(paymentsQuery.isSuccess);

  const refetchAll = () => queryClient.invalidateQueries({ queryKey: ["scheme", schemeId] });
  const refreshing =
    overviewQuery.isRefetching ||
    payStatusQuery.isRefetching ||
    paymentsQuery.isRefetching ||
    focusedPaymentQuery.isRefetching ||
    arrearsQuery.isRefetching ||
    myLotsQuery.isRefetching ||
    myStatementQueries.some((query) => query.isRefetching);

  if (overviewQuery.isError && !overview) {
    return (
      <Screen title="Finance" topInset={false} refreshing={refreshing} onRefresh={refetchAll}>
        <ErrorState onRetry={refetchAll} />
      </Screen>
    );
  }

  if (overviewQuery.isPending && !finance) {
    return (
      <Screen title="Finance" topInset={false}>
        <Card>
          <Skeleton width="40%" height={12} />
          <View style={{ marginTop: space(2) }}>
            <Skeleton width="60%" height={40} radius={8} />
          </View>
          <View style={{ marginTop: space(3) }}>
            <Skeleton width="50%" height={14} />
          </View>
        </Card>
        <SectionHeader label="Recent payments" />
        <Card>
          {[0, 1, 2].map((i) => (
            <View key={i} style={{ paddingVertical: space(3) }}>
              <Skeleton width={i % 2 ? "55%" : "70%"} height={16} />
            </View>
          ))}
        </Card>
      </Screen>
    );
  }

  const ownerOutstanding = myStatementQueries.reduce(
    (sum, query) => sum + Math.max(0, query.data?.balanceCents ?? 0),
    0,
  );
  const outstanding = isOfficer ? (finance?.arrearsOutstandingCents ?? 0) : ownerOutstanding;
  const lotsInArrears = isOfficer
    ? (finance?.lotsInArrears ?? 0)
    : myStatementQueries.filter((query) => (query.data?.balanceCents ?? 0) > 0).length;
  const noticeCount = finance?.noticeCount ?? 0;
  const overdueSince =
    arrears.length > 0
      ? arrears.reduce(
          (min, a) => (a.earliestDueOn < min ? a.earliestDueOn : min),
          arrears[0].earliestDueOn,
        )
      : null;
  const focusedPayment =
    payments.find((payment) => payment.id === focus) ?? focusedPaymentQuery.data?.payment;
  const recentBase = showAllPayments ? payments : payments.slice(0, 5);
  const recent =
    isOfficer && focusedPayment && !recentBase.some((payment) => payment.id === focusedPayment.id)
      ? [focusedPayment, ...recentBase]
      : recentBase;

  return (
    <Screen
      title="Finance"
      topInset={false}
      eyebrow={overview?.scheme.name}
      reserveEyebrow
      refreshing={refreshing}
      onRefresh={refetchAll}
    >
      <Card>
        <Text style={[t.label, { color: theme.muted }]}>Levies outstanding</Text>
        <View style={{ marginTop: space(1) }}>
          <Figure cents={outstanding} size="hero" tone={outstanding > 0 ? "crit" : "default"} />
        </View>
        {isOfficer && finance?.hasBudget ? (
          <Text style={[t.figureSmall, { color: theme.muted, marginTop: space(1) }]}>
            Admin {money(finance.adminCents)} · Maintenance {money(finance.maintenanceCents)}
          </Text>
        ) : null}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: space(3),
          }}
        >
          <Text style={{ ...t.bodySmall, color: theme.muted }}>
            {isOfficer
              ? `${noticeCount} levy notice${noticeCount === 1 ? "" : "s"} · levied ${money(finance?.leviedCents ?? 0)}`
              : `${myLots.length} linked lot${myLots.length === 1 ? "" : "s"}`}
          </Text>
          {lotsInArrears > 0 ? (
            <StatusPill
              tone="crit"
              label={`${lotsInArrears} lot${lotsInArrears === 1 ? "" : "s"} overdue`}
            />
          ) : (
            <StatusPill tone="ok" label="Paid up" />
          )}
        </View>
        {isOfficer && outstanding > 0 && overdueSince ? (
          <Text style={{ ...t.bodySmall, color: theme.muted, marginTop: space(2) }}>
            Overdue since {formatDate(overdueSince)}.
          </Text>
        ) : null}
      </Card>

      <SectionHeader label="How to pay" />
      {trust ? (
        <Card>
          <PayRow label="BSB" value={trust.bsb} divider />
          <PayRow label="Account number" value={trust.accountNumber} divider={!!trust.payidRoot} />
          {trust.payidRoot ? <PayRow label="PayID" value={trust.payidRoot} /> : null}
          <Text style={{ ...t.bodySmall, color: theme.muted, marginTop: space(2) }}>
            Use the reference on your levy notice so the payment matches your lot.
          </Text>
        </Card>
      ) : (
        <Card>
          <Text style={{ ...t.bodySmall, color: theme.muted }}>
            Payment details will appear here once the scheme's trust account is set up.
          </Text>
        </Card>
      )}

      {isOfficer ? (
        <>
          <SectionHeader label="Officer tools" />
          <Button
            variant="secondary"
            full
            label="Manage budgets, levies and payments"
            onPress={() => router.push(`/scheme/${schemeId}/finance-admin`)}
          />
        </>
      ) : null}

      {!isOfficer && focus && focusType === "levy_notice" ? (
        <>
          <SectionHeader label="Levy notice" />
          <Card style={{ backgroundColor: theme.accentSoft }}>
            <Text style={[t.title, { color: theme.text }]}>Your levy notice is ready</Text>
            <Text style={[t.bodySmall, { color: theme.muted, marginTop: space(1) }]}>
              Open the issued notice for its amount, due date, payment reference and formal record.
            </Text>
            <View style={{ marginTop: space(3) }}>
              <Button
                variant="secondary"
                label="Open levy notice PDF"
                onPress={() =>
                  void downloadAndShare(
                    `/api/schemes/${schemeId}/documents/levy-notices/${focus}/pdf`,
                    "Levy-Notice.pdf",
                  )
                }
              />
            </View>
          </Card>
        </>
      ) : null}

      {!isOfficer && focus && focusType === "payment" ? (
        <>
          <SectionHeader label="Payment receipt" />
          {focusedPaymentQuery.isPending ? (
            <Card>
              <Skeleton width="55%" height={18} />
              <View style={{ marginTop: space(3) }}>
                <Skeleton width="40%" height={32} />
              </View>
            </Card>
          ) : focusedPaymentQuery.isError || !focusedPayment ? (
            <ErrorState
              detail="This payment is unavailable or is not linked to one of your current lots."
              onRetry={() => focusedPaymentQuery.refetch()}
            />
          ) : (
            <Card style={{ backgroundColor: theme.accentSoft }}>
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space(3) }}>
                <View style={{ flex: 1, gap: space(1) }}>
                  <Text style={[t.title, { color: theme.text }]}>Payment received</Text>
                  <Text style={[t.bodySmall, { color: theme.muted }]}>
                    {[formatDate(focusedPayment.paidAt), focusedPayment.noticeNumber]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                </View>
                <Figure cents={focusedPayment.amountCents} size="small" signed tone="ok" />
              </View>
              {focusedPayment.receiptNumber ? (
                <View style={{ marginTop: space(3) }}>
                  <Button
                    variant="secondary"
                    label={`Open receipt ${focusedPayment.receiptNumber}`}
                    onPress={() =>
                      void downloadAndShare(
                        `/api/schemes/${schemeId}/documents/payments/${focusedPayment.id}/receipt.pdf`,
                        `Receipt-${focusedPayment.receiptNumber}.pdf`,
                      )
                    }
                  />
                </View>
              ) : (
                <Text style={[t.bodySmall, { color: theme.muted, marginTop: space(2) }]}>
                  The receipt is still being prepared.
                </Text>
              )}
            </Card>
          )}
        </>
      ) : null}

      {!isOfficer ? (
        <>
          <SectionHeader label="My lot statements" />
          {myLotsQuery.isPending || myStatementQueries.some((query) => query.isPending) ? (
            <Card>
              <Skeleton width="70%" height={18} />
              <View style={{ marginTop: space(3) }}>
                <Skeleton width="50%" height={14} />
              </View>
            </Card>
          ) : myLotsQuery.isError ? (
            <ErrorState onRetry={() => myLotsQuery.refetch()} />
          ) : myLots.length === 0 ? (
            <EmptyState
              icon="receipt-outline"
              title="No lot linked yet"
              body="Ask an office holder to link your account to the lot register."
            />
          ) : (
            <Card>
              {myLots.map((lot, index) => {
                const balance = myStatementQueries[index]?.data?.balanceCents ?? 0;
                return (
                  <ListRow
                    key={lot.id}
                    title={`Lot ${lot.lotNumber}`}
                    subtitle={
                      lot.unitNumber ? `Unit ${lot.unitNumber} · Open statement` : "Open statement"
                    }
                    right={
                      <Figure
                        cents={Math.abs(balance)}
                        size="small"
                        tone={balance > 0 ? "crit" : "ok"}
                      />
                    }
                    onPress={() =>
                      router.push({
                        pathname: `/scheme/${schemeId}/finance-statement`,
                        params: { lotId: lot.id, lotNumber: lot.lotNumber },
                      })
                    }
                    divider={index < myLots.length - 1}
                  />
                );
              })}
            </Card>
          )}
        </>
      ) : null}

      {isOfficer ? (
        <SectionHeader
          label="Recent payments"
          right={
            payments.length > 5 ? (
              <PressableScale
                onPress={() => setShowAllPayments((s) => !s)}
                accessibilityRole="button"
                accessibilityLabel={
                  showAllPayments ? "Show recent payments" : `View all ${payments.length} payments`
                }
                hitSlop={12}
              >
                <Text style={[t.label, { color: theme.accent }]}>
                  {showAllPayments ? "Show recent" : `View all ${payments.length}`}
                </Text>
              </PressableScale>
            ) : undefined
          }
        />
      ) : null}
      {isOfficer && paymentsQuery.isPending ? (
        <Card>
          {[0, 1, 2].map((i) => (
            <View key={i} style={{ paddingVertical: space(3) }}>
              <Skeleton width={i % 2 ? "55%" : "70%"} height={16} />
            </View>
          ))}
        </Card>
      ) : isOfficer && recent.length > 0 ? (
        <Card>
          {recent.map((payment, i) => (
            <Animated.View key={payment.id} entering={entering(i)}>
              <ListRow
                title={payment.payerName ?? "Payment received"}
                highlighted={focus === payment.id}
                subtitle={
                  payment.receiptNumber
                    ? `${formatDate(payment.paidAt)} · Receipt ${payment.receiptNumber}`
                    : formatDate(payment.paidAt)
                }
                right={<Figure cents={payment.amountCents} size="small" signed tone="ok" />}
                onPress={
                  payment.receiptNumber
                    ? () =>
                        void downloadAndShare(
                          `/api/schemes/${schemeId}/documents/payments/${payment.id}/receipt.pdf`,
                          `Receipt-${payment.receiptNumber}.pdf`,
                        )
                    : undefined
                }
                accessibilityHint={
                  payment.receiptNumber ? "Opens the payment receipt PDF" : undefined
                }
                divider={i < recent.length - 1}
              />
            </Animated.View>
          ))}
        </Card>
      ) : isOfficer ? (
        <EmptyState icon="cash-outline" title="No payments recorded yet" />
      ) : null}

      {isOfficer && arrears.length > 0 ? (
        <>
          <SectionHeader label="Arrears" />
          <Card>
            {arrears.map((entry, i) => (
              <ListRow
                key={entry.lotId}
                title={`Lot ${entry.lotNumber}`}
                highlighted={focus === entry.lotId}
                onPress={() =>
                  router.push({
                    pathname: `/scheme/${schemeId}/finance-statement`,
                    params: { lotId: entry.lotId, lotNumber: String(entry.lotNumber) },
                  })
                }
                subtitle={
                  entry.interestAccruedCents > 0
                    ? `Due ${formatDate(entry.earliestDueOn)} · interest ${money(entry.interestAccruedCents)}`
                    : `Due ${formatDate(entry.earliestDueOn)}`
                }
                right={
                  <View style={{ alignItems: "flex-end", gap: space(1) }}>
                    <Figure cents={entry.outstandingCents} size="small" tone="crit" />
                    <StatusPill
                      tone={entry.daysOverdue >= 60 ? "crit" : "warn"}
                      label={
                        ARREARS_STAGE_LABEL[entry.stage] ?? `${entry.daysOverdue} days overdue`
                      }
                    />
                  </View>
                }
                divider={i < arrears.length - 1}
              />
            ))}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}
