import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import type { ComponentProps } from "react";
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
import { schemeQueryOptions, useIsOfficer } from "../../../src/lib/roles";

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

/**
 * One row in the hub's "In this scheme" index. A `path` makes it a navigable
 * row; its absence marks a destination not yet built on mobile (rendered as a
 * quiet "Soon" row rather than a dead link).
 */
interface HubLink {
  key: string;
  icon: ComponentProps<typeof Ionicons>["name"];
  title: string;
  subtitle: string;
  path?: string;
}

export default function SchemeHub() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ id: string }>();
  const schemeId = typeof params.id === "string" ? params.id : "";
  const queryClient = useQueryClient();

  const detailQuery = useQuery({ ...schemeQueryOptions(schemeId), enabled: !!schemeId });
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

  // Presentation-only role gate, mirroring web's OWNER vs COMMITTEE split
  // (schemes.$schemeId.tsx). Officers/managers get the full register; plain
  // owners and committee members get the focused resident view. Gate on
  // `rolesLoaded` so the officer set (with Decisions) is never flashed before
  // roles resolve. The API still enforces every read — hiding a row is UX.
  const isOfficer = useIsOfficer(schemeId);
  const rolesLoaded = !!detailQuery.data;

  const financeSubtitle =
    lotsInArrears > 0
      ? `${lotsInArrears} lot${lotsInArrears === 1 ? "" : "s"} in arrears`
      : finance
        ? `${finance.noticeCount} levy notice${finance.noticeCount === 1 ? "" : "s"} issued`
        : "Levies, payments and arrears";
  const meetingsSubtitle = overview?.nextMeeting
    ? `Next: ${formatDate(overview.nextMeeting.scheduledAt)}`
    : "Notices and minutes";
  const complianceOverdue = overview?.attention.complianceOverdue ?? 0;
  const complianceOpen = overview?.attention.complianceOpen ?? 0;
  const complianceSubtitle =
    complianceOverdue > 0
      ? `${complianceOverdue} overdue`
      : complianceOpen > 0
        ? `${complianceOpen} obligation${complianceOpen === 1 ? "" : "s"} open`
        : "Statutory deadlines";
  const openMaintenance = overview?.attention.openMaintenanceRequests ?? 0;
  const maintenanceSubtitle =
    openMaintenance > 0
      ? `${openMaintenance} open request${openMaintenance === 1 ? "" : "s"}`
      : "Repairs and requests";

  const officerLinks: HubLink[] = [
    {
      key: "finance",
      icon: "cash-outline",
      title: "Finance",
      subtitle: financeSubtitle,
      path: `/scheme/${schemeId}/finance`,
    },
    {
      key: "decisions",
      icon: "checkmark-circle-outline",
      title: "Decisions",
      subtitle:
        pendingDecisions > 0 ? `${pendingDecisions} waiting on you` : "Approvals on the record",
      path: `/scheme/${schemeId}/decisions`,
    },
    {
      key: "maintenance",
      icon: "construct-outline",
      title: "Maintenance",
      subtitle: maintenanceSubtitle,
      path: `/scheme/${schemeId}/maintenance`,
    },
    {
      key: "meetings",
      icon: "calendar-outline",
      title: "Meetings",
      subtitle: meetingsSubtitle,
      path: `/scheme/${schemeId}/meetings`,
    },
    {
      key: "compliance",
      icon: "shield-checkmark-outline",
      title: "Compliance",
      subtitle: complianceSubtitle,
      path: `/scheme/${schemeId}/compliance`,
    },
    {
      key: "grievances",
      icon: "chatbox-ellipses-outline",
      title: "Grievances",
      subtitle: "Concerns and disputes",
      path: `/scheme/${schemeId}/grievances`,
    },
    {
      key: "documents",
      icon: "document-text-outline",
      title: "Documents",
      subtitle: "The scheme's records",
      path: `/scheme/${schemeId}/documents`,
    },
  ];

  // Owner-voiced subset. "Report an issue" (maintenance) and "My building"
  // (community) have no mobile route yet — they render as quiet "Soon" rows
  // until parity lands, matching the web owner nav order.
  const ownerLinks: HubLink[] = [
    {
      key: "maintenance",
      icon: "construct-outline",
      title: "Report an issue",
      subtitle: "Maintenance and repairs",
      path: `/scheme/${schemeId}/maintenance`,
    },
    {
      key: "finance",
      icon: "cash-outline",
      title: "What I owe",
      subtitle: financeSubtitle,
      path: `/scheme/${schemeId}/finance`,
    },
    {
      key: "meetings",
      icon: "calendar-outline",
      title: "Meetings",
      subtitle: meetingsSubtitle,
      path: `/scheme/${schemeId}/meetings`,
    },
    {
      key: "community",
      icon: "people-outline",
      title: "My building",
      subtitle: "Neighbours and notices",
    },
    {
      key: "grievances",
      icon: "chatbox-ellipses-outline",
      title: "Raise a concern",
      subtitle: "Grievances and disputes",
      path: `/scheme/${schemeId}/grievances`,
    },
    {
      key: "documents",
      icon: "document-text-outline",
      title: "Documents",
      subtitle: "The scheme's records",
      path: `/scheme/${schemeId}/documents`,
    },
  ];

  const links = isOfficer ? officerLinks : ownerLinks;

  return (
    <Screen
      title={scheme?.name ?? "Scheme"}
      eyebrow={plate(scheme)}
      reserveEyebrow
      refreshing={refreshing}
      onRefresh={refetchAll}
      skyline
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
            {rolesLoaded
              ? links.map((link, i) => (
                  <ListRow
                    key={link.key}
                    title={link.title}
                    subtitle={link.subtitle}
                    leading={<Ionicons name={link.icon} size={18} color={theme.accent} />}
                    onPress={link.path ? () => router.push(link.path!) : undefined}
                    chevron={!!link.path}
                    right={
                      link.path ? undefined : (
                        <Text style={[t.caption, { color: theme.muted }]}>Soon</Text>
                      )
                    }
                    divider={i < links.length - 1}
                  />
                ))
              : [0, 1, 2, 3].map((i) => (
                  <View key={i} style={{ paddingVertical: space(3) }}>
                    <Skeleton width={i % 2 ? "55%" : "70%"} height={16} />
                  </View>
                ))}
          </Card>
        </>
      )}
    </Screen>
  );
}
