import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { File, Paths } from "expo-file-system";
import * as Linking from "expo-linking";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Share, StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  FormField,
  formatDate,
  humanise,
  ListRow,
  PressableScale,
  plate,
  radius,
  Screen,
  SectionHeader,
  Skeleton,
  StatusPill,
  space,
  statusTone,
  type as t,
  useListEntering,
  useTheme,
} from "../../../src/components";
import { ApiError, api, apiPost } from "../../../src/lib/api";
import { authClient } from "../../../src/lib/auth";
import { API_ORIGIN } from "../../../src/lib/config";
import { schemeQueryOptions, useIsOfficer } from "../../../src/lib/roles";

// ---------------------------------------------------------------------------
// API types (from the API map — meetings list + detail)
// ---------------------------------------------------------------------------

type MeetingStatus =
  | "draft"
  | "notice_sent"
  | "in_progress"
  | "closed"
  | "minutes_draft"
  | "minutes_distributed";

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
  chairPersonId: string | null;
  chairName: string | null;
  chairAppointedAt: string | null;
  chairAssistedByAi: boolean;
}

interface AgendaItem {
  id: string;
  meetingId: string;
  order: number;
  title: string;
}

interface AgendaSubmission {
  id: string;
  meetingId: string;
  order: number;
  title: string;
  body: string | null;
  submittedByPersonId: string | null;
  status: "pending" | "rejected";
  motionText: string | null;
  rejectedReason: string | null;
  createdAt: string;
}

interface MotionResult {
  forWeight?: number;
  againstWeight?: number;
  abstainWeight?: number;
  forCount?: number;
  againstCount?: number;
  abstainCount?: number;
  basis?: "headcount" | "entitlement";
  pollDemanded?: boolean;
  castingVote?: "for" | "against";
}

/** A vote already on the register for this motion. */
interface MotionVote {
  lotId: string;
  choice: "for" | "against" | "abstain";
}

interface Motion {
  id: string;
  title: string;
  text: string;
  resolutionType: "ordinary" | "special" | "unanimous";
  status: "draft" | "open" | "carried" | "lost" | "withdrawn";
  pollDemanded: boolean;
  result: MotionResult | null;
  /** Absent means the vote state is unknown — never offer the controls then. */
  votes?: MotionVote[];
}

interface Quorum {
  representedLotCount: number;
  totalLotCount: number;
  representedEntitlement: number;
  totalEntitlement: number;
  quorate: boolean;
  quorumBasis: "lot_count" | "entitlement" | null;
}

interface ChairLogEntry {
  at: string;
  kind: string;
  note: string;
}

interface LotOption {
  id: string;
  lotNumber: string;
}

interface PersonOption {
  id: string;
  givenName: string | null;
  familyName: string | null;
  companyName: string | null;
  email: string | null;
}

interface MeetingsResponse {
  meetings: Meeting[];
}

interface MeetingDetailResponse {
  meeting: Meeting;
  agenda: AgendaItem[];
  submissions: AgendaSubmission[];
  motions: Motion[];
  quorum: Quorum;
  chairLog?: ChairLogEntry[] | null;
  transcriptionStarted?: boolean;
  canExerciseCastingVote: boolean;
  powersOfAttorney: PowerOfAttorneyRecord[];
}

interface PowerOfAttorneyRecord {
  id: string;
  lotId: string;
  donorPersonId: string;
  attorneyPersonId: string;
  startsOn: string;
  endsOn: string | null;
  revokedAt: string | null;
  canRevoke: boolean;
}

