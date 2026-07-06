import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import * as LocalAuthentication from "expo-local-authentication";
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
  useReducedMotion,
} from "react-native-reanimated";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Figure,
  ListRow,
  PressableScale,
  Screen,
  SectionHeader,
  Sheet,
  Skeleton,
  StatusPill,
  statusTone,
  formatDate,
  humanise,
  plate,
  radius,
  space,
  type,
  useListEntering,
  useTheme,
} from "../../../src/components";
import type { StatusToneName } from "../../../src/components";
import { api, apiPost } from "../../../src/lib/api";
import { schemeQueryOptions } from "../../../src/lib/roles";

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
  resolution: unknown;
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

type Choice = "approve" | "decline";

type Override =
  | { kind: "resolved"; status: "approved" | "declined" }
  | { kind: "voted"; choice: Choice; votesIn: number; eligible: number };

// ---------------------------------------------------------------------------
// Local helpers

/** Face ID / Touch ID gate before an on-the-record act. Devices without an
 * enrolled biometric fall through (authenticateAsync would only scold). */
async function biometricGate(choice: Choice): Promise<boolean> {
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const enrolled = hasHardware && (await LocalAuthentication.isEnrolledAsync());
    if (!enrolled) return true;
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: choice === "approve" ? "Confirm approval" : "Confirm decline",
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

/** First non-empty line of the markdown summary, plain-text. */
function summaryLine(md: string | null): string | undefined {
  if (!md) return undefined;
  const line = md
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return undefined;
  return (
    line
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[#*_`>]/g, "")
      .trim() || undefined
  );
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
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const queryClient = useQueryClient();

  const decisionsQuery = useQuery({
    queryKey: ["scheme", id, "decisions"],
    queryFn: () => api<{ decisions: Decision[] }>(`/api/schemes/${id}/decisions`),
    enabled: !!id,
  });

  const schemeQuery = useQuery({ ...schemeQueryOptions(id), enabled: !!id });

  // Session-local vote results, keyed by decision id: the pill flips in place
  // and the card exits once the refetch moves it to Decided.
  const [overrides, setOverrides] = useState<Record<string, Override>>({});

  // Confirm sheet: data outlives visibility so content holds during dismiss.
  const [sheetVisible, setSheetVisible] = useState(false);
  const [sheetData, setSheetData] = useState<{ decision: Decision; choice: Choice } | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);

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
      apiPost<VoteResponse>(`/api/schemes/${id}/decisions/${decision.id}/vote`, { choice }),
    onSuccess: (resp, { decision, choice }) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setSheetVisible(false);
      setSheetError(null);
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
    onError: (_err, { choice }) => {
      setSheetError(
        choice === "approve"
          ? "Couldn't record your approval — try again."
          : "Couldn't record your decline — try again.",
      );
    },
  });

  const openConfirm = (decision: Decision, choice: Choice) => {
    setSheetData({ decision, choice });
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
    const passed = await biometricGate(sheetData.choice);
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
                  override={overrides[decision.id]}
                  overdue={
                    !!decision.dueAt && new Date(decision.dueAt).getTime() < now
                  }
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
                    const subtitle = [formatDate(when), decision.decidedByName]
                      .filter(Boolean)
                      .join(" · ");
                    return (
                      <ListRow
                        key={decision.id}
                        title={decision.title}
                        subtitle={subtitle || undefined}
                        right={<StatusPill tone={pill.tone} label={pill.label} />}
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
            error={sheetError}
            pending={voteMutation.isPending}
            onConfirm={confirm}
            onCancel={closeSheet}
          />
        ) : null}
      </Sheet>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Pieces (local to this screen)

function PendingDecisionCard({
  decision,
  override,
  overdue,
  onApprove,
  onDecline,
}: {
  decision: Decision;
  override: Override | undefined;
  overdue: boolean;
  onApprove: () => void;
  onDecline: () => void;
}) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const cents = decisionCents(decision);
  const summary = summaryLine(decision.summaryMd);

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
    <Card style={{ marginBottom: space(3) }}>
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
        <Text
          numberOfLines={2}
          style={[type.bodySmall, { color: theme.muted, marginTop: space(1) }]}
        >
          {summary}
        </Text>
      ) : null}

      {cents != null ? (
        <View style={{ marginTop: space(3) }}>
          <Figure cents={cents} size="regular" />
        </View>
      ) : null}

      <Text style={[type.figureSmall, { color: theme.muted, marginTop: space(2) }]}>{meta}</Text>

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
      ) : (
        <View style={{ flexDirection: "row", gap: space(3), marginTop: space(4) }}>
          <View style={{ flex: 1 }}>
            <Button variant="secondary" label="Decline" full onPress={onDecline} />
          </View>
          <View style={{ flex: 1 }}>
            <Button variant="primary" label="Approve" full onPress={onApprove} />
          </View>
        </View>
      )}
    </Card>
  );
}

function ConfirmSheetContent({
  decision,
  choice,
  error,
  pending,
  onConfirm,
  onCancel,
}: {
  decision: Decision;
  choice: Choice;
  error: string | null;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const cents = decisionCents(decision);
  const approve = choice === "approve";

  return (
    <View>
      <Text style={[type.eyebrow, { color: theme.muted, marginBottom: space(2) }]}>
        {approve ? "Approve decision" : "Decline decision"}
      </Text>
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

      {error ? (
        <Text style={[type.bodySmall, { color: theme.crit, marginTop: space(3) }]}>
          {error}
        </Text>
      ) : null}

      <View style={{ marginTop: space(5) }}>
        <Button
          variant={approve ? "primary" : "destructive"}
          label={approve ? "Approve" : "Decline"}
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
