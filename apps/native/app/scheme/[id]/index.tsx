import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { Text, View } from "react-native";
import {
  Card,
  ErrorState,
  Figure,
  ListRow,
  Screen,
  SectionHeader,
  Skeleton,
  StatusPill,
  formatDate,
  formatMoney,
  plate,
  space,
  type as t,
  useTheme,
} from "../../../src/components";
import { api } from "../../../src/lib/api";

interface SchemeRow {
  id: string;
  name: string;
  planOfSubdivision: string | null;
  tier: number | string | null;
  status: string;
}

interface SchemeDetail {
  scheme: SchemeRow;
  roles: string[];
}

interface SchemeOverview {
  scheme: { id: string; name: string; planOfSubdivision: string | null; tier: number | string | null; status: string };
  glance: { lots: number; people: number; members: number };
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
  attention: {
    pendingDecisions: number;
    overdueDecisions: number;
    openMaintenanceRequests: number;
    openWorkOrders: number;
    complianceOpen: number;
    complianceOverdue: number;
  };
  nextMeeting: { id: string; kind: string; title: string; scheduledAt: string; status: string } | null;
}

/** "$1,234.56" as one string — for muted breakdown lines, not Figures. */
function money(cents: number): string {
  const m = formatMoney(cents);
  return `${m.dollars}${m.cents}`;
}

export default function SchemeHub() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ id: string }>();
  const schemeId = typeof params.id === "string" ? params.id : "";
  const queryClient = useQueryClient();

  const detailQuery = useQuery({
    queryKey: ["scheme", schemeId],
    queryFn: () => api<SchemeDetail>(`/api/schemes/${schemeId}`),
    enabled: !!schemeId,
  });
  const overviewQuery = useQuery({
    queryKey: ["scheme", schemeId, "overview"],
    queryFn: () => api<SchemeOverview>(`/api/schemes/${schemeId}/overview`),
    enabled: !!schemeId,
  });

  const scheme = detailQuery.data?.scheme;
  const overview = overviewQuery.data;
  const finance = overview?.finance;

  const refetchAll = () => {
    void queryClient.invalidateQueries({ queryKey: ["scheme", schemeId] });
  };
  const refreshing = detailQuery.isRefetching || overviewQuery.isRefetching;
  const loading =
    (detailQuery.isPending || overviewQuery.isPending) && !scheme && !finance;
  const failed =
    (detailQuery.isError && !scheme) || (overviewQuery.isError && !overview);

  const outstanding = finance?.arrearsOutstandingCents ?? 0;
  const lotsInArrears = finance?.lotsInArrears ?? 0;
  const pendingDecisions = overview?.attention.pendingDecisions ?? 0;

  const links = [
    {
      key: "finance",
      icon: "cash-outline" as const,
      title: "Finance",
      subtitle:
        lotsInArrears > 0
          ? `${lotsInArrears} lot${lotsInArrears === 1 ? "" : "s"} in arrears`
          : finance
            ? `${finance.noticeCount} levy notice${finance.noticeCount === 1 ? "" : "s"} issued`
            : "Levies, payments and arrears",
      path: `/scheme/${schemeId}/finance`,
    },
    {
      key: "decisions",
      icon: "checkmark-circle-outline" as const,
      title: "Decisions",
      subtitle:
        pendingDecisions > 0
          ? `${pendingDecisions} waiting on you`
          : "Approvals on the record",
      path: `/scheme/${schemeId}/decisions`,
    },
    {
      key: "meetings",
      icon: "calendar-outline" as const,
      title: "Meetings",
      subtitle: overview?.nextMeeting
        ? `Next: ${formatDate(overview.nextMeeting.scheduledAt)}`
        : "Notices and minutes",
      path: `/scheme/${schemeId}/meetings`,
    },
    {
      key: "documents",
      icon: "document-text-outline" as const,
      title: "Documents",
      subtitle: "The scheme's records",
      path: `/scheme/${schemeId}/documents`,
    },
  ];

  return (
    <Screen
      title={scheme?.name ?? "Scheme"}
      eyebrow={plate(scheme)}
      reserveEyebrow
      refreshing={refreshing}
      onRefresh={refetchAll}
    >
      {failed ? (
        <ErrorState onRetry={refetchAll} />
      ) : loading ? (
        <>
          <Card>
            <Skeleton width="40%" height={12} />
            <View style={{ marginTop: space(2) }}>
              <Skeleton width="60%" height={40} radius={8} />
            </View>
            <View style={{ marginTop: space(3) }}>
              <Skeleton width="50%" height={14} />
            </View>
          </Card>
          <SectionHeader label="In this scheme" />
          <Card>
            {[0, 1, 2, 3].map((i) => (
              <View key={i} style={{ paddingVertical: space(3) }}>
                <Skeleton width={i % 2 ? "55%" : "70%"} height={16} />
              </View>
            ))}
          </Card>
        </>
      ) : (
        <>
          <Card onPress={() => router.push(`/scheme/${schemeId}/finance`)}>
            <Text style={[t.label, { color: theme.muted }]}>Levies outstanding</Text>
            <View style={{ marginTop: space(1) }}>
              <Figure
                cents={outstanding}
                size="hero"
                tone={outstanding > 0 ? "crit" : "default"}
              />
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
                {overview
                  ? `${overview.glance.lots} lot${overview.glance.lots === 1 ? "" : "s"} · levied ${money(finance?.leviedCents ?? 0)}`
                  : "Levies, payments and arrears"}
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
          </Card>

          <SectionHeader label="In this scheme" />
          <Card>
            {links.map((link, i) => (
              <ListRow
                key={link.key}
                title={link.title}
                subtitle={link.subtitle}
                leading={<Ionicons name={link.icon} size={18} color={theme.accent} />}
                onPress={() => router.push(link.path)}
                divider={i < links.length - 1}
              />
            ))}
          </Card>
        </>
      )}
    </Screen>
  );
}