// ---------------------------------------------------------------------------
// Local helpers (composed here — the kit owns nothing meeting-specific)
// ---------------------------------------------------------------------------

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTH_NAMES = [
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
  const key = kind
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const known = KIND_LABELS[key];
  if (known) return known;
  const words = humanise(key).toLowerCase();
  const label = words.includes("meeting") ? words : `${words} meeting`;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

const JOIN_WINDOW_MS = 15 * 60 * 1000; // joinable within 15 min of start
const PAST_GRACE_MS = 4 * 60 * 60 * 1000; // not closed but hours old → past

function meetingEnded(status: MeetingStatus): boolean {
  return status === "closed" || status === "minutes_draft" || status === "minutes_distributed";
}

/** General-meeting agendas lock when statutory notice is sent; committee
 * meetings remain open for member proposals until the meeting starts. */
function agendaAcceptingSubmissions(meeting: Meeting): boolean {
  return (
    meeting.status === "draft" || (meeting.kind === "committee" && meeting.status === "notice_sent")
  );
}

function isPastMeeting(m: Meeting, now: number): boolean {
  if (meetingEnded(m.status)) return true;
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
  if (m.status === "minutes_draft") return "Draft minutes awaiting approval";
  if (m.minutesDocumentId || m.status === "minutes_distributed") return "Minutes available";
  return "Minutes not yet available";
}

const AGENDA_PREVIEW_COUNT = 3;

function videoUrlWithToken(url: string, token?: string): string {
  if (!token) return url;
  return `${url}${url.includes("?") ? "&" : "?"}t=${encodeURIComponent(token)}`;
}

function scheduledIso(value: string): string | null {
  const parsed = new Date(value.trim());
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function personLabel(person: PersonOption): string {
  const name = [person.givenName, person.familyName].filter(Boolean).join(" ");
  return name || person.companyName || person.email || "Unnamed person";
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function MeetingsScreen() {
  const params = useLocalSearchParams<{ id: string; focus?: string }>();
  const schemeId = String(params.id ?? "");
  const focusedMeetingId = params.focus ? String(params.focus) : null;
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(focusedMeetingId);

  useEffect(() => {
    if (focusedMeetingId) setSelectedMeetingId(focusedMeetingId);
  }, [focusedMeetingId]);

  return selectedMeetingId ? (
    <MeetingDetailScreen
      schemeId={schemeId}
      meetingId={selectedMeetingId}
      onBack={() => setSelectedMeetingId(null)}
    />
  ) : (
    <MeetingListScreen schemeId={schemeId} onOpen={setSelectedMeetingId} />
  );
}

function MeetingListScreen({
  schemeId,
  onOpen,
}: {
  schemeId: string;
  onOpen: (id: string) => void;
}) {
  const isOfficer = useIsOfficer(schemeId);
  const theme = useTheme();
  const [showSchedule, setShowSchedule] = useState(false);

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
    onSuccess: ({ url, token }) => {
      Linking.openURL(videoUrlWithToken(url, token)).catch(() => {
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
                    onOpen={() => onOpen(m.id)}
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
                  const hasMinutes = !!m.minutesDocumentId || m.status === "minutes_distributed";
                  return (
                    <ListRow
                      key={m.id}
                      title={m.title || kindLabel(m.kind)}
                      subtitle={when ? `${when} · ${minutesState(m)}` : minutesState(m)}
                      right={hasMinutes ? <StatusPill tone="ok" label="Minutes" /> : undefined}
                      onPress={() => onOpen(m.id)}
                      accessibilityHint="Opens meeting details"
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
      topInset={false}
      eyebrow={eyebrow}
      reserveEyebrow
      refreshing={meetingsQuery.isRefetching}
      onRefresh={() =>
        Promise.all([
          meetingsQuery.refetch(),
          schemeQuery.refetch(),
          ...agendaQueries.map((query) => query.refetch()),
        ])
      }
      headerRight={
        isOfficer ? (
          <PressableScale
            onPress={() => setShowSchedule((visible) => !visible)}
            accessibilityRole="button"
            accessibilityLabel={showSchedule ? "Close schedule meeting form" : "Schedule meeting"}
            style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
          >
            <Ionicons name={showSchedule ? "close" : "add"} size={24} color={theme.accent} />
          </PressableScale>
        ) : undefined
      }
    >
      {isOfficer && showSchedule ? (
        <ScheduleMeetingForm
          schemeId={schemeId}
          onCancel={() => setShowSchedule(false)}
          onCreated={(meetingId) => {
            setShowSchedule(false);
            onOpen(meetingId);
          }}
        />
      ) : null}
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
  onOpen,
}: {
  meeting: Meeting;
  agenda: { pending: boolean; items: AgendaItem[] } | undefined;
  joinable: boolean;
  joining: boolean;
  joinFailed: boolean;
  onJoin: () => void;
  onOpen: () => void;
}) {
  const theme = useTheme();
  const items = agenda?.items ?? [];
  const preview = items.slice(0, AGENDA_PREVIEW_COUNT);
  const remaining = items.length - preview.length;
  const subtitle = [meeting.title, meeting.location || "Online"].filter(Boolean).join(" · ");

  return (
    <Card>
      <PressableScale
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`Open ${meeting.title || kindLabel(meeting.kind)}`}
        accessibilityHint="Shows quorum, agenda, attendance and motions"
      >
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <DateBlock iso={meeting.scheduledAt} />
          <View style={{ flex: 1, marginLeft: space(3) }}>
            <Text style={[t.eyebrow, { color: theme.muted }]} numberOfLines={1}>
              {kindLabel(meeting.kind)}
            </Text>
            <Text style={[t.title, { color: theme.text, marginTop: space(1) }]} numberOfLines={1}>
              {formatDayTime(meeting.scheduledAt)}
            </Text>
            <Text style={{ ...t.bodySmall, color: theme.muted, marginTop: 2 }} numberOfLines={1}>
              {subtitle}
            </Text>
          </View>
          {meeting.status === "in_progress" ? (
            <StatusPill tone="ok" label="In progress" />
          ) : (
            <Ionicons name="chevron-forward" size={16} color={theme.muted} />
          )}
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
                <Text
                  style={{ ...t.figureSmall, fontSize: 12, color: theme.muted, width: space(5) }}
                >
                  {i + 1}
                </Text>
                <Text style={{ ...t.bodySmall, flex: 1, color: theme.text }} numberOfLines={1}>
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
      </PressableScale>

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
        borderRadius: radius.control,
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
          <Skeleton width={44} height={44} radius={radius.control} />
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

// ---------------------------------------------------------------------------
// Schedule + detail parity
// ---------------------------------------------------------------------------

const MEETING_KINDS = ["agm", "sgm", "committee"] as const;
type MeetingKind = (typeof MEETING_KINDS)[number];
const RESOLUTION_TYPES = ["ordinary", "special", "unanimous"] as const;
type ResolutionType = (typeof RESOLUTION_TYPES)[number];

function ChoiceOption({
  label,
  selected,
  onPress,
  disabled,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled: !!disabled }}
      style={{
        minHeight: 44,
        justifyContent: "center",
        paddingHorizontal: space(3),
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: selected ? theme.accent : theme.line,
        backgroundColor: selected ? theme.accentSoft : "transparent",
      }}
    >
      <Text style={{ ...t.label, color: selected ? theme.accent : theme.text }}>{label}</Text>
    </PressableScale>
  );
}

function InlineFeedback({ message, tone = "crit" }: { message: string; tone?: "ok" | "crit" }) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: space(2),
        marginTop: space(3),
      }}
    >
      <Ionicons
        name={tone === "ok" ? "checkmark-circle-outline" : "alert-circle-outline"}
        size={18}
        color={tone === "ok" ? theme.ok : theme.crit}
      />
      <Text style={{ ...t.bodySmall, color: tone === "ok" ? theme.ok : theme.crit, flex: 1 }}>
        {message}
      </Text>
    </View>
  );
}

function ScheduleMeetingForm({
  schemeId,
  onCancel,
  onCreated,
}: {
  schemeId: string;
  onCancel: () => void;
  onCreated: (meetingId: string) => void;
}) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<MeetingKind>("agm");
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const [location, setLocation] = useState("");
  const [agenda, setAgenda] = useState("");
  const iso = scheduledIso(when);

  const create = useMutation({
    mutationFn: () =>
      apiPost<{ meeting: Meeting }>(`/api/schemes/${schemeId}/meetings`, {
        kind,
        title: title.trim(),
        scheduledAt: iso,
        location: location.trim() || undefined,
        agenda: agenda
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean)
          .map((item) => ({ title: item })),
      }),
    onSuccess: ({ meeting }) => {
      void queryClient.invalidateQueries({ queryKey: ["scheme", schemeId, "meetings"] });
      onCreated(meeting.id);
    },
  });

  return (
    <Card style={{ marginBottom: space(5) }}>
      <Text style={{ ...t.title, color: theme.text }}>Schedule a meeting</Text>
      <Text style={{ ...t.bodySmall, color: theme.muted, marginTop: space(1) }}>
        Create the draft first. Send the statutory notice from its detail screen.
      </Text>

      <Text style={{ ...t.label, color: theme.muted, marginTop: space(4) }}>Kind</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
        {MEETING_KINDS.map((value) => (
          <ChoiceOption
            key={value}
            label={kindLabel(value)}
            selected={kind === value}
            onPress={() => setKind(value)}
          />
        ))}
      </View>

      <View style={{ gap: space(4), marginTop: space(4) }}>
        <FormField
          label="Title"
          value={title}
          onChangeText={setTitle}
          placeholder="2026 annual general meeting"
          maxLength={200}
        />
        <FormField
          label="When"
          value={when}
          onChangeText={setWhen}
          placeholder="2026-08-15T18:30"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <FormField
          label="Location"
          value={location}
          onChangeText={setLocation}
          placeholder="Building foyer, or leave blank for online"
          maxLength={300}
        />
        <FormField
          label="Agenda — one item per line"
          multiline
          numberOfLines={5}
          value={agenda}
          onChangeText={setAgenda}
          placeholder={"Financial statements\nBudget adoption\nCommittee election"}
        />
      </View>

      {when.length > 0 && !iso ? (
        <InlineFeedback message="Use a valid date and time, for example 2026-08-15T18:30." />
      ) : null}
      {create.error ? (
        <InlineFeedback
          message={
            create.error instanceof Error
              ? create.error.message
              : "The meeting could not be scheduled."
          }
        />
      ) : null}

      <View style={{ gap: space(2), marginTop: space(4) }}>
        <Button
          full
          label="Schedule meeting"
          onPress={() => create.mutate()}
          pending={create.isPending}
          disabled={title.trim().length < 3 || !iso}
        />
        <Button
          full
          variant="secondary"
          label="Cancel"
          onPress={onCancel}
          disabled={create.isPending}
        />
      </View>
    </Card>
  );
}

