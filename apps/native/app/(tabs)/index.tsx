import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import * as DocumentPicker from "expo-document-picker";
import { useRouter } from "expo-router";
import { type ReactNode, useEffect, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Figure,
  formatDate,
  PressableScale,
  Screen,
  Skeleton,
  StatusPill,
  type StatusToneName,
  space,
  statusTone,
  type as t,
  useListEntering,
  useTheme,
} from "../../src/components";
import { OwnerObligationsCard } from "../../src/components/OwnerObligationsCard";
import { api, apiPost } from "../../src/lib/api";
import { authClient } from "../../src/lib/auth";
import { API_ORIGIN } from "../../src/lib/config";
import { getSchemePresentationMode, OFFICER_ROLES } from "../../src/lib/roles";

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
  onboarding?: {
    hasLots: boolean;
    hasInsurance: boolean;
    ready: boolean;
    status: string;
  };
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
    openMaintenanceRequests?: number;
    openWorkOrders?: number;
    complianceOverdue?: number;
  };
  nextMeeting?: { id: string; kind: string; title: string; scheduledAt: string } | null;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

interface AttentionItem {
  key: string;
  schemeId: string;
  schemeName: string;
  label: string;
  pillLabel: string;
  tone: StatusToneName;
  target?: "decisions" | "maintenance" | "compliance";
}

