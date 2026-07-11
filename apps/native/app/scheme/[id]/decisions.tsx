import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import * as LocalAuthentication from "expo-local-authentication";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ScrollView, Text, useWindowDimensions, View } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
  useReducedMotion,
} from "react-native-reanimated";
import type { StatusToneName } from "../../../src/components";
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
  radius,
  Screen,
  SectionHeader,
  Sheet,
  Skeleton,
  StatusPill,
  space,
  statusTone,
  type,
  useListEntering,
  useTheme,
} from "../../../src/components";
import { ApiError, api, apiPost } from "../../../src/lib/api";
import { authClient } from "../../../src/lib/auth";
import { canDecide, schemeQueryOptions, useSchemeRoles } from "../../../src/lib/roles";

// ---------------------------------------------------------------------------
// Types (shapes from the API map — GET/POST /schemes/:id/decisions…)

interface DecisionOption {
  id: string;
  label: string;
  description?: string;
}

interface Decision {
  id: string;
  schemeId: string;
  kind: string;
  title: string;
  summaryMd: string | null;
  options: DecisionOption[];
  evidence: unknown;
  subject: { type: string; id: string } | null;
  deciderRole: string | null;
  defaultOptionId: string | null;
  dueAt: string | null;
  followUp: unknown;
  status: string;
  requestedByRunId: string | null;
  decidedByUserId: string | null;
  resolution: { optionId?: string } | null;
  decisionNote: string | null;
  resolvedAt: string | null;
  remindedAt: string | null;
  createdAt: string;
  decidedByName: string | null;
}

interface VoteResponse {
  status: string;
  votesFor: number;
  votesAgainst: number;
  eligible: number;
}

interface VoteTally {
  votes: {
    userId: string;
    name: string;
    choice: Choice;
    note: string | null;
    createdAt: string;
  }[];
  votesFor: number;
  votesAgainst: number;
  eligible: number;
}

type Choice = "approve" | "decline";

type Override =
  | { kind: "resolved"; status: "approved" | "declined" }
  | { kind: "voted"; choice: Choice; votesIn: number; eligible: number };

/** The API records binary votes as approve/decline, while each decision can
 * supply human labels such as "Acknowledge" / "Flag for discussion". */
function optionLabel(decision: Decision, optionId: string | undefined): string | undefined {
  if (!optionId) return undefined;
  return decision.options.find((option) => option.id === optionId)?.label ?? humanise(optionId);
}

function choiceLabel(decision: Decision, choice: Choice): string {
  return optionLabel(decision, choice) ?? (choice === "approve" ? "Approve" : "Decline");
}

// ---------------------------------------------------------------------------
// Local helpers

/** Face ID / Touch ID gate before an on-the-record act. Devices without an
 * enrolled biometric fall through (authenticateAsync would only scold). */
async function biometricGate(label: string): Promise<boolean> {
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const enrolled = hasHardware && (await LocalAuthentication.isEnrolledAsync());
    if (!enrolled) return true;
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: `Confirm: ${label}`,
    });
    return result.success;
  } catch {
    return true;
  }
}

/** Dig integer cents out of a decision's evidence — the money involved. */
function findCents(value: unknown, depth = 0): number | null {
  if (value == null || depth > 4) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findCents(item, depth + 1);
      if (found != null) return found;
    }
    return null;
  }
  if (typeof value === "object") {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (/cents$/i.test(key) && typeof v === "number" && Number.isFinite(v)) {
        return Math.round(v);
      }
    }
    for (const v of Object.values(value as Record<string, unknown>)) {
      const found = findCents(v, depth + 1);
      if (found != null) return found;
    }
  }
  return null;
}

function decisionCents(d: Decision): number | null {
  return findCents(d.evidence) ?? findCents(d.resolution);
}