function MeetingDetailScreen({
  schemeId,
  meetingId,
  onBack,
}: {
  schemeId: string;
  meetingId: string;
  onBack: () => void;
}) {
  const theme = useTheme();
  const isOfficer = useIsOfficer(schemeId);
  const queryClient = useQueryClient();
  const [showProxy, setShowProxy] = useState(false);
  const [showPowerOfAttorney, setShowPowerOfAttorney] = useState(false);
  const [showAgendaProposal, setShowAgendaProposal] = useState(false);
  const [showAddMotion, setShowAddMotion] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [attendanceMode, setAttendanceMode] = useState<"in_person" | "online" | null>(null);
  const [openingMinutes, setOpeningMinutes] = useState(false);
  const [minutesError, setMinutesError] = useState<string | null>(null);

  const schemeQuery = useQuery({ ...schemeQueryOptions(schemeId), enabled: !!schemeId });
  const detailQuery = useQuery({
    queryKey: ["scheme", schemeId, "meeting", meetingId],
    queryFn: () => api<MeetingDetailResponse>(`/api/schemes/${schemeId}/meetings/${meetingId}`),
    enabled: !!schemeId && !!meetingId,
    refetchInterval: (query) => {
      const status = query.state.data?.meeting.status;
      return status && meetingEnded(status) ? false : 3_000;
    },
  });
  const lotsQuery = useQuery({
    queryKey: ["scheme", schemeId, "lots"],
    queryFn: () => api<{ lots: LotOption[] }>(`/api/schemes/${schemeId}/lots`),
    enabled: !!schemeId,
  });

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["scheme", schemeId, "meeting", meetingId] }),
      queryClient.invalidateQueries({ queryKey: ["scheme", schemeId, "meetings"] }),
    ]);
  const beginAction = () => {
    setActionMessage(null);
    setActionError(null);
  };
  const failAction = (error: unknown, fallback: string) =>
    setActionError(error instanceof Error ? error.message : fallback);

  const sendNotice = useMutation({
    mutationFn: () => apiPost(`/api/schemes/${schemeId}/meetings/${meetingId}/notice`),
    onMutate: beginAction,
    onSuccess: () => {
      setActionMessage("Notice sent to all members.");
      invalidate();
    },
    onError: (error) => failAction(error, "The notice could not be sent."),
  });
  const attend = useMutation({
    mutationFn: (mode: "in_person" | "online") =>
      apiPost(`/api/schemes/${schemeId}/meetings/${meetingId}/attend`, { mode }),
    onMutate: beginAction,
    onSuccess: (_result, mode) => {
      setAttendanceMode(mode);
      setActionMessage(
        mode === "online" ? "Online attendance recorded." : "In-person attendance recorded.",
      );
      invalidate();
    },
    onError: (error) => failAction(error, "Attendance could not be recorded."),
  });
  const closeMeeting = useMutation({
    mutationFn: () => apiPost(`/api/schemes/${schemeId}/meetings/${meetingId}/close`),
    onMutate: beginAction,
    onSuccess: () => {
      setActionMessage("Meeting closed. The minutes agent can now draft the minutes.");
      invalidate();
    },
    onError: (error) => failAction(error, "The meeting could not be closed."),
  });
  const approveMinutes = useMutation({
    mutationFn: () => apiPost(`/api/schemes/${schemeId}/meetings/${meetingId}/minutes/approve`),
    onMutate: beginAction,
    onSuccess: () => {
      setActionMessage("Minutes approved and distributed to members.");
      invalidate();
    },
    onError: (error) => failAction(error, "The minutes could not be approved."),
  });
  const startVideo = useMutation({
    mutationFn: () =>
      apiPost<{ url: string }>(`/api/schemes/${schemeId}/meetings/${meetingId}/video/start`),
    onMutate: beginAction,
    onSuccess: ({ url }) => {
      setActionMessage("Video meeting started.");
      invalidate();
      Linking.openURL(url).catch(() => setActionError("The video room could not be opened."));
    },
    onError: (error) => failAction(error, "The video meeting could not be started."),
  });
  const joinVideo = useMutation({
    mutationFn: () =>
      apiPost<{ url: string; token: string }>(
        `/api/schemes/${schemeId}/meetings/${meetingId}/video/join`,
      ),
    onMutate: beginAction,
    onSuccess: ({ url, token }) => {
      Linking.openURL(videoUrlWithToken(url, token)).catch(() =>
        setActionError("The video room could not be opened."),
      );
    },
    onError: (error) => failAction(error, "The video room could not be joined."),
  });

  const openMinutes = async (documentId: string) => {
    if (openingMinutes) return;
    setOpeningMinutes(true);
    setMinutesError(null);
    try {
      const file = await File.downloadFileAsync(
        `${API_ORIGIN}/api/schemes/${schemeId}/documents/${documentId}/content`,
        new File(Paths.cache, `meeting-minutes-${meetingId}.md`),
        { headers: { Cookie: authClient.getCookie() }, idempotent: true },
      );
      await Share.share({ url: file.uri, title: "Meeting minutes" });
    } catch {
      setMinutesError("The minutes could not be opened. Check your access and try again.");
    } finally {
      setOpeningMinutes(false);
    }
  };

  const detail = detailQuery.data;
  const refresh = () =>
    Promise.all([detailQuery.refetch(), lotsQuery.refetch(), schemeQuery.refetch()]);

  if (detailQuery.isPending) {
    return (
      <Screen
        title="Meeting"
        topInset={false}
        eyebrow={plate(schemeQuery.data?.scheme)}
        reserveEyebrow
        onRefresh={refresh}
      >
        <Button variant="secondary" label="All meetings" onPress={onBack} />
        <View style={{ marginTop: space(5) }}>
          <MeetingDetailSkeleton />
        </View>
      </Screen>
    );
  }
  if (detailQuery.isError || !detail) {
    return (
      <Screen
        title="Meeting"
        topInset={false}
        eyebrow={plate(schemeQuery.data?.scheme)}
        reserveEyebrow
        onRefresh={refresh}
      >
        <Button variant="secondary" label="All meetings" onPress={onBack} />
        <ErrorState
          title="Couldn't load this meeting"
          detail={detailQuery.error instanceof Error ? detailQuery.error.message : undefined}
          onRetry={() => detailQuery.refetch()}
        />
      </Screen>
    );
  }

  const meeting = detail.meeting;
  const ended = meetingEnded(meeting.status);
  const agendaOpen = agendaAcceptingSubmissions(meeting);
  const videoEligible =
    (meeting.kind === "committee" || meeting.kind === "agm") &&
    (meeting.status === "notice_sent" || meeting.status === "in_progress");

  return (
    <Screen
      title="Meeting"
      topInset={false}
      eyebrow={plate(schemeQuery.data?.scheme)}
      reserveEyebrow
      refreshing={detailQuery.isRefetching}
      onRefresh={refresh}
    >
      <Button variant="secondary" label="All meetings" onPress={onBack} />

      <Card style={{ marginTop: space(4) }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space(3) }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...t.eyebrow, color: theme.muted }}>{kindLabel(meeting.kind)}</Text>
            <Text style={{ ...t.title, color: theme.text, marginTop: space(1) }}>
              {meeting.title || kindLabel(meeting.kind)}
            </Text>
            <Text style={{ ...t.bodySmall, color: theme.muted, marginTop: space(1) }}>
              {[formatDayTime(meeting.scheduledAt), meeting.location].filter(Boolean).join(" · ")}
            </Text>
          </View>
          <StatusPill tone={statusTone(meeting.status)} label={humanise(meeting.status)} />
        </View>

        {meeting.status === "draft" ? (
          isOfficer ? (
            <View style={{ marginTop: space(4) }}>
              <Button
                full
                label="Send notice"
                onPress={() => sendNotice.mutate()}
                pending={sendNotice.isPending}
              />
            </View>
          ) : (
            <Text style={{ ...t.bodySmall, color: theme.muted, marginTop: space(4) }}>
              This meeting is still a draft — the notice has not gone out yet.
            </Text>
          )
        ) : null}

        {meeting.status === "notice_sent" || meeting.status === "in_progress" ? (
          <View style={{ gap: space(2), marginTop: space(4) }}>
            <Text style={{ ...t.label, color: theme.muted }}>RSVP / attendance</Text>
            <Button
              full
              variant="secondary"
              label={attendanceMode === "in_person" ? "Attending in person ✓" : "Attend in person"}
              onPress={() => attend.mutate("in_person")}
              pending={attend.isPending && attend.variables === "in_person"}
              disabled={attend.isPending}
            />
            <Button
              full
              variant="secondary"
              label={attendanceMode === "online" ? "Attending online ✓" : "Attend online"}
              onPress={() => attend.mutate("online")}
              pending={attend.isPending && attend.variables === "online"}
              disabled={attend.isPending}
            />
            <Button
              full
              variant="secondary"
              label={showProxy ? "Hide proxy form" : "Appoint a proxy"}
              onPress={() => setShowProxy((visible) => !visible)}
            />
            <Button
              full
              variant="secondary"
              label={showPowerOfAttorney ? "Hide authority form" : "Record power of attorney"}
              onPress={() => setShowPowerOfAttorney((visible) => !visible)}
            />
            {isOfficer ? (
              <Button
                full
                variant="secondary"
                label="Close meeting"
                onPress={() => closeMeeting.mutate()}
                pending={closeMeeting.isPending}
              />
            ) : null}
          </View>
        ) : null}

        {videoEligible ? (
          <View
            style={{
              marginTop: space(4),
              paddingTop: space(4),
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: theme.line,
              gap: space(2),
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
              <Ionicons name="videocam-outline" size={18} color={theme.muted} />
              <Text style={{ ...t.label, color: theme.text, flex: 1 }}>Video call</Text>
              <StatusPill tone="agent" label="AI Chair" />
            </View>
            {isOfficer ? (
              <Button
                full
                variant="secondary"
                label="Start video meeting"
                onPress={() => startVideo.mutate()}
                pending={startVideo.isPending}
              />
            ) : null}
            <Button
              full
              label="Join video call"
              onPress={() => joinVideo.mutate()}
              pending={joinVideo.isPending}
            />
          </View>
        ) : null}

        {actionError ? <InlineFeedback message={actionError} /> : null}
        {actionMessage ? <InlineFeedback tone="ok" message={actionMessage} /> : null}
      </Card>

      {showProxy && !ended ? (
        <ProxyAppointmentForm
          schemeId={schemeId}
          meetingId={meetingId}
          onCancel={() => setShowProxy(false)}
          onAppointed={() => {
            setShowProxy(false);
            setActionMessage("Proxy appointed for this meeting.");
            invalidate();
          }}
        />
      ) : null}

      {showPowerOfAttorney && !ended ? (
        <PowerOfAttorneyForm
          schemeId={schemeId}
          onCancel={() => setShowPowerOfAttorney(false)}
          onRecorded={() => {
            setShowPowerOfAttorney(false);
            setActionMessage("Power of attorney recorded and retained.");
            invalidate();
          }}
        />
      ) : null}

      <MeetingChairCard
        schemeId={schemeId}
        meeting={meeting}
        isOfficer={isOfficer}
        onChanged={invalidate}
      />

      <PowerOfAttorneyRegister
        schemeId={schemeId}
        appointments={detail.powersOfAttorney ?? []}
        onChanged={invalidate}
      />

      <QuorumCard quorum={detail.quorum} final={ended} />

      <SectionHeader label="Agenda" />
      {detail.agenda.length === 0 ? (
        <Card>
          <EmptyState icon="list-outline" title="No agenda items" />
        </Card>
      ) : (
        <Card padded={false} style={{ paddingHorizontal: space(4) }}>
          {detail.agenda.map((item, index) => (
            <View
              key={item.id}
              style={{
                flexDirection: "row",
                gap: space(3),
                paddingVertical: space(3),
                borderBottomWidth: index < detail.agenda.length - 1 ? StyleSheet.hairlineWidth : 0,
                borderBottomColor: theme.line,
              }}
            >
              <Text style={{ ...t.figureSmall, color: theme.muted, width: space(5) }}>
                {item.order}
              </Text>
              <Text style={{ ...t.bodySmall, color: theme.text, flex: 1 }}>{item.title}</Text>
            </View>
          ))}
        </Card>
      )}

      {agendaOpen || detail.submissions.length > 0 ? (
        <>
          <SectionHeader
            label="Agenda proposals"
            right={
              agendaOpen ? (
                <PressableScale
                  onPress={() => setShowAgendaProposal((visible) => !visible)}
                  accessibilityRole="button"
                  accessibilityLabel={
                    showAgendaProposal ? "Hide agenda proposal form" : "Propose an agenda item"
                  }
                  style={{ minHeight: 44, justifyContent: "center" }}
                >
                  <Text style={{ ...t.label, color: theme.accent }}>
                    {showAgendaProposal ? "Cancel" : "Propose item"}
                  </Text>
                </PressableScale>
              ) : undefined
            }
          />
          {showAgendaProposal && agendaOpen ? (
            <AgendaSubmissionForm
              schemeId={schemeId}
              meetingId={meetingId}
              onCancel={() => setShowAgendaProposal(false)}
              onSubmitted={async () => {
                setShowAgendaProposal(false);
                setActionMessage("Agenda proposal sent for officer review.");
                await invalidate();
              }}
            />
          ) : null}
          {detail.submissions.length === 0 ? (
            <Card>
              <Text style={{ ...t.bodySmall, color: theme.muted }}>
                Members may propose a motion for this meeting. An officer reviews it before it joins
                the formal agenda.
              </Text>
            </Card>
          ) : (
            <View style={{ gap: space(3) }}>
              {detail.submissions.map((submission) => (
                <AgendaSubmissionCard
                  key={submission.id}
                  schemeId={schemeId}
                  submission={submission}
                  isOfficer={isOfficer}
                  onChanged={invalidate}
                />
              ))}
            </View>
          )}
        </>
      ) : null}

      <ChairLogCard
        entries={detail.chairLog ?? []}
        transcriptionStarted={detail.transcriptionStarted ?? false}
      />

      {meeting.minutesDocumentId ? (
        <>
          <SectionHeader label="Minutes" />
          <Card>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space(3) }}>
              <Ionicons name="document-text-outline" size={22} color={theme.accent} />
              <View style={{ flex: 1 }}>
                <Text style={{ ...t.body, color: theme.text }}>
                  {meeting.status === "minutes_draft" ? "Draft minutes" : "Meeting minutes"}
                </Text>
                <Text style={{ ...t.caption, color: theme.muted }}>
                  {meeting.status === "minutes_draft"
                    ? "Awaiting officer review"
                    : "Approved record"}
                </Text>
              </View>
            </View>
            {meeting.status !== "minutes_draft" || isOfficer ? (
              <View style={{ gap: space(2), marginTop: space(4) }}>
                <Button
                  full
                  variant="secondary"
                  label="Open minutes"
                  onPress={() => openMinutes(meeting.minutesDocumentId!)}
                  pending={openingMinutes}
                />
                {isOfficer && meeting.status === "minutes_draft" ? (
                  <Button
                    full
                    label="Approve and distribute"
                    onPress={() => approveMinutes.mutate()}
                    pending={approveMinutes.isPending}
                  />
                ) : null}
              </View>
            ) : null}
            {minutesError ? <InlineFeedback message={minutesError} /> : null}
          </Card>
        </>
      ) : null}

      <SectionHeader
        label="Motions"
        right={
          isOfficer && !ended ? (
            <PressableScale
              onPress={() => setShowAddMotion((visible) => !visible)}
              accessibilityRole="button"
              accessibilityLabel={showAddMotion ? "Hide motion form" : "Add motion"}
              style={{ minHeight: 44, justifyContent: "center" }}
            >
              <Text style={{ ...t.label, color: theme.accent }}>
                {showAddMotion ? "Cancel" : "Add motion"}
              </Text>
            </PressableScale>
          ) : undefined
        }
      />
      {showAddMotion && isOfficer && !ended ? (
        <AddMotionForm
          schemeId={schemeId}
          meetingId={meetingId}
          onCancel={() => setShowAddMotion(false)}
          onAdded={() => {
            setShowAddMotion(false);
            setActionMessage("Motion added.");
            invalidate();
          }}
        />
      ) : null}
      {detail.motions.length === 0 ? (
        <Card>
          <EmptyState
            icon="hammer-outline"
            title="No motions yet"
            body={
              isOfficer
                ? "Add the first motion for members to vote on."
                : "Motions will appear when officers add them."
            }
          />
        </Card>
      ) : (
        <View style={{ gap: space(3) }}>
          {detail.motions.map((motion) => (
            <MotionCard
              key={motion.id}
              schemeId={schemeId}
              motion={motion}
              isOfficer={isOfficer}
              canExerciseCastingVote={detail.canExerciseCastingVote}
              lots={lotsQuery.data?.lots ?? []}
              lotsPending={lotsQuery.isPending}
              onChange={invalidate}
            />
          ))}
        </View>
      )}
    </Screen>
  );
}