/** Committee work queues, drawn from each scheme's overview. */
function attentionItems(
  entries: { scheme: SchemeRow; roles: string[] }[],
  overviews: (SchemeOverview | undefined)[],
): AttentionItem[] {
  const items: AttentionItem[] = [];
  // With a single scheme its card is in the same viewport, and its hero
  // figure + pill already carry the arrears fact — repeating it as an
  // attention row would say "levies overdue" three times on one screen.
  const singleScheme = entries.length === 1;
  entries.forEach((entry, i) => {
    // Owners get their personal lot obligations below their scheme card. The
    // overview's governance/maintenance/arrears counters are committee data.
    if (getSchemePresentationMode(entry.roles) === "owner") return;
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
        target: "decisions",
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
    const openMaintenance =
      (ov.attention?.openMaintenanceRequests ?? 0) + (ov.attention?.openWorkOrders ?? 0);
    if (openMaintenance > 0) {
      items.push({
        key: `${entry.scheme.id}-maintenance`,
        schemeId: entry.scheme.id,
        schemeName: entry.scheme.name,
        label: `${plural(openMaintenance, "maintenance item")} open`,
        pillLabel: "Open",
        tone: statusTone("open"),
        target: "maintenance",
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
        target: "compliance",
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

function hasOfficerRole(roles: string[]): boolean {
  return roles.some((role) => OFFICER_ROLES.includes(role));
}

function ChecklistRow({
  label,
  done,
  actionLabel,
  onAction,
}: {
  label: string;
  done: boolean;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space(3) }}>
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: 12,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: done ? theme.okSoft : theme.neutralSoft,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: done ? theme.ok : theme.line,
        }}
      >
        <Ionicons
          name={done ? "checkmark" : "ellipse"}
          size={done ? 15 : 6}
          color={done ? theme.ok : theme.muted}
        />
      </View>
      <View style={{ flex: 1, paddingTop: 1 }}>
        <Text
          style={{
            ...t.bodySmall,
            color: done ? theme.text : theme.muted,
            fontFamily: done ? "PublicSans_600SemiBold" : t.bodySmall.fontFamily,
          }}
        >
          {label}
        </Text>
        {!done && actionLabel && onAction ? (
          <PressableScale
            onPress={onAction}
            accessibilityRole="button"
            style={{ alignSelf: "flex-start", minHeight: 44, justifyContent: "center" }}
          >
            <Text style={[t.label, { color: theme.accent }]}>{actionLabel}</Text>
          </PressableScale>
        ) : null}
      </View>
    </View>
  );
}

function OnboardingChecklistCard({
  scheme,
  overview,
  roles,
}: {
  scheme: SchemeRow;
  overview: SchemeOverview;
  roles: string[];
}) {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const onboarding = overview.onboarding;
  const isOfficer = hasOfficerRole(roles);

  const activate = useMutation({
    mutationFn: () => apiPost<{ ok: boolean }>(`/api/schemes/${scheme.id}/activate`),
    onSuccess: () => {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["schemes"] }),
        queryClient.invalidateQueries({ queryKey: ["scheme", scheme.id] }),
        queryClient.invalidateQueries({ queryKey: ["scheme", scheme.id, "overview"] }),
      ]);
    },
  });

  const uploadInsurance = useMutation({
    mutationFn: async () => {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "image/*"],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets[0]) return false;
      const asset = result.assets[0];
      const form = new FormData();
      form.append("title", asset.name);
      form.append("category", "insurance");
      form.append("accessLevel", "owners");
      form.append("file", {
        uri: asset.uri,
        name: asset.name,
        type: asset.mimeType ?? "application/octet-stream",
      } as unknown as Blob);
      const cookie = authClient.getCookie();
      const response = await fetch(`${API_ORIGIN}/api/schemes/${scheme.id}/documents`, {
        method: "POST",
        headers: { Accept: "application/json", ...(cookie ? { Cookie: cookie } : {}) },
        body: form,
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? "Couldn't upload that certificate.");
      }
      return true;
    },
    onSuccess: (uploaded) => {
      if (!uploaded) return;
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["scheme", scheme.id, "documents"] }),
        queryClient.invalidateQueries({ queryKey: ["scheme", scheme.id, "overview"] }),
      ]);
    },
  });

  if (!onboarding) return null;
  const completed = 1 + Number(onboarding.hasLots) + Number(onboarding.hasInsurance);

  return (
    <Card style={{ marginTop: space(3) }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space(3) }}>
        <View style={{ flex: 1 }}>
          <Text style={[t.title, { color: theme.text }]}>Onboarding checklist</Text>
          <Text style={[t.bodySmall, { color: theme.muted, marginTop: space(1) }]}>
            Everything needed before this owners corporation goes live.
          </Text>
        </View>
        <StatusPill tone={onboarding.ready ? "ok" : "warn"} label={`${completed} / 3`} />
      </View>

      <View style={{ gap: space(4), marginTop: space(5) }}>
        <ChecklistRow label="Scheme registered" done />
        <ChecklistRow
          label="Lots imported from plan of subdivision"
          done={onboarding.hasLots}
          actionLabel={isOfficer ? "Import lots" : undefined}
          onAction={
            isOfficer
              ? () => router.push({ pathname: "/scheme/[id]/lots", params: { id: scheme.id } })
              : undefined
          }
        />
        <ChecklistRow
          label="Insurance certificate of currency uploaded"
          done={onboarding.hasInsurance}
          actionLabel={isOfficer ? "Upload certificate" : undefined}
          onAction={isOfficer ? () => uploadInsurance.mutate() : undefined}
        />
      </View>

      {uploadInsurance.isPending ? (
        <Text style={[t.bodySmall, { color: theme.muted, marginTop: space(3) }]}>
          Uploading certificate…
        </Text>
      ) : null}
      {uploadInsurance.error ? (
        <Text style={[t.bodySmall, { color: theme.crit, marginTop: space(3) }]}>
          {uploadInsurance.error.message}
        </Text>
      ) : null}
      {activate.error ? (
        <Text style={[t.bodySmall, { color: theme.crit, marginTop: space(3) }]}>
          {activate.error.message}
        </Text>
      ) : null}

      <View style={{ marginTop: space(5) }}>
        {isOfficer ? (
          <Button
            full
            label="Activate scheme"
            onPress={() => activate.mutate()}
            pending={activate.isPending}
            disabled={!onboarding.ready || uploadInsurance.isPending}
          />
        ) : (
          <Text style={[t.bodySmall, { color: theme.muted }]}>
            An office holder will activate the scheme once the checklist is complete.
          </Text>
        )}
      </View>
    </Card>
  );
}

