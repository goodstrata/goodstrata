import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import {
  Card,
  EmptyState,
  ErrorState,
  Figure,
  ListRow,
  PressableScale,
  Screen,
  SectionHeader,
  Skeleton,
  StatusPill,
  formatDate,
  formatMoney,
  space,
  type as t,
  useListEntering,
  useTheme,
} from "../../../src/components";
import { api } from "../../../src/lib/api";

interface SchemeOverview {
  scheme: { id: string; name: string; planOfSubdivision: string | null; tier: number | string | null; status: string };
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
 * is selectable so owners can long-press to copy — a one-tap copy
 * affordance arrives once expo-clipboard is added to package.json (owned
 * elsewhere; see kit caveats).
 */
function PayRow({ label, value, divider }: { label: string; value: string; divider?: boolean }) {
  const theme = useTheme();
  return (
    <View>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          minHeight: 44,
          paddingVertical: space(2),
        }}
      >
        <Text style={[t.label, { color: theme.muted }]}>{label}</Text>
        <Text
          selectable
          style={[t.figureSmall, { color: theme.text, marginLeft: space(3), flexShrink: 1 }]}
        >
          {value}
        </Text>
      </View>
      {divider ? (
        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.line }} />
      ) : null}
    </View>
  );
}

export default function SchemeFinance() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ id: string }>();
  const schemeId = typeof params.id === "string" ? params.id : "";
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
    enabled: !!schemeId,
  });
  const arrearsQuery = useQuery({
    queryKey: ["scheme", schemeId, "arrears"],
    queryFn: () => api<{ arrears: ArrearsEntry[] }>(`/api/schemes/${schemeId}/arrears`),
    enabled: !!schemeId,
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
    arrearsQuery.isRefetching;

  if (overviewQuery.isError && !overview) {
    return (
      <Screen title="Finance" refreshing={refreshing} onRefresh={refetchAll}>
        <ErrorState onRetry={refetchAll} />
      </Screen>
    );
  }

  if (overviewQuery.isPending && !finance) {
    return (
      <Screen title="Finance">
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

  const outstanding = finance?.arrearsOutstandingCents ?? 0;
  const lotsInArrears = finance?.lotsInArrears ?? 0;
  const noticeCount = finance?.noticeCount ?? 0;
  const overdueSince =
    arrears.length > 0
      ? arrears.reduce(
          (min, a) => (a.earliestDueOn < min ? a.earliestDueOn : min),
          arrears[0].earliestDueOn,
        )
      : null;
  const recent = showAllPayments ? payments : payments.slice(0, 5);

  return (
    <Screen
      title="Finance"
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
        {finance?.hasBudget ? (
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
            {`${noticeCount} levy notice${noticeCount === 1 ? "" : "s"} · levied ${money(finance?.leviedCents ?? 0)}`}
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
        {outstanding > 0 && overdueSince ? (
          <Text
            style={{ ...t.bodySmall, color: theme.muted, marginTop: space(2) }}
          >
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
          <Text
            style={{ ...t.bodySmall, color: theme.muted, marginTop: space(2) }}
          >
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
      {paymentsQuery.isPending ? (
        <Card>
          {[0, 1, 2].map((i) => (
            <View key={i} style={{ paddingVertical: space(3) }}>
              <Skeleton width={i % 2 ? "55%" : "70%"} height={16} />
            </View>
          ))}
        </Card>
      ) : recent.length > 0 ? (
        <Card>
          {recent.map((payment, i) => (
            <Animated.View key={payment.id} entering={entering(i)}>
              <ListRow
                title={payment.payerName ?? "Payment received"}
                subtitle={
                  payment.receiptNumber
                    ? `${formatDate(payment.paidAt)} · Receipt ${payment.receiptNumber}`
                    : formatDate(payment.paidAt)
                }
                right={<Figure cents={payment.amountCents} size="small" signed tone="ok" />}
                divider={i < recent.length - 1}
              />
            </Animated.View>
          ))}
        </Card>
      ) : (
        <EmptyState icon="cash-outline" title="No payments recorded yet" />
      )}

      {arrears.length > 0 ? (
        <>
          <SectionHeader label="Arrears" />
          <Card>
            {arrears.map((entry, i) => (
              <ListRow
                key={entry.lotId}
                title={`Lot ${entry.lotNumber}`}
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