function MeetingChairCard({
  schemeId,
  meeting,
  isOfficer,
  onChanged,
}: {
  schemeId: string;
  meeting: Meeting;
  isOfficer: boolean;
  onChanged: () => void;
}) {
  const theme = useTheme();
  const [useManager, setUseManager] = useState(false);
  const [personId, setPersonId] = useState("");
  const [managerName, setManagerName] = useState("");
  const [aiAssistanceAuthorized, setAiAssistanceAuthorized] = useState(false);
  const people = useQuery({
    queryKey: ["scheme", schemeId, "people"],
    queryFn: () => api<{ people: PersonOption[] }>(`/api/schemes/${schemeId}/people`),
    enabled: isOfficer,
  });
  const appoint = useMutation({
    mutationFn: () =>
      apiPost(
        `/api/schemes/${schemeId}/meetings/${meeting.id}/chair`,
        useManager
          ? { managerName: managerName.trim(), aiAssistanceAuthorized }
          : { personId, aiAssistanceAuthorized },
      ),
    onSuccess: onChanged,
  });
  const ended = meetingEnded(meeting.status);
  return (
    <>
      <SectionHeader label="Meeting chair" />
      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
          <Ionicons name="person-outline" size={20} color={theme.accent} />
          <Text style={{ ...t.title, color: theme.text, flex: 1 }}>
            {meeting.chairName || "No human chair recorded"}
          </Text>
          {meeting.chairAssistedByAi ? <StatusPill tone="agent" label="AI assists" /> : null}
        </View>
        <Text style={{ ...t.bodySmall, color: theme.muted, marginTop: space(2) }}>
          AI can guide and transcribe only when authorised; the owner or manager remains the legal
          chair.
        </Text>
        {isOfficer && !ended ? (
          <View style={{ gap: space(3), marginTop: space(4) }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
              <ChoiceOption
                label="Lot owner"
                selected={!useManager}
                onPress={() => setUseManager(false)}
              />
              <ChoiceOption
                label="Human manager"
                selected={useManager}
                onPress={() => setUseManager(true)}
              />
            </View>
            {useManager ? (
              <FormField
                label="Manager name"
                value={managerName}
                onChangeText={setManagerName}
                placeholder="Full legal name"
              />
            ) : (
              <View style={{ gap: space(2) }}>
                <Text style={{ ...t.label, color: theme.muted }}>Owner from the roll</Text>
                {people.data?.people.map((person) => (
                  <ChoiceOption
                    key={person.id}
                    label={personLabel(person)}
                    selected={personId === person.id}
                    onPress={() => setPersonId(person.id)}
                  />
                ))}
              </View>
            )}
            <ChoiceOption
              label={
                aiAssistanceAuthorized ? "AI assistance authorised" : "Authorise AI assistance"
              }
              selected={aiAssistanceAuthorized}
              onPress={() => setAiAssistanceAuthorized((value) => !value)}
            />
            {appoint.error ? (
              <InlineFeedback
                message={
                  appoint.error instanceof Error
                    ? appoint.error.message
                    : "The chair could not be recorded."
                }
              />
            ) : null}
            <Button
              full
              label="Record human chair"
              onPress={() => appoint.mutate()}
              pending={appoint.isPending}
              disabled={useManager ? managerName.trim().length < 2 : !personId}
            />
          </View>
        ) : null}
      </Card>
    </>
  );
}

function PowerOfAttorneyRegister({
  schemeId,
  appointments,
  onChanged,
}: {
  schemeId: string;
  appointments: PowerOfAttorneyRecord[];
  onChanged: () => void;
}) {
  const theme = useTheme();
  const lots = useQuery({
    queryKey: ["scheme", schemeId, "lots"],
    queryFn: () => api<{ lots: LotOption[] }>(`/api/schemes/${schemeId}/lots`),
    enabled: appointments.length > 0,
  });
  const people = useQuery({
    queryKey: ["scheme", schemeId, "people"],
    queryFn: () => api<{ people: PersonOption[] }>(`/api/schemes/${schemeId}/people`),
    enabled: appointments.length > 0,
  });
  const revoke = useMutation({
    mutationFn: (id: string) => apiPost(`/api/schemes/${schemeId}/powers-of-attorney/${id}/revoke`),
    onSuccess: onChanged,
  });
  if (appointments.length === 0) return null;
  const nameFor = (id: string) => {
    const person = people.data?.people.find((candidate) => candidate.id === id);
    return person ? personLabel(person) : "Person on the roll";
  };
  return (
    <>
      <SectionHeader label="Powers of attorney" />
      <View style={{ gap: space(3) }}>
        {appointments.map((appointment) => {
          const lot = lots.data?.lots.find((candidate) => candidate.id === appointment.lotId);
          return (
            <Card key={appointment.id}>
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space(3) }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...t.body, color: theme.text }}>
                    Lot {lot?.lotNumber ?? "—"} · {nameFor(appointment.attorneyPersonId)}
                  </Text>
                  <Text style={{ ...t.caption, color: theme.muted, marginTop: space(1) }}>
                    From {appointment.startsOn}
                    {appointment.endsOn ? ` to ${appointment.endsOn}` : " onward"}
                  </Text>
                </View>
                <StatusPill
                  tone={appointment.revokedAt ? "neutral" : "ok"}
                  label={appointment.revokedAt ? "Revoked" : "Current"}
                />
              </View>
              {appointment.canRevoke ? (
                <View style={{ marginTop: space(3) }}>
                  <Button
                    full
                    variant="secondary"
                    label="Revoke authority"
                    onPress={() => revoke.mutate(appointment.id)}
                    pending={revoke.isPending && revoke.variables === appointment.id}
                  />
                </View>
              ) : null}
              {revoke.error ? (
                <InlineFeedback
                  message={
                    revoke.error instanceof Error
                      ? revoke.error.message
                      : "The authority could not be revoked."
                  }
                />
              ) : null}
            </Card>
          );
        })}
      </View>
    </>
  );
}

