import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import * as Linking from "expo-linking";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  ListRow,
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
import { schemeQueryOptions } from "../../../src/lib/roles";

// ---------------------------------------------------------------------------
// API types (from the API map — meetings list + detail)
// ---------------------------------------------------------------------------

type MeetingStatus = "draft" | "notice_sent" | "in_progress" | "closed" | "minutes_distributed";

interface Meeting {
  id: string;
  schemeId: string;
  kind: string;
  title: string | null;
  scheduledAt: string;
  location: string | null;
  videoUrl: string | null;
  status: MeetingStatus;
  noticeSentAt: string | null;
  quorumMet: boolean | null;
  minutesDocumentId: string | null;
}

interface AgendaItem {
  id: string;
  meetingId: string;
  order: number;
  title: string;
}

interface MeetingsResponse {
  meetings: Meeting[];
}

interface MeetingDetailResponse {
  meeting: Meeting;
  agenda: AgendaItem[];
}

// ---------------------------------------------------------------------------
// Local helpers (composed here — the kit owns nothing meeting-specific)
// ---------------------------------------------------------------------------

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "Tue 15 Jul, 6:30 pm" — the title line of an upcoming meeting card. */
function formatDayTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hours = d.getHours();
  const minutes = d.getMinutes();
  const meridiem = hours >= 12 ? "pm" : "am";
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}, ${h12}:${String(minutes).padStart(2, "0")} ${meridiem}`;
}

const KIND_LABELS: Record<string, string> = {
  agm: "Annual general meeting",
  annual_general: "Annual general meeting",
  annual_general_meeting: "Annual general meeting",
  sgm: "Special general meeting",
  special_general: "Special general meeting",
  egm: "Extraordinary general meeting",
  extraordinary_general: "Extraordinary general meeting",
  committee: "Committee meeting",
  general: "General meeting",
};

/** Australian strata vocabulary, sentence case; eyebrow style uppercases it. */
function kindLabel(kind: string): string {
  const key = kind.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const known = KIND_LABELS[key];
  if (known) return known;
  const words = key.replace(/_/g, " ");
  const label = words.includes("meeting") ? words : `${words} meeting`;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

const JOIN_WINDOW_MS = 15 * 60 * 1000; // joinable within 15 min of start
const PAST_GRACE_MS = 4 * 60 * 60 * 1000; // not closed but hours old → past

function isPastMeeting(m: Meeting, now: number): boolean {
  if (m.status === "closed" || m.status === "minutes_distributed") return true;
  if (m.status === "in_progress") return false;
  const start = new Date(m.scheduledAt).getTime();
  return Number.isFinite(start) && start < now - PAST_GRACE_MS;
}

function isJoinable(m: Meeting, now: number): boolean {
  if (m.status === "in_progress") return true;
  if (!m.videoUrl) return false;
  const start = new Date(m.scheduledAt).getTime();
  return Number.isFinite(start) && start - now <= JOIN_WINDOW_MS;
}

/** Minutes state line for a past meeting's row. */
function minutesState(m: Meeting): string {
  if (m.minutesDocumentId || m.status === "minutes_distributed") return "Minutes available";
  return "Minutes not yet available";
}

const AGENDA_PREVIEW_COUNT = 3;

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function MeetingsScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const schemeId = String(params.id ?? "");

  // Clock tick so the join window opens without a manual refresh.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const schemeQuery = useQuery({ ...schemeQueryOptions(schemeId), enabled: !!schemeId });

  const meetingsQuery = useQuery({
    queryKey: ["scheme", schemeId, "meetings"],
    queryFn: () => api<MeetingsResponse>(`/api/schemes/${schemeId}/meetings`),
    enabled: !!schemeId,
  });

  const meetings = meetingsQuery.data?.meetings ?? [];
  const upcoming = meetings
    .filter((m) => !isPastMeeting(m, now))
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  const past = meetings.filter((m) => isPastMeeting(m, now)); // already scheduledAt desc

  // Agenda previews for upcoming meetings (detail endpoint carries the agenda).
  const agendaQueries = useQueries({
    queries: upcoming.map((m) => ({
      queryKey: ["scheme", schemeId, "meeting", m.id],
      queryFn: () => api<MeetingDetailResponse>(`/api/schemes/${schemeId}/meetings/${m.id}`),
      staleTime: 60_000,
    })),
  });
  const agendaByMeeting = new Map<string, { pending: boolean; items: AgendaItem[] }>();
  upcoming.forEach((m, i) => {
    const q = agendaQueries[i];
    agendaByMeeting.set(m.id, {
      pending: !!q?.isPending,
      items: (q?.data?.agenda ?? []).slice().sort((a, b) => a.order - b.order),
    });
  });

  // Join a Daily room: POST returns { url }, opened outside the app.
  const [joinErrorId, setJoinErrorId] = useState<string | null>(null);
  const joinMutation = useMutation({
    mutationFn: (meetingId: string) =>
      apiPost<{ url: string; token: string }>(
        `/api/schemes/${schemeId}/meetings/${meetingId}/video/join`,
      ),
    onMutate: () => setJoinErrorId(null),
    onError: (_err, meetingId) => setJoinErrorId(meetingId),
    onSuccess: ({ url }) => {
      Linking.openURL(url).catch(() => {
        // Nothing to record — the room is open server-side; the user can retry.
      });
    },
  });

  // List entrance on the FIRST successful load only.
  const hadDataRef = useRef(false);
  const firstLoad = !hadDataRef.current && meetingsQuery.isSuccess;
  useEffect(() => {
    if (meetingsQuery.isSuccess) hadDataRef.current = true;
  }, [meetingsQuery.isSuccess]);
  const entering = useListEntering(firstLoad);

  const eyebrow = plate(schemeQuery.data?.scheme);

  let content: React.ReactNode;
  if (meetingsQuery.isPending) {
    content = <MeetingsSkeleton />;
  } else if (meetingsQuery.isError && !meetingsQuery.data) {
    content = <ErrorState onRetry={() => meetingsQuery.refetch()} />;
  } else if (meetings.length === 0) {
    content = <EmptyState icon="calendar-outline" title="No meetings scheduled" />;
  } else {
    let stagger = 0;
    content = (
      <>
        {upcoming.length > 0 ? (
          <>
            <SectionHeader label="Upcoming" />
            <View style={{ gap: space(3) }}>
              {upcoming.map((m) => (
                <Animated.View key={m.id} entering={entering(stagger++)}>
                  <UpcomingMeetingCard
                    meeting={m}
                    agenda={agendaByMeeting.get(m.id)}
                    joinable={isJoinable(m, now)}
                    joining={joinMutation.isPending && joinMutation.variables === m.id}
                    joinFailed={joinErrorId === m.id}
                    onJoin={() => joinMutation.mutate(m.id)}
                  />
                </Animated.View>
              ))}
            </View>
          </>
        ) : null}
        {past.length > 0 ? (
          <>
            <SectionHeader label="Past" />
            <Animated.View entering={entering(stagger++)}>
              <Card padded={false} style={{ paddingHorizontal: space(4) }}>
                {past.map((m, i) => {
                  // The date is how owners identify a past meeting — it lives
                  // in the subtitle on every row, so the Minutes pill never
                  // displaces it and the right column stays one kind of thing.
                  const when = formatDate(m.scheduledAt);
                  const hasMinutes =
                    !!m.minutesDocumentId || m.status === "minutes_distributed";
                  return (
                    <ListRow
                      key={m.id}
                      title={m.title || kindLabel(m.kind)}
                      subtitle={when ? `${when} · ${minutesState(m)}` : minutesState(m)}
                      right={hasMinutes ? <StatusPill tone="ok" label="Minutes" /> : undefined}
                      divider={i < past.length - 1}
                    />
                  );
                })}
              </Card>
            </Animated.View>
          </>
        ) : null}
      </>
    );
  }

  return (
    <Screen
      title="Meetings"
      eyebrow={eyebrow}
      reserveEyebrow
      refreshing={meetingsQuery.isRefetching}
      onRefresh={() => meetingsQuery.refetch()}
    >
      {content}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Upcoming meeting card: date block, agenda preview, join affordance
// ---------------------------------------------------------------------------

function UpcomingMeetingCard({
  meeting,
  agenda,
  joinable,
  joining,
  joinFailed,
  onJoin,
}: {
  meeting: Meeting;
  agenda: { pending: boolean; items: AgendaItem[] } | undefined;
  joinable: boolean;
  joining: boolean;
  joinFailed: boolean;
  onJoin: () => void;
}) {
  const theme = useTheme();
  const items = agenda?.items ?? [];
  const preview = items.slice(0, AGENDA_PREVIEW_COUNT);
  const remaining = items.length - preview.length;
  const subtitle = [meeting.title, meeting.location || "Online"].filter(Boolean).join(" · ");

  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <DateBlock iso={meeting.scheduledAt} />
        <View style={{ flex: 1, marginLeft: space(3) }}>
          <Text style={[t.eyebrow, { color: theme.muted }]} numberOfLines={1}>
            {kindLabel(meeting.kind)}
          </Text>
          <Text style={[t.title, { color: theme.text, marginTop: space(1) }]} numberOfLines={1}>
            {formatDayTime(meeting.scheduledAt)}
          </Text>
          <Text
            style={{ ...t.bodySmall, color: theme.muted, marginTop: 2 }}
            numberOfLines={1}
          >
            {subtitle}
          </Text>
        </View>
        {meeting.status === "in_progress" ? <StatusPill tone="ok" label="In progress" /> : null}
      </View>

      {agenda?.pending ? (
        <View style={{ marginTop: space(4), gap: space(2) }}>
          <Skeleton width="72%" height={12} />
          <Skeleton width="56%" height={12} />
        </View>
      ) : preview.length > 0 ? (
        <View
          style={{
            marginTop: space(4),
            paddingTop: space(3),
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: theme.line,
          }}
        >
          <Text style={[t.eyebrow, { color: theme.muted, marginBottom: space(2) }]}>Agenda</Text>
          {preview.map((item, i) => (
            <View
              key={item.id}
              style={{
                flexDirection: "row",
                alignItems: "baseline",
                marginTop: i === 0 ? 0 : space(2),
              }}
            >
              <Text style={{ ...t.figureSmall, fontSize: 12, color: theme.muted, width: space(5) }}>
                {i + 1}
              </Text>
              <Text
                style={{ ...t.bodySmall, flex: 1, color: theme.text }}
                numberOfLines={1}
              >
                {item.title}
              </Text>
            </View>
          ))}
          {remaining > 0 ? (
            <Text
              style={{
                ...t.caption,
                color: theme.muted,
                marginTop: space(2),
                marginLeft: space(5),
              }}
            >
              {remaining} more item{remaining === 1 ? "" : "s"}
            </Text>
          ) : null}
        </View>
      ) : null}

      {joinable ? (
        <View style={{ marginTop: space(4) }}>
          <Button full label="Join meeting" onPress={onJoin} pending={joining} />
          {joinFailed ? (
            <Text
              style={{
                ...t.caption,
                color: theme.warn,
                marginTop: space(2),
                textAlign: "center",
              }}
            >
              Couldn't open the meeting room — try again.
            </Text>
          ) : null}
        </View>
      ) : meeting.videoUrl ? (
        <Text
          style={{
            ...t.caption,
            color: theme.muted,
            marginTop: space(4),
          }}
        >
          Online meeting — joining opens 15 minutes before the start.
        </Text>
      ) : null}
    </Card>
  );
}

/** 44pt calendar block: mono month over the day number. Decorative — the title repeats the date. */
function DateBlock({ iso }: { iso: string }) {
  const theme = useTheme();
  const d = new Date(iso);
  const valid = !Number.isNaN(d.getTime());
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: 44,
        height: 44,
        borderRadius: 10,
        backgroundColor: theme.accentSoft,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        style={{
          fontFamily: "IBMPlexMono_500Medium",
          fontSize: 9,
          lineHeight: 11,
          letterSpacing: 1,
          textTransform: "uppercase",
          color: theme.accent,
        }}
      >
        {valid ? MONTH_NAMES[d.getMonth()] : "—"}
      </Text>
      <Text
        style={{
          fontFamily: "PublicSans_600SemiBold",
          fontSize: 18,
          lineHeight: 22,
          color: theme.accent,
        }}
      >
        {valid ? d.getDate() : ""}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton: one upcoming card + three past rows (matches real shape)
// ---------------------------------------------------------------------------

function MeetingsSkeleton() {
  return (
    <View>
      <SectionHeader label="Upcoming" />
      <Card>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Skeleton width={44} height={44} radius={10} />
          <View style={{ flex: 1, marginLeft: space(3), gap: space(2) }}>
            <Skeleton width="45%" height={11} />
            <Skeleton width="70%" height={18} />
          </View>
        </View>
        <View style={{ marginTop: space(4), gap: space(2) }}>
          <Skeleton width="72%" height={12} />
          <Skeleton width="56%" height={12} />
        </View>
      </Card>
      <SectionHeader label="Past" />
      <Card padded={false} style={{ paddingHorizontal: space(4), paddingVertical: space(3) }}>
        <View style={{ gap: space(4), paddingVertical: space(1) }}>
          <Skeleton width="80%" height={16} />
          <Skeleton width="65%" height={16} />
          <Skeleton width="72%" height={16} />
        </View>
      </Card>
    </View>
  );
}
