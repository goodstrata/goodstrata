import { Ionicons } from "@expo/vector-icons";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ReactNode, useEffect, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import {
  Card,
  EmptyState,
  ErrorState,
  Figure,
  Screen,
  Skeleton,
  StatusPill,
  formatDate,
  space,
  statusTone,
  type as t,
  useListEntering,
  useTheme,
} from "../../src/components";
import { api } from "../../src/lib/api";
import { authClient } from "../../src/lib/auth";

interface SchemeRow {
  id: string;
  name: string;
  planOfSubdivision: string | null;
  status: string;
}

interface SchemesResponse {
  schemes: { scheme: SchemeRow; roles: string[] }[];
}

interface SchemeOverview {
  glance?: { lots?: number; people?: number; members?: number };
  finance?: {
    hasBudget?: boolean;
    noticeCount?: number;
    arrearsOutstandingCents?: number;
    lotsInArrears?: number;
  };
  attention?: {
    pendingDecisions?: number;
    overdueDecisions?: number;
    complianceOverdue?: number;
  };
  nextMeeting?: { id: string; kind: string; title: string; scheduledAt: string } | null;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

interface AttentionItem {
  key: string;
  schemeId: string;
  schemeName: string;
  label: string;
  pillLabel: string;
  tone: "ok" | "warn" | "crit";
}

/** Things that need the owner's eye, drawn from each scheme's overview. */
function attentionItems(
  entries: { scheme: SchemeRow }[],
  overviews: (SchemeOverview | undefined)[],
): AttentionItem[] {
  const items: AttentionItem[] = [];
  // With a single scheme its card is in the same viewport, and its hero
  // figure + pill already carry the arrears fact — repeating it as an
  // attention row would say "levies overdue" three times on one screen.
  const singleScheme = entries.length === 1;
  entries.forEach((entry, i) => {
    const ov = overviews[i];
    if (!ov) return;
    const pending = ov.attention?.pendingDecisions ?? 0;
    if (pending > 0) {
      items.push({
        key: `${entry.scheme.id}-decisions`,
        schemeId: entry.scheme.id,
        schemeName: entry.scheme.name,
        label: `${plural(pending, "decision")} waiting`,
        pillLabel: "Pending",
        tone: statusTone("pending"),
      });
    }
    const outstanding = ov.finance?.arrearsOutstandingCents ?? 0;
    if (outstanding > 0 && !singleScheme) {
      items.push({
        key: `${entry.scheme.id}-arrears`,
        schemeId: entry.scheme.id,
        schemeName: entry.scheme.name,
        label: "Levies overdue",
        pillLabel: "Overdue",
        tone: statusTone("overdue"),
      });
    }
    const compliance = ov.attention?.complianceOverdue ?? 0;
    if (compliance > 0) {
      items.push({
        key: `${entry.scheme.id}-compliance`,
        schemeId: entry.scheme.id,
        schemeName: entry.scheme.name,
        label: `${plural(compliance, "compliance item")} overdue`,
        pillLabel: "Overdue",
        tone: statusTone("overdue"),
      });
    }
  });
  return items;
}

/** Skeleton mirroring a scheme card: eyebrow line, hero figure block, footer line. */
function SchemeCardSkeleton() {
  return (
    <Card>
      <Skeleton width="40%" height={12} />
      <View style={{ marginTop: space(2) }}>
        <Skeleton width="70%" height={20} />
      </View>
      <View style={{ marginTop: space(5) }}>
        <Skeleton width="55%" height={40} radius={8} />
      </View>
      <View style={{ marginTop: space(4) }}>
        <Skeleton width="100%" height={14} />
      </View>
    </Card>
  );
}

export default function Overview() {
  const theme = useTheme();
  const router = useRouter();
  const { data: session } = authClient.useSession();

  const schemesQuery = useQuery({
    queryKey: ["schemes"],
    queryFn: () => api<SchemesResponse>("/api/schemes"),
  });
  const entries = schemesQuery.data?.schemes;

  const overviewQueries = useQueries({
    queries: (entries ?? []).map((entry) => ({
      queryKey: ["scheme", entry.scheme.id, "overview"],
      queryFn: () => api<SchemeOverview>(`/api/schemes/${entry.scheme.id}/overview`),
    })),
  });

  // Entrance stagger runs on the first successful load only — never on
  // refetch, pull-to-refresh, or tab return.
  const seenData = useRef(false);
  const entering = useListEntering(!seenData.current);
  useEffect(() => {
    if (entries) seenData.current = true;
  }, [entries]);

  const now = new Date();
  const hour = now.getHours();
  const dayPart = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const firstName = session?.user?.name?.trim().split(/\s+/)[0];
  const greeting = firstName ? `Good ${dayPart}, ${firstName}` : `Good ${dayPart}`;
  // Today's date — the year is noise in the app's highest-real-estate line.
  const eyebrow = `${WEEKDAYS[now.getDay()]} ${now.getDate()} ${MONTHS[now.getMonth()]}`;

  const refreshing = schemesQuery.isRefetching || overviewQueries.some((q) => q.isRefetching);
  const onRefresh = () => {
    schemesQuery.refetch();
    for (const q of overviewQueries) q.refetch();
  };

  let content: ReactNode;

  if (schemesQuery.isPending) {
    content = (
      <View style={{ gap: space(3) }}>
        <SchemeCardSkeleton />
        <SchemeCardSkeleton />
      </View>
    );
  } else if (schemesQuery.isError && !entries) {
    content = <ErrorState onRetry={() => schemesQuery.refetch()} />;
  } else if (!entries || entries.length === 0) {
    content = (
      <EmptyState
        icon="business-outline"
        title="No schemes yet"
        body="Accept an invitation to see your owners corporation here."
      />
    );
  } else {
    const overviews = overviewQueries.map((q) => q.data);
    const attention = attentionItems(entries, overviews);
    const manySchemes = entries.length > 1;

    content = (
      <View style={{ gap: space(3) }}>
        {attention.map((item) => (
          <Card key={item.key} onPress={() => router.push(`/scheme/${item.schemeId}`)}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space(3) }}>
              <View style={{ flex: 1 }}>
                <Text
                  style={[t.body, { fontFamily: "PublicSans_600SemiBold", color: theme.text }]}
                >
                  {item.label}
                </Text>
                {manySchemes ? (
                  <Text style={[t.bodySmall, { color: theme.muted }]}>
                    {item.schemeName}
                  </Text>
                ) : null}
              </View>
              <StatusPill tone={item.tone} label={item.pillLabel} />
              <Ionicons name="chevron-forward" size={16} color={theme.muted} />
            </View>
          </Card>
        ))}

        {entries.map((entry, index) => {
          const { scheme } = entry;
          const query = overviewQueries[index];
          const ov = query?.data;
          const outstanding = ov?.finance?.arrearsOutstandingCents ?? 0;
          const lotsInArrears = ov?.finance?.lotsInArrears ?? 0;
          const noticeCount = ov?.finance?.noticeCount ?? 0;
          const lots = ov?.glance?.lots ?? 0;
          const people = ov?.glance?.people ?? 0;

          const footerLeft = ov?.nextMeeting
            ? `Next meeting ${formatDate(ov.nextMeeting.scheduledAt)}`
            : lots > 0
              ? `${plural(lots, "lot")} · ${people === 1 ? "1 person" : `${people} people`}`
              : "Setting up";

          const pill =
            outstanding > 0
              ? { tone: statusTone("overdue"), label: "Overdue" }
              : noticeCount > 0
                ? { tone: statusTone("paid"), label: "Paid" }
                : {
                    tone: statusTone(scheme.status),
                    label: scheme.status.charAt(0).toUpperCase() + scheme.status.slice(1),
                  };

          return (
            <Animated.View key={scheme.id} entering={entering(index)}>
              <Card onPress={() => router.push(`/scheme/${scheme.id}`)}>
                {scheme.planOfSubdivision ? (
                  <Text style={[t.eyebrow, { color: theme.muted, marginBottom: space(1) }]}>
                    {scheme.planOfSubdivision}
                  </Text>
                ) : null}
                <Text style={[t.title, { color: theme.text }]}>{scheme.name}</Text>

                <Text style={[t.label, { color: theme.muted, marginTop: space(4) }]}>
                  Levies outstanding
                </Text>
                <View style={{ marginTop: space(1) }}>
                  {ov ? (
                    <>
                      <Figure
                        cents={outstanding}
                        size="hero"
                        tone={outstanding > 0 ? "crit" : "default"}
                      />
                      {outstanding > 0 && lotsInArrears > 0 ? (
                        <Text
                          style={[t.figureSmall, { color: theme.muted, marginTop: space(1) }]}
                        >
                          {plural(lotsInArrears, "lot")} in arrears
                        </Text>
                      ) : null}
                    </>
                  ) : query?.isError ? (
                    <Text style={[t.bodySmall, { color: theme.muted }]}>
                      Couldn't load the balance — pull to refresh.
                    </Text>
                  ) : (
                    <Skeleton width="55%" height={40} radius={8} />
                  )}
                </View>

                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginTop: space(4),
                    paddingTop: space(3),
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: theme.line,
                  }}
                >
                  <Text style={[t.bodySmall, { color: theme.muted }]}>
                    {ov ? footerLeft : " "}
                  </Text>
                  {ov ? <StatusPill tone={pill.tone} label={pill.label} /> : null}
                </View>
              </Card>
            </Animated.View>
          );
        })}
      </View>
    );
  }

  return (
    <Screen title={greeting} eyebrow={eyebrow} refreshing={refreshing} onRefresh={onRefresh}>
      {content}
    </Screen>
  );
}