function QuorumCard({ quorum, final }: { quorum: Quorum; final: boolean }) {
  const theme = useTheme();
  const percentage =
    quorum.totalEntitlement > 0
      ? Math.min(100, Math.round((quorum.representedEntitlement / quorum.totalEntitlement) * 100))
      : 0;
  return (
    <>
      <SectionHeader label={final ? "Final quorum" : "Quorum"} />
      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space(3) }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...t.figure, color: theme.text }}>{percentage}%</Text>
            <Text style={{ ...t.bodySmall, color: theme.muted, marginTop: 2 }}>
              {quorum.representedEntitlement}/{quorum.totalEntitlement} entitlements ·{" "}
              {quorum.representedLotCount}/{quorum.totalLotCount} lots
            </Text>
          </View>
          <StatusPill
            tone={quorum.quorate ? "ok" : final ? "neutral" : "warn"}
            label={quorum.quorate ? "Quorate" : final ? "Not reached" : "Not yet quorate"}
          />
        </View>
        <View
          style={{
            height: 6,
            borderRadius: radius.pill,
            backgroundColor: theme.line,
            overflow: "hidden",
            marginTop: space(3),
          }}
        >
          <View
            style={{
              height: 6,
              width: `${percentage}%`,
              borderRadius: radius.pill,
              backgroundColor: quorum.quorate ? theme.ok : theme.warn,
            }}
          />
        </View>
      </Card>
    </>
  );
}

function ChairLogCard({
  entries,
  transcriptionStarted,
}: {
  entries: ChairLogEntry[];
  transcriptionStarted: boolean;
}) {
  const theme = useTheme();
  if (entries.length === 0 && !transcriptionStarted) return null;
  return (
    <>
      <SectionHeader label="AI Chair" />
      <Card>
        {transcriptionStarted ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: radius.pill,
                backgroundColor: theme.crit,
              }}
            />
            <Text style={{ ...t.bodySmall, color: theme.crit }}>Transcribing the meeting</Text>
          </View>
        ) : null}
        {entries.map((entry, index) => (
          <View
            key={`${entry.at}-${entry.kind}-${entry.note}`}
            style={{
              paddingTop: index === 0 && !transcriptionStarted ? 0 : space(3),
              marginTop: index === 0 && !transcriptionStarted ? 0 : space(3),
              borderTopWidth: index === 0 && !transcriptionStarted ? 0 : StyleSheet.hairlineWidth,
              borderTopColor: theme.line,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
              <StatusPill tone="agent" label={humanise(entry.kind)} />
              <Text style={{ ...t.eyebrow, color: theme.muted }}>{formatDayTime(entry.at)}</Text>
            </View>
            <Text style={{ ...t.bodySmall, color: theme.text, marginTop: space(2) }}>
              {entry.note}
            </Text>
          </View>
        ))}
      </Card>
    </>
  );
}