export default function Overview() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
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
  const openedFirstRun = useRef(false);
  const entering = useListEntering(!seenData.current);
  useEffect(() => {
    if (entries) seenData.current = true;
  }, [entries]);
  useEffect(() => {
    if (entries?.length === 0 && !openedFirstRun.current) {
      openedFirstRun.current = true;
      router.push("/onboarding");
    }
  }, [entries, router]);

  const now = new Date();
  const hour = now.getHours();
  const dayPart = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const firstName = session?.user?.name?.trim().split(/\s+/)[0];
  const greeting = firstName ? `Good ${dayPart}, ${firstName}` : `Good ${dayPart}`;
  // Today's date — the year is noise in the app's highest-real-estate line.
  const eyebrow = `${WEEKDAYS[now.getDay()]} ${now.getDate()} ${MONTHS[now.getMonth()]}`;

  const refreshing = schemesQuery.isRefetching || overviewQueries.some((q) => q.isRefetching);
  const onRefresh = () =>
    Promise.all([
      schemesQuery.refetch(),
      queryClient.refetchQueries({ queryKey: ["scheme"], type: "active" }),
    ]);

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
        body="Register your building or accept an invitation to see it here."
        actionLabel="Set up your first building"
        onAction={() => router.push("/onboarding")}
      />
    );
  } else {
    const overviews = overviewQueries.map((q) => q.data);
    const attention = attentionItems(entries, overviews);
    const manySchemes = entries.length > 1;

    content = (
      <View style={{ gap: space(3) }}>
        {attention.map((item) => (
          <Card
            key={item.key}
            onPress={() => {
              if (item.target === "decisions") {
                router.push({
                  pathname: "/scheme/[id]/decisions",
                  params: { id: item.schemeId },
                });
              } else if (item.target === "maintenance") {
                router.push({
                  pathname: "/scheme/[id]/maintenance",
                  params: { id: item.schemeId },
                });
              } else if (item.target === "compliance") {
                router.push({
                  pathname: "/scheme/[id]/compliance",
                  params: { id: item.schemeId },
                });
              } else {
                router.push({ pathname: "/scheme/[id]", params: { id: item.schemeId } });
              }
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: space(3) }}>
              <View style={{ flex: 1 }}>
                <Text style={[t.body, { fontFamily: "PublicSans_600SemiBold", color: theme.text }]}>
                  {item.label}
                </Text>
                {manySchemes ? (
                  <Text style={[t.bodySmall, { color: theme.muted }]}>{item.schemeName}</Text>
                ) : null}
              </View>
              <StatusPill tone={item.tone} label={item.pillLabel} />
              <Ionicons name="chevron-forward" size={16} color={theme.muted} />
            </View>
          </Card>
        ))}

        {entries.map((entry, index) => {
          const { scheme, roles } = entry;
          const presentationMode = getSchemePresentationMode(roles);
          const isOwnerView = presentationMode === "owner";
          const query = overviewQueries[index];
          const ov = query?.data;
          const outstanding = ov?.finance?.arrearsOutstandingCents ?? 0;
          const lotsInArrears = ov?.finance?.lotsInArrears ?? 0;
          const noticeCount = ov?.finance?.noticeCount ?? 0;
          const lots = ov?.glance?.lots ?? 0;
          const people = ov?.glance?.people ?? 0;
          const schemeStatus = ov?.onboarding?.status ?? scheme.status;

          const footerLeft = ov?.nextMeeting
            ? `Next meeting ${formatDate(ov.nextMeeting.scheduledAt)}`
            : lots > 0
              ? `${plural(lots, "lot")} · ${people === 1 ? "1 person" : `${people} people`}`
              : "Setting up";

          const schemePill = {
            tone: statusTone(schemeStatus),
            label: schemeStatus.charAt(0).toUpperCase() + schemeStatus.slice(1),
          };
          const pill = isOwnerView
            ? schemePill
            : outstanding > 0
              ? { tone: statusTone("overdue"), label: "Overdue" }
              : noticeCount > 0
                ? { tone: statusTone("paid"), label: "Paid" }
                : schemePill;

          return (
            <Animated.View key={scheme.id} entering={entering(index)}>
              <Card onPress={() => router.push(`/scheme/${scheme.id}`)}>
                {scheme.planOfSubdivision ? (
                  <Text style={[t.eyebrow, { color: theme.muted, marginBottom: space(1) }]}>
                    {scheme.planOfSubdivision}
                  </Text>
                ) : null}
                <Text style={[t.title, { color: theme.text }]}>{scheme.name}</Text>

                {!isOwnerView ? (
                  <>
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
                  </>
                ) : null}

                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginTop: isOwnerView ? space(3) : space(4),
                    paddingTop: space(3),
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: theme.line,
                  }}
                >
                  <Text style={[t.bodySmall, { color: theme.muted }]}>{ov ? footerLeft : " "}</Text>
                  {ov ? <StatusPill tone={pill.tone} label={pill.label} /> : null}
                </View>
              </Card>
              {schemeStatus !== "active" && ov ? (
                <OnboardingChecklistCard scheme={scheme} overview={ov} roles={roles} />
              ) : null}
              {schemeStatus === "active" && isOwnerView ? (
                <OwnerObligationsCard schemeId={scheme.id} separated />
              ) : null}
            </Animated.View>
          );
        })}
      </View>
    );
  }

  const createAction =
    entries && entries.length > 0 ? (
      <PressableScale
        onPress={() => router.push("/onboarding")}
        accessibilityRole="button"
        accessibilityLabel="Register a new scheme"
        style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
      >
        <Ionicons name="add" size={24} color={theme.accent} />
      </PressableScale>
    ) : undefined;

  return (
    <Screen
      title={greeting}
      eyebrow={eyebrow}
      refreshing={refreshing}
      onRefresh={onRefresh}
      headerRight={createAction}
    >
      {content}
    </Screen>
  );
}