/** Full decision context without exposing markdown syntax in the native UI. */
function summaryText(md: string | null): string | undefined {
  if (!md) return undefined;
  const text = md
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/^\s*\d+[.)]\s+/gm, "• ")
    .replace(/[*_`~]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text || undefined;
}

/** Tone via the shared statusTone helper; decision-vocabulary statuses are
 * aliased to their registry equivalents rather than mapped per-screen. */
function decidedPill(status: string): { tone: StatusToneName; label: string } {
  const alias =
    status === "declined"
      ? "rejected"
      : status === "expired"
        ? "overdue"
        : status === "escalated"
          ? "pending"
          : status;
  return { tone: statusTone(alias), label: humanise(status) };
}

// ---------------------------------------------------------------------------
// Screen

export default function DecisionsScreen() {
  const { id, focus } = useLocalSearchParams<{ id: string; focus?: string }>();
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const queryClient = useQueryClient();
  const roles = useSchemeRoles(id);
  const { data: session } = authClient.useSession();

  const decisionsQuery = useQuery({
    queryKey: ["scheme", id, "decisions"],
    queryFn: () => api<{ decisions: Decision[] }>(`/api/schemes/${id}/decisions`),
    enabled: !!id,
    refetchInterval: 5000,
  });

  const schemeQuery = useQuery({ ...schemeQueryOptions(id), enabled: !!id });

  // Session-local vote results, keyed by decision id: the pill flips in place
  // and the card exits once the refetch moves it to Decided.
  const [overrides, setOverrides] = useState<Record<string, Override>>({});

  // Confirm sheet: data outlives visibility so content holds during dismiss.
  const [sheetVisible, setSheetVisible] = useState(false);
  const [sheetData, setSheetData] = useState<{ decision: Decision; choice: Choice } | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [sheetNote, setSheetNote] = useState("");
  const [resolvedDetail, setResolvedDetail] = useState<Decision | null>(null);

  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (exitTimer.current) clearTimeout(exitTimer.current);
    },
    [],
  );

  // List entrance on first successful load only.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (decisionsQuery.data && !settled) setSettled(true);
  }, [decisionsQuery.data, settled]);
  const entering = useListEntering(!settled);

  const voteMutation = useMutation({
    mutationFn: ({ decision, choice }: { decision: Decision; choice: Choice }) =>
      apiPost<VoteResponse>(`/api/schemes/${id}/decisions/${decision.id}/vote`, {
        choice,
        ...(sheetNote.trim() ? { note: sheetNote.trim() } : {}),
      }),
    onSuccess: (resp, { decision, choice }) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setSheetVisible(false);
      setSheetNote("");
      setSheetError(null);
      void queryClient.invalidateQueries({
        queryKey: ["scheme", id, "decision-votes", decision.id],
      });
      if (resp.status === "approved" || resp.status === "declined") {
        const status = resp.status;
        setOverrides((prev) => ({ ...prev, [decision.id]: { kind: "resolved", status } }));
        // Let the pill flip land, then refetch — the card exits to Decided.
        if (exitTimer.current) clearTimeout(exitTimer.current);
        exitTimer.current = setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ["scheme", id, "decisions"] });
          queryClient.invalidateQueries({ queryKey: ["scheme", id, "overview"] });
        }, 1400);
      } else {
        setOverrides((prev) => ({
          ...prev,
          [decision.id]: {
            kind: "voted",
            choice,
            votesIn: resp.votesFor + resp.votesAgainst,
            eligible: resp.eligible,
          },
        }));
        queryClient.invalidateQueries({ queryKey: ["scheme", id, "overview"] });
      }
    },
    onError: (err, { decision, choice }) => {
      // 409 = the vote/decision already exists on the register (voted from
      // another device, or resolved meanwhile). Retrying can never succeed —
      // refetch so the card shows the recorded state instead.
      if (err instanceof ApiError && err.status === 409) {
        setSheetVisible(false);
        setSheetError(null);
        void queryClient.invalidateQueries({ queryKey: ["scheme", id, "decisions"] });
        void queryClient.invalidateQueries({
          queryKey: ["scheme", id, "decision-votes", decision.id],
        });
        return;
      }
      setSheetError(`Couldn't record “${choiceLabel(decision, choice)}” — try again.`);
    },
  });

  const openConfirm = (decision: Decision, choice: Choice) => {
    setSheetData({ decision, choice });
    setSheetNote("");
    setSheetError(null);
    setSheetVisible(true);
  };

  const closeSheet = () => {
    if (voteMutation.isPending) return;
    setSheetVisible(false);
    setSheetError(null);
  };

  const confirm = async () => {
    if (!sheetData || voteMutation.isPending) return;
    setSheetError(null);
    const passed = await biometricGate(choiceLabel(sheetData.decision, sheetData.choice));
    if (!passed) return; // sheet stays, no scolding
    voteMutation.mutate(sheetData);
  };

  const decisions = decisionsQuery.data?.decisions;
  const pending = (decisions ?? []).filter((d) => d.status === "pending");
  const decided = (decisions ?? []).filter((d) => d.status !== "pending");

  const now = Date.now();

  return (
    <Screen
      title="Decisions"
      topInset={false}
      eyebrow={plate(schemeQuery.data?.scheme)}
      reserveEyebrow
      refreshing={decisionsQuery.isRefetching && !decisionsQuery.isLoading}
      onRefresh={() => decisionsQuery.refetch()}
    >
      {decisionsQuery.isLoading ? (
        <>
          <SectionHeader label="Waiting on you" />
          <PendingSkeletonCard />
          <PendingSkeletonCard />
        </>
      ) : decisionsQuery.isError && !decisions ? (
        <ErrorState
          detail="Check your connection and try again."
          onRetry={() => decisionsQuery.refetch()}
        />
      ) : (decisions ?? []).length === 0 ? (
        <EmptyState icon="checkmark-circle-outline" title="Nothing waiting on you" />
      ) : (
        <>
          <SectionHeader label="Waiting on you" />
          {pending.length === 0 ? (
            <Text style={[type.body, { color: theme.muted, paddingVertical: space(2) }]}>
              Nothing waiting on you
            </Text>
          ) : (
            pending.map((decision, index) => (
              <Animated.View
                key={decision.id}
                entering={entering(index)}
                exiting={reduceMotion ? undefined : FadeOut.duration(200)}
                layout={reduceMotion ? undefined : LinearTransition.duration(200)}
              >
                <PendingDecisionCard
                  decision={decision}
                  schemeId={id}
                  currentUserId={session?.user.id}
                  highlighted={focus === decision.id}
                  allowed={canDecide(roles, decision.deciderRole ?? "all_owners")}
                  override={overrides[decision.id]}
                  overdue={!!decision.dueAt && new Date(decision.dueAt).getTime() < now}
                  onApprove={() => openConfirm(decision, "approve")}
                  onDecline={() => openConfirm(decision, "decline")}
                />
              </Animated.View>
            ))
          )}

          {decided.length > 0 ? (
            <>
              <SectionHeader label="Decided" />
              <Animated.View
                entering={entering(Math.min(pending.length, 5))}
                layout={reduceMotion ? undefined : LinearTransition.duration(200)}
              >
                <Card padded={false}>
                  {decided.map((decision, index) => {
                    const pill = decidedPill(decision.status);
                    const when = decision.resolvedAt ?? decision.createdAt;
                    const subtitle = [
                      formatDate(when),
                      decision.decidedByName,
                      decision.decisionNote ? `“${decision.decisionNote}”` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ");
                    return (
                      <ListRow
                        key={decision.id}
                        title={decision.title}
                        highlighted={focus === decision.id}
                        subtitle={subtitle || undefined}
                        right={<StatusPill tone={pill.tone} label={pill.label} />}
                        onPress={() => setResolvedDetail(decision)}
                        accessibilityHint="Shows the recorded outcome and decision context"
                        divider={index < decided.length - 1}
                      />
                    );
                  })}
                </Card>
              </Animated.View>
            </>
          ) : null}
        </>
      )}

      <Sheet visible={sheetVisible} onClose={closeSheet}>
        {sheetData ? (
          <ConfirmSheetContent
            decision={sheetData.decision}
            choice={sheetData.choice}
            note={sheetNote}
            onNoteChange={setSheetNote}
            error={sheetError}
            pending={voteMutation.isPending}
            onConfirm={confirm}
            onCancel={closeSheet}
          />
        ) : null}
      </Sheet>
      <Sheet visible={resolvedDetail != null} onClose={() => setResolvedDetail(null)}>
        {resolvedDetail ? (
          <ResolvedDecisionDetail
            decision={resolvedDetail}
            onClose={() => setResolvedDetail(null)}
          />
        ) : null}
      </Sheet>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Pieces (local to this screen)

function PendingDecisionCard({
  schemeId,
  currentUserId,
  decision,
  override,
  overdue,
  allowed,
  highlighted,
  onApprove,
  onDecline,
}: {
  schemeId: string;
  currentUserId?: string;
  decision: Decision;
  override: Override | undefined;
  overdue: boolean;
  allowed: boolean;
  highlighted: boolean;
  onApprove: () => void;
  onDecline: () => void;
}) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const cents = decisionCents(decision);
  const summary = summaryText(decision.summaryMd);
  const approveLabel = choiceLabel(decision, "approve");
  const declineLabel = choiceLabel(decision, "decline");
  const isMultiVoter = decision.deciderRole !== "treasurer";
  const tallyQuery = useQuery({
    queryKey: ["scheme", schemeId, "decision-votes", decision.id],
    queryFn: () => api<VoteTally>(`/api/schemes/${schemeId}/decisions/${decision.id}/votes`),
    enabled: isMultiVoter,
    retry: false,
    refetchInterval: 5000,
  });
  const tally = tallyQuery.data;
  const recordedVote = tally?.votes.find((vote) => vote.userId === currentUserId);

  const pill: { tone: StatusToneName; label: string } =
    override?.kind === "resolved"
      ? override.status === "approved"
        ? { tone: statusTone("approved"), label: "Approved" }
        : { tone: statusTone("rejected"), label: "Declined" }
      : override?.kind === "voted"
        ? { tone: statusTone("pending"), label: "Vote recorded" }
        : overdue
          ? { tone: statusTone("overdue"), label: "Overdue" }
          : { tone: statusTone("pending"), label: "Waiting" };

  const raisedBy = decision.requestedByRunId ? "Raised by an agent" : "Raised";
  const meta = [
    `${raisedBy} ${formatDate(decision.createdAt)}`,
    decision.dueAt ? `due ${formatDate(decision.dueAt)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Card
      style={{
        marginBottom: space(3),
        backgroundColor: highlighted ? theme.accentSoft : theme.surface,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: space(2),
        }}
      >
        <Text style={[type.eyebrow, { color: theme.muted, flex: 1, marginRight: space(2) }]}>
          {humanise(decision.kind)}
        </Text>
        {/* Status change is a 150ms cross-fade — key remounts on flip only. */}
        <Animated.View
          key={pill.label}
          entering={override && !reduceMotion ? FadeIn.duration(150) : undefined}
        >
          <StatusPill tone={pill.tone} label={pill.label} />
        </Animated.View>
      </View>

      <Text style={[type.title, { color: theme.text }]}>{decision.title}</Text>
      {summary ? (
        <Text style={[type.bodySmall, { color: theme.muted, marginTop: space(1) }]}>{summary}</Text>
      ) : null}

      {cents != null ? (
        <View style={{ marginTop: space(3) }}>
          <Figure cents={cents} size="regular" />
        </View>
      ) : null}

      {decision.requestedByRunId ? (
        <View style={{ marginTop: space(2) }}>
          <StatusPill tone="agent" label="Raised by an agent" />
        </View>
      ) : null}
      <Text
        style={[
          type.figureSmall,
          {
            color: decision.requestedByRunId ? theme.agent : theme.muted,
            marginTop: space(2),
          },
        ]}
      >
        {meta}
      </Text>

      {override?.kind === "resolved" ? (
        <Text style={[type.bodySmall, { color: theme.muted, marginTop: space(3) }]}>
          Recorded on the scheme's register.
        </Text>
      ) : override?.kind === "voted" ? (
        <Text style={[type.bodySmall, { color: theme.muted, marginTop: space(3) }]}>
          {override.eligible > 0
            ? `Your vote is recorded · ${override.votesIn} of ${override.eligible} votes in`
            : "Your vote is recorded"}
        </Text>
      ) : recordedVote ? (
        <View style={{ gap: space(1), marginTop: space(3) }}>
          <Text style={[type.bodySmall, { color: theme.text }]}>
            You voted {choiceLabel(decision, recordedVote.choice)}. Your vote is recorded while the
            remaining eligible voters decide.
          </Text>
          {recordedVote.note ? (
            <Text style={[type.bodySmall, { color: theme.muted, fontStyle: "italic" }]}>
              “{recordedVote.note}”
            </Text>
          ) : null}
        </View>
      ) : allowed && (!isMultiVoter || (!!currentUserId && !!tally)) ? (
        // Multi-voter tiers only offer the buttons once the server tally has
        // confirmed there's no recorded vote — an errored check must never
        // re-offer an action the user may already have taken.
        <View style={{ flexDirection: "row", gap: space(3), marginTop: space(4) }}>
          <View style={{ flex: 1 }}>
            <Button variant="secondary" label={declineLabel} full onPress={onDecline} />
          </View>
          <View style={{ flex: 1 }}>
            <Button variant="primary" label={approveLabel} full onPress={onApprove} />
          </View>
        </View>
      ) : (
        <Text style={[type.bodySmall, { color: theme.muted, marginTop: space(3) }]}>
          {allowed && isMultiVoter
            ? tallyQuery.isError
              ? "Couldn't check your recorded vote — retrying…"
              : "Checking your recorded vote…"
            : `This decision is assigned to ${humanise(decision.deciderRole ?? "the committee")}.`}
        </Text>
      )}
      {isMultiVoter && tally ? <VoteTallyPanel decision={decision} tally={tally} /> : null}
    </Card>
  );
}

function VoteTallyPanel({ decision, tally }: { decision: Decision; tally: VoteTally }) {
  const theme = useTheme();
  const approveLabel = choiceLabel(decision, "approve");
  const declineLabel = choiceLabel(decision, "decline");
  const needed = Math.floor(tally.eligible / 2) + 1;
  const progress = Math.min(1, tally.votesFor / Math.max(1, needed));
  return (
    <View
      style={{
        gap: space(2),
        marginTop: space(4),
        paddingTop: space(3),
        borderTopWidth: 1,
        borderTopColor: theme.line,
      }}
    >
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space(2) }}>
        <StatusPill tone="ok" label={`${approveLabel}: ${tally.votesFor}`} />
        {tally.votesAgainst > 0 ? (
          <StatusPill tone="crit" label={`${declineLabel}: ${tally.votesAgainst}`} />
        ) : null}
        <Text style={{ ...type.caption, color: theme.muted }}>
          {needed} needed · {tally.eligible} eligible
        </Text>
      </View>
      <View
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: needed, now: tally.votesFor }}
        style={{
          height: 5,
          borderRadius: radius.pill,
          backgroundColor: theme.line,
          overflow: "hidden",
        }}
      >
        <View style={{ width: `${progress * 100}%`, height: "100%", backgroundColor: theme.ok }} />
      </View>
      {tally.votes.map((vote) => (
        <View key={vote.userId} style={{ gap: 2 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
            <Text style={{ ...type.bodySmall, color: theme.text, flex: 1 }}>{vote.name}</Text>
            <StatusPill
              tone={vote.choice === "approve" ? "ok" : "crit"}
              label={choiceLabel(decision, vote.choice)}
            />
          </View>
          {vote.note ? (
            <Text style={{ ...type.caption, color: theme.muted, fontStyle: "italic" }}>
              {vote.note}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function ResolvedDecisionDetail({
  decision,
  onClose,
}: {
  decision: Decision;
  onClose: () => void;
}) {
  const theme = useTheme();
  const { height } = useWindowDimensions();
  const pill = decidedPill(decision.status);
  const chosen = optionLabel(decision, decision.resolution?.optionId);
  const summary = summaryText(decision.summaryMd);
  const resolvedAt = decision.resolvedAt
    ? new Date(decision.resolvedAt).toLocaleString("en-AU", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  return (
    <ScrollView
      style={{ maxHeight: height * 0.78 }}
      contentContainerStyle={{ gap: space(3) }}
      showsVerticalScrollIndicator={false}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
        <Text style={[type.eyebrow, { color: theme.muted, flex: 1 }]}>
          {humanise(decision.kind)}
        </Text>
        <StatusPill tone={pill.tone} label={pill.label} />
      </View>
      <Text style={[type.title, { color: theme.text }]}>{decision.title}</Text>

      <View
        style={{
          gap: space(2),
          paddingVertical: space(3),
          borderTopWidth: 1,
          borderBottomWidth: 1,
          borderColor: theme.line,
        }}
      >
        {chosen ? (
          <Text style={[type.body, { color: theme.text }]}>Recorded outcome: {chosen}</Text>
        ) : null}
        {decision.decidedByName ? (
          <Text style={[type.bodySmall, { color: theme.muted }]}>By {decision.decidedByName}</Text>
        ) : null}
        {resolvedAt ? (
          <Text style={[type.bodySmall, { color: theme.muted }]}>On {resolvedAt}</Text>
        ) : null}
        {decision.decisionNote ? (
          <Text style={[type.bodySmall, { color: theme.muted, fontStyle: "italic" }]}>
            “{decision.decisionNote}”
          </Text>
        ) : null}
      </View>

      {summary ? (
        <View style={{ gap: space(1) }}>
          <Text style={[type.eyebrow, { color: theme.muted }]}>Decision context</Text>
          <Text style={[type.bodySmall, { color: theme.text }]}>{summary}</Text>
        </View>
      ) : null}

      <View style={{ marginTop: space(2) }}>
        <Button variant="secondary" label="Done" full onPress={onClose} />
      </View>
    </ScrollView>
  );
}

function ConfirmSheetContent({
  decision,
  choice,
  note,
  onNoteChange,
  error,
  pending,
  onConfirm,
  onCancel,
}: {
  decision: Decision;
  choice: Choice;
  note: string;
  onNoteChange: (value: string) => void;
  error: string | null;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const cents = decisionCents(decision);
  const approve = choice === "approve";
  const label = choiceLabel(decision, choice);

  return (
    <View>
      <Text style={[type.eyebrow, { color: theme.muted, marginBottom: space(2) }]}>{label}</Text>
      <Text style={[type.title, { color: theme.text }]}>{decision.title}</Text>

      {cents != null ? (
        // The moment of consent — the number is the biggest thing on screen.
        <View style={{ marginTop: space(4) }}>
          <Figure cents={cents} size="hero" />
        </View>
      ) : null}

      <Text style={[type.bodySmall, { color: theme.muted, marginTop: space(3) }]}>
        This will be recorded on the scheme's register.
      </Text>

      <View style={{ marginTop: space(4) }}>
        <FormField
          label="Note for the record (optional)"
          placeholder="Why you decided this way"
          value={note}
          onChangeText={onNoteChange}
          multiline
          maxLength={2000}
          editable={!pending}
        />
      </View>

      {error ? (
        <Text style={[type.bodySmall, { color: theme.crit, marginTop: space(3) }]}>{error}</Text>
      ) : null}

      <View style={{ marginTop: space(5) }}>
        <Button
          variant={approve ? "primary" : "destructive"}
          label={label}
          full
          pending={pending}
          onPress={onConfirm}
        />
      </View>

      <PressableScale
        onPress={onCancel}
        disabled={pending}
        accessibilityRole="button"
        accessibilityLabel="Cancel"
        style={{
          height: 44,
          alignItems: "center",
          justifyContent: "center",
          marginTop: space(2),
        }}
      >
        <Text style={{ fontFamily: type.label.fontFamily, fontSize: 15, color: theme.accent }}>
          Cancel
        </Text>
      </PressableScale>
    </View>
  );
}

function PendingSkeletonCard() {
  return (
    <Card style={{ marginBottom: space(3) }}>
      <Skeleton width="35%" height={12} />
      <View style={{ height: space(3) }} />
      <Skeleton width="75%" height={20} />
      <View style={{ height: space(2) }} />
      <Skeleton width="90%" height={14} />
      <View style={{ height: space(3) }} />
      <Skeleton width="45%" height={26} />
      <View style={{ flexDirection: "row", gap: space(3), marginTop: space(4) }}>
        <View style={{ flex: 1 }}>
          <Skeleton height={50} radius={radius.control} />
        </View>
        <View style={{ flex: 1 }}>
          <Skeleton height={50} radius={radius.control} />
        </View>
      </View>
    </Card>
  );
}