function AgendaSubmissionForm({
  schemeId,
  meetingId,
  onCancel,
  onSubmitted,
}: {
  schemeId: string;
  meetingId: string;
  onCancel: () => void;
  onSubmitted: () => Promise<unknown>;
}) {
  const theme = useTheme();
  const [title, setTitle] = useState("");
  const [motionText, setMotionText] = useState("");
  const [rationale, setRationale] = useState("");
  const submit = useMutation({
    mutationFn: () =>
      apiPost<{ agendaItem: AgendaSubmission }>(
        `/api/schemes/${schemeId}/meetings/${meetingId}/agenda-items`,
        {
          title: title.trim(),
          motionText: motionText.trim(),
          ...(rationale.trim() ? { rationale: rationale.trim() } : {}),
        },
      ),
    onSuccess: async () => {
      setTitle("");
      setMotionText("");
      setRationale("");
      await onSubmitted();
    },
  });
  const valid = title.trim().length >= 3 && motionText.trim().length >= 3;

  return (
    <Card style={{ marginBottom: space(3) }}>
      <Text style={{ ...t.title, color: theme.text }}>Propose an agenda item</Text>
      <Text style={{ ...t.bodySmall, color: theme.muted, marginTop: space(1) }}>
        Put the proposed resolution on the record. An officer must accept it before it becomes part
        of the formal agenda.
      </Text>
      <View style={{ gap: space(4), marginTop: space(4) }}>
        <FormField
          label="Proposal title"
          value={title}
          onChangeText={setTitle}
          placeholder="What should the meeting consider?"
          maxLength={200}
          editable={!submit.isPending}
        />
        <FormField
          label="Proposed motion"
          value={motionText}
          onChangeText={setMotionText}
          placeholder="That the owners corporation resolves to…"
          multiline
          numberOfLines={5}
          maxLength={5000}
          editable={!submit.isPending}
        />
        <FormField
          label="Supporting rationale (optional)"
          value={rationale}
          onChangeText={setRationale}
          placeholder="Why should members support this proposal?"
          multiline
          numberOfLines={4}
          maxLength={5000}
          editable={!submit.isPending}
        />
      </View>
      {submit.isError ? (
        <InlineFeedback
          message={
            submit.error instanceof Error
              ? submit.error.message
              : "The agenda proposal could not be submitted."
          }
        />
      ) : null}
      <View style={{ gap: space(2), marginTop: space(4) }}>
        <Button
          full
          label="Submit proposal"
          onPress={() => submit.mutate()}
          pending={submit.isPending}
          disabled={!valid}
        />
        <Button
          full
          variant="secondary"
          label="Cancel"
          onPress={onCancel}
          disabled={submit.isPending}
        />
      </View>
    </Card>
  );
}

function AgendaSubmissionCard({
  schemeId,
  submission,
  isOfficer,
  onChanged,
}: {
  schemeId: string;
  submission: AgendaSubmission;
  isOfficer: boolean;
  onChanged: () => Promise<unknown>;
}) {
  const theme = useTheme();
  const [resolutionType, setResolutionType] = useState<ResolutionType>("ordinary");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const accept = useMutation({
    mutationFn: () =>
      apiPost(`/api/schemes/${schemeId}/agenda-items/${submission.id}/accept`, {
        resolutionType,
      }),
    onMutate: () => setMessage(null),
    onSuccess: async () => {
      setMessage("Proposal accepted and added to the agenda.");
      await onChanged();
    },
  });
  const reject = useMutation({
    mutationFn: () =>
      apiPost(`/api/schemes/${schemeId}/agenda-items/${submission.id}/reject`, {
        reason: reason.trim(),
      }),
    onMutate: () => setMessage(null),
    onSuccess: async () => {
      setRejecting(false);
      setReason("");
      setMessage("Proposal rejected with a reason on the record.");
      await onChanged();
    },
  });
  const busy = accept.isPending || reject.isPending;
  const error = accept.error ?? reject.error;

  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space(3) }}>
        <View style={{ flex: 1 }}>
          <Text style={{ ...t.body, color: theme.text }}>{submission.title}</Text>
          <Text style={{ ...t.caption, color: theme.muted, marginTop: space(1) }}>
            Proposed {formatDate(submission.createdAt)}
          </Text>
        </View>
        <StatusPill
          tone={submission.status === "pending" ? "warn" : "crit"}
          label={submission.status === "pending" ? "Under review" : "Rejected"}
        />
      </View>
      {submission.motionText ? (
        <View style={{ marginTop: space(3) }}>
          <Text style={{ ...t.label, color: theme.muted }}>Proposed motion</Text>
          <Text style={{ ...t.bodySmall, color: theme.text, marginTop: space(1) }}>
            {submission.motionText}
          </Text>
        </View>
      ) : null}
      {submission.body ? (
        <View style={{ marginTop: space(3) }}>
          <Text style={{ ...t.label, color: theme.muted }}>Rationale</Text>
          <Text style={{ ...t.bodySmall, color: theme.muted, marginTop: space(1) }}>
            {submission.body}
          </Text>
        </View>
      ) : null}
      {submission.rejectedReason ? (
        <InlineFeedback message={`Officer reason: ${submission.rejectedReason}`} />
      ) : null}

      {isOfficer && submission.status === "pending" ? (
        <View
          style={{
            gap: space(3),
            marginTop: space(4),
            paddingTop: space(4),
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: theme.line,
          }}
        >
          <Text style={{ ...t.label, color: theme.muted }}>Resolution type</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
            {RESOLUTION_TYPES.map((value) => (
              <ChoiceOption
                key={value}
                label={humanise(value)}
                selected={resolutionType === value}
                onPress={() => setResolutionType(value)}
                disabled={busy}
              />
            ))}
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
            <Button
              label="Accept proposal"
              onPress={() => accept.mutate()}
              pending={accept.isPending}
              disabled={busy}
            />
            <Button
              variant="secondary"
              label={rejecting ? "Cancel rejection" : "Reject proposal"}
              onPress={() => {
                setRejecting((value) => !value);
                setReason("");
              }}
              disabled={busy}
            />
          </View>
          {rejecting ? (
            <View style={{ gap: space(3) }}>
              <FormField
                label="Reason for rejection"
                value={reason}
                onChangeText={setReason}
                placeholder="Explain why this proposal cannot join the agenda"
                multiline
                maxLength={2000}
                editable={!busy}
              />
              <Button
                variant="destructive"
                label="Confirm rejection"
                onPress={() => reject.mutate()}
                pending={reject.isPending}
                disabled={reason.trim().length < 3 || busy}
              />
            </View>
          ) : null}
          {error ? (
            <InlineFeedback
              message={
                error instanceof Error ? error.message : "The agenda review could not be recorded."
              }
            />
          ) : null}
          {message ? <InlineFeedback tone="ok" message={message} /> : null}
        </View>
      ) : null}
    </Card>
  );
}

function ProxyAppointmentForm({
  schemeId,
  meetingId,
  onCancel,
  onAppointed,
}: {
  schemeId: string;
  meetingId: string;
  onCancel: () => void;
  onAppointed: () => void;
}) {
  const theme = useTheme();
  const [lotId, setLotId] = useState("");
  const [proxyPersonId, setProxyPersonId] = useState("");
  const lotsQuery = useQuery({
    queryKey: ["scheme", schemeId, "lots", "mine"],
    queryFn: () => api<{ lots: LotOption[] }>(`/api/schemes/${schemeId}/lots/mine`),
  });
  const peopleQuery = useQuery({
    queryKey: ["scheme", schemeId, "people"],
    queryFn: () => api<{ people: PersonOption[] }>(`/api/schemes/${schemeId}/people`),
  });
  const appoint = useMutation({
    mutationFn: () =>
      apiPost(`/api/schemes/${schemeId}/proxies`, { lotId, proxyPersonId, meetingId }),
    onSuccess: onAppointed,
  });

  return (
    <Card style={{ marginTop: space(4) }}>
      <Text style={{ ...t.title, color: theme.text }}>Appoint a proxy</Text>
      <Text style={{ ...t.bodySmall, color: theme.muted, marginTop: space(1) }}>
        Choose your lot and the person who may vote for it if you do not attend.
      </Text>

      <Text style={{ ...t.label, color: theme.muted, marginTop: space(4) }}>Your lot</Text>
      {lotsQuery.isPending ? (
        <View style={{ marginTop: space(2) }}>
          <Skeleton width="65%" height={44} />
        </View>
      ) : lotsQuery.isError ? (
        <InlineFeedback message="The lot register could not be loaded." />
      ) : (
        <View
          style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}
        >
          {lotsQuery.data?.lots.map((lot) => (
            <ChoiceOption
              key={lot.id}
              label={`Lot ${lot.lotNumber}`}
              selected={lotId === lot.id}
              onPress={() => setLotId(lot.id)}
            />
          ))}
        </View>
      )}

      <Text style={{ ...t.label, color: theme.muted, marginTop: space(4) }}>Proxy holder</Text>
      {peopleQuery.isPending ? (
        <View style={{ gap: space(2), marginTop: space(2) }}>
          <Skeleton width="82%" height={44} />
          <Skeleton width="70%" height={44} />
        </View>
      ) : peopleQuery.isError ? (
        <InlineFeedback message="The people register could not be loaded." />
      ) : (
        <View style={{ gap: space(2), marginTop: space(2) }}>
          {peopleQuery.data?.people.map((person) => (
            <ChoiceOption
              key={person.id}
              label={personLabel(person)}
              selected={proxyPersonId === person.id}
              onPress={() => setProxyPersonId(person.id)}
            />
          ))}
        </View>
      )}

      {appoint.error ? (
        <InlineFeedback
          message={
            appoint.error instanceof Error
              ? appoint.error.message
              : "The proxy could not be appointed."
          }
        />
      ) : null}
      <View style={{ gap: space(2), marginTop: space(4) }}>
        <Button
          full
          label="Appoint proxy"
          onPress={() => appoint.mutate()}
          pending={appoint.isPending}
          disabled={!lotId || !proxyPersonId}
        />
        <Button full variant="secondary" label="Cancel" onPress={onCancel} />
      </View>
    </Card>
  );
}

function PowerOfAttorneyForm({
  schemeId,
  onCancel,
  onRecorded,
}: {
  schemeId: string;
  onCancel: () => void;
  onRecorded: () => void;
}) {
  const theme = useTheme();
  const [lotId, setLotId] = useState("");
  const [attorneyPersonId, setAttorneyPersonId] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [startsOn, setStartsOn] = useState(new Date().toISOString().slice(0, 10));
  const [endsOn, setEndsOn] = useState("");
  const lots = useQuery({
    queryKey: ["scheme", schemeId, "lots", "mine"],
    queryFn: () => api<{ lots: LotOption[] }>(`/api/schemes/${schemeId}/lots/mine`),
  });
  const people = useQuery({
    queryKey: ["scheme", schemeId, "people"],
    queryFn: () => api<{ people: PersonOption[] }>(`/api/schemes/${schemeId}/people`),
  });
  const documents = useQuery({
    queryKey: ["scheme", schemeId, "documents", "power-of-attorney"],
    queryFn: () =>
      api<{ documents: { id: string; title: string }[] }>(`/api/schemes/${schemeId}/documents`),
  });
  const record = useMutation({
    mutationFn: () =>
      apiPost(`/api/schemes/${schemeId}/powers-of-attorney`, {
        lotId,
        attorneyPersonId,
        documentId,
        startsOn,
        ...(endsOn.trim() ? { endsOn: endsOn.trim() } : {}),
      }),
    onSuccess: onRecorded,
  });
  return (
    <Card style={{ marginTop: space(4) }}>
      <Text style={{ ...t.title, color: theme.text }}>Record power of attorney</Text>
      <Text style={{ ...t.bodySmall, color: theme.muted, marginTop: space(1) }}>
        File the signed instrument so the attorney may represent this lot while it remains current.
      </Text>
      <Text style={{ ...t.label, color: theme.muted, marginTop: space(4) }}>Your lot</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
        {lots.data?.lots.map((lot) => (
          <ChoiceOption
            key={lot.id}
            label={`Lot ${lot.lotNumber}`}
            selected={lotId === lot.id}
            onPress={() => setLotId(lot.id)}
          />
        ))}
      </View>
      <Text style={{ ...t.label, color: theme.muted, marginTop: space(4) }}>Attorney</Text>
      <View style={{ gap: space(2), marginTop: space(2) }}>
        {people.data?.people.map((person) => (
          <ChoiceOption
            key={person.id}
            label={personLabel(person)}
            selected={attorneyPersonId === person.id}
            onPress={() => setAttorneyPersonId(person.id)}
          />
        ))}
      </View>
      <Text style={{ ...t.label, color: theme.muted, marginTop: space(4) }}>
        Retained signed instrument
      </Text>
      <View style={{ gap: space(2), marginTop: space(2) }}>
        {documents.data?.documents.map((document) => (
          <ChoiceOption
            key={document.id}
            label={document.title}
            selected={documentId === document.id}
            onPress={() => setDocumentId(document.id)}
          />
        ))}
      </View>
      <View style={{ gap: space(3), marginTop: space(4) }}>
        <FormField
          label="Starts on (YYYY-MM-DD)"
          value={startsOn}
          onChangeText={setStartsOn}
          placeholder="2026-07-13"
        />
        <FormField
          label="Ends on (optional)"
          value={endsOn}
          onChangeText={setEndsOn}
          placeholder="YYYY-MM-DD"
        />
      </View>
      {record.error ? (
        <InlineFeedback
          message={
            record.error instanceof Error
              ? record.error.message
              : "The authority could not be recorded."
          }
        />
      ) : null}
      <View style={{ gap: space(2), marginTop: space(4) }}>
        <Button
          full
          label="Record authority"
          onPress={() => record.mutate()}
          pending={record.isPending}
          disabled={
            !lotId || !attorneyPersonId || !documentId || !/^\d{4}-\d{2}-\d{2}$/.test(startsOn)
          }
        />
        <Button full variant="secondary" label="Cancel" onPress={onCancel} />
      </View>
    </Card>
  );
}

function AddMotionForm({
  schemeId,
  meetingId,
  onCancel,
  onAdded,
}: {
  schemeId: string;
  meetingId: string;
  onCancel: () => void;
  onAdded: () => void;
}) {
  const theme = useTheme();
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [resolutionType, setResolutionType] = useState<ResolutionType>("ordinary");
  const add = useMutation({
    mutationFn: () =>
      apiPost(`/api/schemes/${schemeId}/motions`, {
        meetingId,
        title: title.trim(),
        text: text.trim(),
        resolutionType,
      }),
    onSuccess: onAdded,
  });

  return (
    <Card style={{ marginBottom: space(3) }}>
      <Text style={{ ...t.title, color: theme.text }}>Add a motion</Text>
      <Text style={{ ...t.bodySmall, color: theme.muted, marginTop: space(1) }}>
        Ordinary resolutions use one vote per lot unless a poll is demanded.
      </Text>
      <View style={{ gap: space(4), marginTop: space(4) }}>
        <FormField
          label="Title"
          value={title}
          onChangeText={setTitle}
          placeholder="Motion title"
          maxLength={200}
        />
        <FormField
          label="Resolution text"
          multiline
          numberOfLines={5}
          value={text}
          onChangeText={setText}
          placeholder="That the owners corporation resolves to…"
          maxLength={5000}
        />
      </View>
      <Text style={{ ...t.label, color: theme.muted, marginTop: space(4) }}>Resolution type</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
        {RESOLUTION_TYPES.map((value) => (
          <ChoiceOption
            key={value}
            label={
              value === "special"
                ? "Special · 75%"
                : value === "unanimous"
                  ? "Unanimous"
                  : "Ordinary"
            }
            selected={resolutionType === value}
            onPress={() => setResolutionType(value)}
          />
        ))}
      </View>
      {add.error ? (
        <InlineFeedback
          message={
            add.error instanceof Error ? add.error.message : "The motion could not be added."
          }
        />
      ) : null}
      <View style={{ gap: space(2), marginTop: space(4) }}>
        <Button
          full
          label="Add motion"
          onPress={() => add.mutate()}
          pending={add.isPending}
          disabled={title.trim().length < 3 || text.trim().length < 3}
        />
        <Button full variant="secondary" label="Cancel" onPress={onCancel} />
      </View>
    </Card>
  );
}

function MotionCard({
  schemeId,
  motion,
  isOfficer,
  canExerciseCastingVote,
  lots,
  lotsPending,
  onChange,
}: {
  schemeId: string;
  motion: Motion;
  isOfficer: boolean;
  canExerciseCastingVote: boolean;
  lots: LotOption[];
  lotsPending: boolean;
  onChange: () => void;
}) {
  const theme = useTheme();
  const [lotId, setLotId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const begin = () => {
    setMessage(null);
    setError(null);
  };
  const fail = (value: unknown, fallback: string) =>
    setError(value instanceof Error ? value.message : fallback);
  const changed = (nextMessage: string) => {
    setMessage(nextMessage);
    onChange();
  };

  const open = useMutation({
    mutationFn: () => apiPost(`/api/schemes/${schemeId}/motions/${motion.id}/open`),
    onMutate: begin,
    onSuccess: () => changed("Voting opened."),
    onError: (value) => fail(value, "Voting could not be opened."),
  });
  const close = useMutation({
    mutationFn: () => apiPost(`/api/schemes/${schemeId}/motions/${motion.id}/close`),
    onMutate: begin,
    onSuccess: () => changed("Motion closed and tallied."),
    onError: (value) => fail(value, "The motion could not be closed."),
  });
  const demandPoll = useMutation({
    mutationFn: () => apiPost(`/api/schemes/${schemeId}/motions/${motion.id}/demand-poll`),
    onMutate: begin,
    onSuccess: () => changed("Poll demanded. Entitlement will decide the motion."),
    onError: (value) => fail(value, "A poll could not be demanded."),
  });
  const vote = useMutation({
    mutationFn: (choice: "for" | "against" | "abstain") =>
      apiPost(`/api/schemes/${schemeId}/votes`, { motionId: motion.id, lotId, choice }),
    onMutate: begin,
    onSuccess: (_result, choice) => changed(`${humanise(choice)} vote recorded.`),
    onError: (value) => {
      // 409 = this lot's vote is already on the register (cast from another
      // device or session) — refetch so the card shows the recorded choice
      // instead of dead-ending on a retry that can never succeed.
      if (value instanceof ApiError && value.status === 409) {
        onChange();
        return;
      }
      fail(value, "The vote could not be recorded.");
    },
  });
  const castingVote = useMutation({
    mutationFn: (choice: "for" | "against") =>
      apiPost(`/api/schemes/${schemeId}/motions/${motion.id}/casting-vote`, { choice }),
    onMutate: begin,
    onSuccess: (_result, choice) => changed(`Chair's casting vote recorded ${choice}.`),
    onError: (value) => fail(value, "The casting vote could not be recorded."),
  });

  const result = motion.result;
  const headcount = result?.basis === "headcount";
  const hasTally = result && (result.forWeight !== undefined || result.forCount !== undefined);

  // The register decides what is offered: a lot with a vote on record never
  // gets the buttons again (the API would 409 it anyway).
  const votedByLot = new Map((motion.votes ?? []).map((v) => [v.lotId, v.choice]));
  const selectedLotVote = lotId ? votedByLot.get(lotId) : undefined;
  const allLotsVoted = lots.length > 0 && lots.every((lot) => votedByLot.has(lot.id));

  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space(3) }}>
        <View style={{ flex: 1 }}>
          <Text style={{ ...t.body, color: theme.text }}>{motion.title}</Text>
          <Text style={{ ...t.caption, color: theme.muted, marginTop: 1 }}>
            {humanise(motion.resolutionType)} resolution
          </Text>
        </View>
        <StatusPill tone={statusTone(motion.status)} label={humanise(motion.status)} />
      </View>
      <Text style={{ ...t.bodySmall, color: theme.muted, marginTop: space(3) }}>{motion.text}</Text>

      {hasTally ? (
        <View style={{ marginTop: space(3) }}>
          <Text style={{ ...t.figureSmall, color: theme.text }}>
            For {headcount ? (result.forCount ?? 0) : (result.forWeight ?? 0)} · Against{" "}
            {headcount ? (result.againstCount ?? 0) : (result.againstWeight ?? 0)} · Abstain{" "}
            {headcount ? (result.abstainCount ?? 0) : (result.abstainWeight ?? 0)}
          </Text>
          <Text style={{ ...t.caption, color: theme.muted, marginTop: space(1) }}>
            {headcount
              ? "Decided one vote per lot"
              : result.pollDemanded
                ? "Decided by entitlement after a poll demand"
                : "Decided by lot entitlement"}
          </Text>
        </View>
      ) : null}

      {canExerciseCastingVote &&
      motion.resolutionType === "ordinary" &&
      (motion.status === "carried" || motion.status === "lost") &&
      !result?.castingVote &&
      result?.forCount === result?.againstCount ? (
        <View style={{ gap: space(2), marginTop: space(4) }}>
          <Text style={{ ...t.label, color: theme.text }}>Equal vote — chair's casting vote</Text>
          {(["for", "against"] as const).map((choice) => (
            <Button
              key={choice}
              full
              variant="secondary"
              label={`Cast ${choice}`}
              onPress={() => castingVote.mutate(choice)}
              pending={castingVote.isPending && castingVote.variables === choice}
            />
          ))}
        </View>
      ) : null}

      {motion.status === "draft" ? (
        isOfficer ? (
          <View style={{ marginTop: space(4) }}>
            <Button
              full
              label="Open voting"
              onPress={() => open.mutate()}
              pending={open.isPending}
            />
          </View>
        ) : (
          <Text style={{ ...t.bodySmall, color: theme.muted, marginTop: space(3) }}>
            Voting has not opened yet.
          </Text>
        )
      ) : null}

      {motion.status === "open" ? (
        <View style={{ marginTop: space(4), gap: space(2) }}>
          {!motion.votes ? (
            // Vote state unknown — never offer buttons a lot may already have
            // used; the detail screen refetches until the register loads.
            <Text style={{ ...t.bodySmall, color: theme.muted }}>
              Couldn't check which lots have voted — voting is paused until the register loads.
            </Text>
          ) : allLotsVoted ? (
            <Text style={{ ...t.bodySmall, color: theme.muted }}>
              Every lot has voted on this motion.
            </Text>
          ) : (
            <>
              <Text style={{ ...t.label, color: theme.muted }}>Vote for a lot</Text>
              {lotsPending ? (
                <Skeleton width="65%" height={44} />
              ) : lots.length === 0 ? (
                <Text style={{ ...t.bodySmall, color: theme.muted }}>
                  No lots are available to vote.
                </Text>
              ) : (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
                  {lots.map((lot) => {
                    const voted = votedByLot.get(lot.id);
                    return (
                      <ChoiceOption
                        key={lot.id}
                        label={
                          voted ? `Lot ${lot.lotNumber} · voted ${voted}` : `Lot ${lot.lotNumber}`
                        }
                        selected={lotId === lot.id}
                        onPress={() => setLotId(lot.id)}
                        disabled={vote.isPending || !!voted}
                      />
                    );
                  })}
                </View>
              )}
              {selectedLotVote ? (
                <Text style={{ ...t.bodySmall, color: theme.muted }}>
                  This lot's {selectedLotVote} vote is on the record.
                </Text>
              ) : (
                (["for", "against", "abstain"] as const).map((choice) => (
                  <Button
                    key={choice}
                    full
                    variant="secondary"
                    label={humanise(choice)}
                    onPress={() => vote.mutate(choice)}
                    pending={vote.isPending && vote.variables === choice}
                    disabled={!lotId || vote.isPending}
                  />
                ))
              )}
            </>
          )}

          {motion.resolutionType === "ordinary" ? (
            motion.pollDemanded ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
                <StatusPill tone="info" label="Poll demanded" />
                <Text style={{ ...t.caption, color: theme.muted, flex: 1 }}>
                  This motion will be decided by lot entitlement.
                </Text>
              </View>
            ) : (
              <Button
                full
                variant="secondary"
                label="Demand a poll"
                onPress={() => demandPoll.mutate()}
                pending={demandPoll.isPending}
              />
            )
          ) : null}
          {isOfficer ? (
            <Button
              full
              variant="secondary"
              label="Close and tally"
              onPress={() => close.mutate()}
              pending={close.isPending}
            />
          ) : null}
        </View>
      ) : null}

      {error ? <InlineFeedback message={error} /> : null}
      {message ? <InlineFeedback tone="ok" message={message} /> : null}
    </Card>
  );
}

function MeetingDetailSkeleton() {
  return (
    <View style={{ gap: space(4) }}>
      <Card>
        <View style={{ gap: space(3) }}>
          <Skeleton width="45%" height={12} />
          <Skeleton width="82%" height={22} />
          <Skeleton width="68%" height={14} />
        </View>
      </Card>
      <Card>
        <View style={{ gap: space(3) }}>
          <Skeleton width="34%" height={22} />
          <Skeleton width="90%" height={14} />
        </View>
      </Card>
    </View>
  );
}
