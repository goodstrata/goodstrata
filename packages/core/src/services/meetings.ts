import {
  agendaItems,
  type DbHandle,
  documents,
  lotLedgerEntries,
  lots,
  meetingAttendance,
  meetings,
  motions,
  ownerships,
  payments,
  people,
  proxies,
  schemes,
  votes,
} from "@goodstrata/db";
import { publishEvent } from "@goodstrata/events";
import {
  addDays,
  addMonthsDateOnly,
  CHAIR_NOTE_KINDS,
  type ChairLogEntry,
  daysBetween,
  formatCents,
  toDateOnly,
  type VoteChoice,
} from "@goodstrata/shared";
import { and, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { causationFields, type ServiceContext } from "../context.js";
import {
  type EmailBlock,
  emailBrand,
  infoNote,
  keyValueTable,
  paragraph,
  renderEmail,
} from "../email/index.js";
import {
  type CastVote,
  lotMayVote,
  type MotionTally,
  quorumMet,
  tallyMotion,
} from "../engines/voting.js";
import { DomainError, notFound } from "../errors.js";
import { arrearsForScheme, lotStatement } from "./arrears.js";
import { listBudgets } from "./budgets.js";
import { sendEmail } from "./comms.js";
import { uploadDocument } from "./documents.js";
import { generateS159Report } from "./grievances.js";

// ---------------------------------------------------------------------------
// Statutory constants (Owners Corporations Act 2006 (Vic), authorised
// consolidation v023 — see docs/legal/statute-map.md §5). Part 4 Div 6 was
// substituted by No. 4/2021 s 42: the former ss 91–94 are REPEALED; the
// current provisions are ss 72, 76–78, 85–89H, 95–97.
// ---------------------------------------------------------------------------

const GM_NOTICE_DAYS = 14; // ss 72(1)/76(1): ≥14 days' notice for a general meeting
const BALLOT_NOTICE_DAYS = 14; // s 85(1): 14 days' written notice of a ballot (circular resolution)
const INTERIM_RIPEN_DAYS = 29; // ss 78(4)/97(5): an interim resolution ripens after 29 days absent a challenge/petition
const CLEARED_FUNDS_BUSINESS_DAYS = 4; // s 89B(3)(b): a non-cash payment counts only if made ≥4 business days out
const PROXY_LAPSE_MONTHS = 12; // s 89C(6): a proxy authorisation lapses 12 months after it is given
const PROXY_CAP_SMALL_SCHEME_LOTS = 20; // s 89D(1)(a): ≤20 occupiable lots → 1 proxy
const PROXY_CAP_LARGE_SCHEME_FRACTION = 0.05; // s 89D(1)(b): >20 lots → 5% of lot owners

/**
 * The service-level overlay stored alongside the engine tally in `motions.result`
 * (jsonb). Kept here rather than in dedicated columns to avoid a schema
 * migration; the fields are governance-critical and each is anchored to a cited
 * section below.
 */
interface MotionResult extends Partial<MotionTally> {
  /** s 89C(7): captured at addMotion — a non-owner proxy may not vote on it. */
  managerAppointment?: boolean;
  /** ss 78/97: a provisional resolution awaiting ripening. */
  interim?: boolean;
  interimKind?: "interim_ordinary" | "interim_special" | null;
  /** ss 78(4)/97(5): ISO instant this interim resolution ripens into a final one. */
  ripensOn?: string | null;
  /** Set when challenged (s 78) or petitioned (s 97(5)) before ripening. */
  challengedAt?: string | null;
  /** Set when an interim resolution ripened into a final one. */
  ripenedAt?: string | null;
  /** s 77 quorum at close, for a general-meeting motion (null otherwise). */
  quorate?: boolean | null;
  /** s 86(2)(a): a circular ordinary ballot fell below the returned-votes floor. */
  belowQuorumFloor?: boolean;
  /**
   * ISO instant the AI chair proposed closing this motion (ready-to-close
   * flag). The proposal is advisory: only a human officer's closeMotion call
   * runs the binding tally. Preserved through resolveMotion for the audit
   * trail.
   */
  closeProposedAt?: string | null;
}

/**
 * The instant `n` business days before `from` (weekends skipped). Victorian
 * public holidays are NOT modelled — a documented approximation of the s 89B(3)
 * "4 business days" cutoff; counsel/product may refine it with a holiday table.
 */
function businessDaysBefore(from: Date, n: number): Date {
  const d = new Date(from.getTime());
  let remaining = n;
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() - 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) remaining -= 1;
  }
  return d;
}

/**
 * s 89B(3): sum (as positive owing) of a lot's payments not yet CLEARED for
 * voting at `at`. A payment counts toward clearing arrears only if made "(a) in
 * cash; or (b) otherwise, not less than 4 business days before" voting. The
 * platform has no cash rail, so every recorded payment is treated as non-cash
 * and must clear the 4-business-day window — this is the fix for the statute-map
 * §5.3 gap where a same-day electronic payment immediately re-enfranchised. If a
 * cash-receipt method is added, the s 89B(3)(a) immediate-clear path applies.
 */
async function unclearedPaymentCents(
  ctx: ServiceContext,
  schemeId: string,
  lotId: string,
  at: Date,
): Promise<number> {
  const cutoff = businessDaysBefore(at, CLEARED_FUNDS_BUSINESS_DAYS);
  const rows = await ctx.db
    .select({ amountCents: lotLedgerEntries.amountCents, paidAt: payments.paidAt })
    .from(lotLedgerEntries)
    .innerJoin(payments, eq(lotLedgerEntries.paymentId, payments.id))
    .where(
      and(
        eq(lotLedgerEntries.schemeId, schemeId),
        eq(lotLedgerEntries.lotId, lotId),
        eq(lotLedgerEntries.kind, "payment"),
      ),
    );
  let uncleared = 0;
  for (const r of rows) {
    // Payment ledger entries are negative; count only those made too recently.
    if (r.paidAt.getTime() > cutoff.getTime()) uncleared += -Number(r.amountCents);
  }
  return uncleared;
}

/**
 * s 89B(1)/(3): is `lotId` barred from voting at `at` by unpaid or uncleared
 * arrears? Barred if it owes counting every payment, OR if it only looks clear
 * because of a payment that has not yet cleared the s 89B(3) window.
 */
async function lotBarredByArrears(
  ctx: ServiceContext,
  schemeId: string,
  lotId: string,
  at: Date,
): Promise<boolean> {
  const arrears = await arrearsForScheme(ctx, schemeId);
  if (arrears.some((a) => a.lotId === lotId)) return true;
  const uncleared = await unclearedPaymentCents(ctx, schemeId, lotId, at);
  if (uncleared <= 0) return false;
  const { balanceCents } = await lotStatement(ctx, schemeId, lotId);
  // Disregarding the uncleared payment, does the lot still owe?
  return balanceCents + uncleared > 0;
}

/**
 * s 89C(10): is `personId` — as a lot owner — themselves in arrears, and so
 * barred from voting AS PROXY for another lot? (No special/unanimous carve-out:
 * the bar is on the proxy-holder, not the motion.)
 */
async function personInArrears(
  ctx: ServiceContext,
  schemeId: string,
  personId: string,
  at: Date,
): Promise<boolean> {
  const owned = await ctx.db.query.ownerships.findMany({
    where: and(
      eq(ownerships.schemeId, schemeId),
      eq(ownerships.personId, personId),
      isNull(ownerships.endedOn),
    ),
  });
  for (const o of owned) {
    if (await lotBarredByArrears(ctx, schemeId, o.lotId, at)) return true;
  }
  return false;
}

/**
 * s 97: a special resolution short of the s 96 75% threshold still becomes an
 * INTERIM special resolution if either (1) ≥50% of the total entitlement voted
 * in favour and ≤25% against; or (1A, inserted 2021) the meeting was quorate and
 * there were zero votes against. Entitlement basis, consistent with the engine's
 * s 96 limb (a); the limb (b) meeting-vote basis is the open counsel question in
 * statute-map §5.3.
 */
function qualifiesInterimSpecial(tally: MotionTally, quorate: boolean): boolean {
  if (tally.forWeight <= 0) return false;
  const majorityInFavour = tally.forWeight * 2 >= tally.totalEntitlement; // ≥50%
  const limitedAgainst = tally.againstWeight * 4 <= tally.totalEntitlement; // ≤25%
  if (majorityInFavour && limitedAgainst) return true; // s 97(1)
  if (quorate && tally.againstWeight === 0) return true; // s 97(1A)
  return false;
}

/**
 * s 77 quorum for a general (AGM/SGM) meeting — the trigger for the ss 78/97
 * interim-resolution machinery. Returns null for committee meetings (own quorum
 * rules, out of scope) and circular motions, where interim resolutions never
 * apply.
 */
async function generalMeetingQuorate(
  ctx: ServiceContext,
  schemeId: string,
  meetingId: string | null,
): Promise<boolean | null> {
  if (!meetingId) return null;
  const meeting = await ctx.db.query.meetings.findFirst({
    where: and(eq(meetings.id, meetingId), eq(meetings.schemeId, schemeId)),
  });
  if (!meeting || (meeting.kind !== "agm" && meeting.kind !== "sgm")) return null;
  const q = await quorumStatus(ctx, schemeId, meetingId);
  return q.quorate;
}

// ---------------------------------------------------------------------------
// Meetings + notice
// ---------------------------------------------------------------------------

export const createMeetingInput = z.object({
  kind: z.enum(["agm", "sgm", "committee"]),
  title: z.string().min(3).max(200),
  scheduledAt: z.string().datetime(),
  location: z.string().max(300).optional(),
  agenda: z.array(z.object({ title: z.string().min(1), body: z.string().optional() })).default([]),
});
export type CreateMeetingInput = z.infer<typeof createMeetingInput>;

export async function createMeeting(
  ctx: ServiceContext,
  schemeId: string,
  input: CreateMeetingInput,
) {
  return await ctx.db.transaction(async (tx) => {
    const rows = await tx
      .insert(meetings)
      .values({
        schemeId,
        kind: input.kind,
        title: input.title,
        scheduledAt: new Date(input.scheduledAt),
        location: input.location ?? null,
        status: "draft",
      })
      .returning();
    const meeting = rows[0]!;

    if (input.agenda.length > 0) {
      await tx.insert(agendaItems).values(
        input.agenda.map((item, i) => ({
          meetingId: meeting.id,
          order: i + 1,
          title: item.title,
          body: item.body ?? null,
        })),
      );
    }

    await publishEvent(tx, {
      schemeId,
      stream: `meeting:${meeting.id}`,
      type: "meeting.scheduled",
      payload: {
        meetingId: meeting.id,
        kind: meeting.kind,
        title: meeting.title,
        scheduledAt: meeting.scheduledAt.toISOString(),
      },
      actor: ctx.actor,
      ...causationFields(ctx),
    });

    return meeting;
  });
}

/**
 * Send the statutory meeting notice to every owner. ss 72(1)/76(1): a general
 * meeting needs at least 14 days' written notice. s 72(2): an AGM notice must
 * also carry the substantive papers (financial statements, proposed budget,
 * the text of any special/unanimous resolution, the s 159 grievance report and
 * the previous AGM minutes) — assembled in `generalMeetingNoticeBlocks`.
 */
export async function sendMeetingNotice(ctx: ServiceContext, schemeId: string, meetingId: string) {
  const meeting = await ctx.db.query.meetings.findFirst({
    where: and(eq(meetings.id, meetingId), eq(meetings.schemeId, schemeId)),
  });
  if (!meeting) throw notFound("Meeting");
  if (meeting.status !== "draft") {
    throw new DomainError("NOTICE_SENT", "Notice has already been sent", 409);
  }
  if (meeting.kind !== "committee") {
    const days = daysBetween(ctx.clock.now(), meeting.scheduledAt);
    if (days < GM_NOTICE_DAYS) {
      throw new DomainError(
        "NOTICE_TOO_LATE",
        `General meetings need at least ${GM_NOTICE_DAYS} days' notice (meeting is in ${days})`,
        422,
      );
    }
  }

  const scheme = await ctx.db.query.schemes.findFirst({ where: eq(schemes.id, schemeId) });
  const agenda = await ctx.db.query.agendaItems.findMany({
    where: eq(agendaItems.meetingId, meetingId),
    orderBy: (t, { asc }) => asc(t.order),
  });
  const owners = await ctx.db
    .selectDistinctOn([people.id], {
      personId: people.id,
      email: people.email,
      givenName: people.givenName,
    })
    .from(ownerships)
    .innerJoin(people, eq(ownerships.personId, people.id))
    .where(and(eq(ownerships.schemeId, schemeId), isNull(ownerships.endedOn)))
    .orderBy(people.id);
  const reachable = owners.filter((o) => o.email);

  await ctx.db.transaction(async (tx) => {
    // Compare-and-set: the draft check above ran outside this transaction, so
    // two concurrent sends could both pass it. Only the invocation that wins
    // the draft→notice_sent flip proceeds to email the owners; the loser rolls
    // back instead of duplicating the statutory notice blast.
    const updated = await tx
      .update(meetings)
      .set({ status: "notice_sent", noticeSentAt: ctx.clock.now() })
      .where(and(eq(meetings.id, meetingId), eq(meetings.status, "draft")))
      .returning({ id: meetings.id });
    if (updated.length === 0) {
      throw new DomainError("NOTICE_SENT", "Notice has already been sent", 409);
    }
    await publishEvent(tx, {
      schemeId,
      stream: `meeting:${meetingId}`,
      type: "meeting.notice.issued",
      payload: { meetingId, recipients: reachable.length },
      actor: ctx.actor,
      ...causationFields(ctx),
    });
  });

  const when = meeting.scheduledAt.toLocaleString("en-AU", { timeZone: "Australia/Melbourne" });
  const meetingUrl = `${emailBrand.urls.app}/schemes/${schemeId}?section=meetings&meeting=${meetingId}`;
  const detailRows = [{ label: "When", value: when }];
  if (meeting.location) detailRows.push({ label: "Where", value: meeting.location });
  const agendaText =
    agenda.length > 0
      ? agenda.map((a) => `${a.order}. ${a.title}`).join("\n")
      : "The agenda will be tabled at the meeting.";

  // s 72(2): general-meeting notices carry the substantive papers; committee
  // notices stay agenda-only. Assembled once and reused for every recipient.
  const statutoryBlocks =
    meeting.kind === "committee" ? [] : await generalMeetingNoticeBlocks(ctx, schemeId, meeting);

  for (const owner of reachable) {
    const { html, text } = renderEmail({
      preheader: `Notice of ${meeting.title} for ${scheme?.name} — ${when}.`,
      heading: `Notice of ${meeting.kind === "committee" ? "committee meeting" : meeting.kind.toUpperCase()}`,
      intro: `Dear ${owner.givenName ?? "Owner"}, notice is given of the following meeting of ${scheme?.name}.`,
      blocks: [
        paragraph(meeting.title),
        keyValueTable(detailRows, "Meeting details"),
        paragraph(`Agenda\n${agendaText}`),
        ...statutoryBlocks,
        infoNote(
          "You may vote in person, online, or appoint a proxy via the portal before the meeting. A proxy appointment lapses 12 months after it is given (s 89C(6)).",
        ),
      ],
      cta: { label: "View meeting & agenda", url: meetingUrl },
    });

    await sendEmail(ctx, {
      schemeId,
      personId: owner.personId,
      to: owner.email!,
      subject: `Notice of ${meeting.kind.toUpperCase()}: ${meeting.title} — ${scheme?.name}`,
      template: "meeting_notice",
      related: { type: "meeting", id: meetingId },
      body: text,
      html,
    });
  }

  return { recipients: reachable.length };
}

/**
 * s 72(2) AGM / s 76 SGM notice content, beyond the agenda + proxy statement.
 * Best-effort: a required item with no data yet is shown as "to be tabled"
 * rather than silently dropped. The s 159 report is de-identified by its
 * generator (s 159(2)); this only summarises its counts.
 */
async function generalMeetingNoticeBlocks(
  ctx: ServiceContext,
  schemeId: string,
  meeting: typeof meetings.$inferSelect,
): Promise<EmailBlock[]> {
  const blocks: EmailBlock[] = [];

  // s 72(2)/s 76: the text of any special or unanimous resolution to be moved.
  const special = await ctx.db.query.motions.findMany({
    where: and(
      eq(motions.schemeId, schemeId),
      eq(motions.meetingId, meeting.id),
      inArray(motions.resolutionType, ["special", "unanimous"]),
    ),
    orderBy: (t, { asc }) => asc(t.createdAt),
  });
  if (special.length > 0) {
    const text = special.map((m) => `• (${m.resolutionType}) ${m.title}: ${m.text}`).join("\n");
    blocks.push(paragraph(`Special/unanimous resolutions to be moved\n${text}`));
  }

  // The remaining s 72(2) papers are AGM-specific; s 76 SGM notices stop here.
  if (meeting.kind !== "agm") return blocks;

  // s 72(2): the proposed annual budget.
  const budgets = await listBudgets(ctx, schemeId);
  const latest = budgets[0]; // listBudgets orders by fiscalYearStart desc
  if (latest && latest.lines.length > 0) {
    const rows = latest.lines.map((l) => ({
      label: `${l.fundKind} — ${l.category}`,
      value: formatCents(l.amountCents),
    }));
    rows.push({
      label: "Total",
      value: formatCents(latest.lines.reduce((a, l) => a + l.amountCents, 0)),
    });
    blocks.push(keyValueTable(rows, `Proposed annual budget (FY ${latest.fiscalYearStart})`));
  } else {
    blocks.push(infoNote("Proposed annual budget: to be tabled at the meeting."));
  }

  // s 72(2): the s 159 grievance report (both parties de-identified by the generator).
  const s159 = await generateS159Report(ctx, schemeId);
  blocks.push(
    keyValueTable(
      [
        { label: "Complaints (total)", value: String(s159.complaints.total) },
        { label: "Resolved", value: String(s159.complaints.resolved) },
        { label: "Unresolved", value: String(s159.complaints.unresolved) },
        { label: "Breach notices", value: String(s159.breachNotices.total) },
      ],
      "Grievance report (s 159)",
    ),
  );

  // s 72(2): financial statements + the previous AGM minutes — referenced (the
  // documents themselves live behind the portal's access-tiered viewer).
  const priorAgms = await ctx.db.query.meetings.findMany({
    where: and(eq(meetings.schemeId, schemeId), eq(meetings.kind, "agm")),
    orderBy: (t, { desc }) => desc(t.scheduledAt),
  });
  const priorWithMinutes = priorAgms.find(
    (m) => m.id !== meeting.id && m.scheduledAt < meeting.scheduledAt && m.minutesDocumentId,
  );
  blocks.push(
    infoNote(
      `Financial statements are available in the portal for review. ${
        priorWithMinutes
          ? "The previous AGM minutes are attached in the portal."
          : "No previous AGM minutes are on file."
      }`,
    ),
  );

  return blocks;
}

// ---------------------------------------------------------------------------
// Video meetings (Daily.co in production; console provider offline)
// ---------------------------------------------------------------------------

/** Statuses in/after which a meeting is over (minutes drafted or distributed). */
const ENDED_MEETING_STATUSES = ["closed", "minutes_draft", "minutes_distributed"] as const;

function meetingEnded(status: (typeof meetings.$inferSelect)["status"]): boolean {
  return (ENDED_MEETING_STATUSES as readonly string[]).includes(status);
}

const VIDEO_ROOM_EXPIRES_MINUTES = 4 * 60;

/** Deterministic room name so join can re-derive it without extra state. */
export function videoRoomName(meetingId: string): string {
  return `gs-${meetingId.slice(0, 8)}`;
}

/**
 * Create the video room for a committee meeting or AGM. Idempotent: if a room
 * already exists, its URL is returned unchanged.
 */
export async function startVideoMeeting(ctx: ServiceContext, schemeId: string, meetingId: string) {
  const meeting = await ctx.db.query.meetings.findFirst({
    where: and(eq(meetings.id, meetingId), eq(meetings.schemeId, schemeId)),
  });
  if (!meeting) throw notFound("Meeting");
  if (meeting.kind !== "committee" && meeting.kind !== "agm") {
    throw new DomainError(
      "VIDEO_UNSUPPORTED",
      "Video rooms are only available for committee meetings and AGMs",
      422,
    );
  }
  if (meetingEnded(meeting.status)) {
    throw new DomainError("ALREADY_CLOSED", "Meeting is already closed", 409);
  }
  if (meeting.videoUrl) return { url: meeting.videoUrl };

  const room = await ctx.integrations.video.createRoom({
    name: videoRoomName(meetingId),
    expiresMinutes: VIDEO_ROOM_EXPIRES_MINUTES,
  });

  // Best-effort live transcription (optional provider capability; may be
  // unavailable on the plan). Failure never blocks the meeting.
  let transcriptionStarted = false;
  if (ctx.integrations.video.startTranscription) {
    try {
      const started = await ctx.integrations.video.startTranscription(room.roomName);
      transcriptionStarted = started.ok;
    } catch {
      transcriptionStarted = false;
    }
  }

  await ctx.db.transaction(async (tx) => {
    await tx
      .update(meetings)
      .set({
        videoUrl: room.url,
        transcriptionStarted,
        ...(meeting.status === "notice_sent" ? { status: "in_progress" as const } : {}),
      })
      .where(eq(meetings.id, meetingId));
    await publishEvent(tx, {
      schemeId,
      stream: `meeting:${meetingId}`,
      type: "meeting.video.started",
      payload: { meetingId, url: room.url },
      actor: ctx.actor,
      ...causationFields(ctx),
    });
  });

  return { url: room.url };
}

/** Mint a join token for the meeting's video room. */
export async function joinVideoMeeting(
  ctx: ServiceContext,
  schemeId: string,
  meetingId: string,
  userName: string,
  isOwner = false,
) {
  const meeting = await ctx.db.query.meetings.findFirst({
    where: and(eq(meetings.id, meetingId), eq(meetings.schemeId, schemeId)),
  });
  if (!meeting) throw notFound("Meeting");
  if (!meeting.videoUrl) {
    throw new DomainError("VIDEO_NOT_STARTED", "Video has not been started for this meeting", 409);
  }

  const { token } = await ctx.integrations.video.createMeetingToken({
    roomName: videoRoomName(meetingId),
    userName,
    isOwner,
  });
  return { url: meeting.videoUrl, token };
}

// ---------------------------------------------------------------------------
// AI chair: chair log + conductor ticks
// ---------------------------------------------------------------------------

export const chairNoteInput = z.object({
  kind: z.enum(CHAIR_NOTE_KINDS),
  note: z.string().min(1).max(2000),
});
export type ChairNoteInput = z.infer<typeof chairNoteInput>;

/**
 * Record a note from the AI chair: append it to the meeting's chair_log and
 * publish meeting.chair.note in one transaction, then (after commit,
 * best-effort) surface it in the video room's chat.
 */
export async function chairNote(
  ctx: ServiceContext,
  schemeId: string,
  meetingId: string,
  input: ChairNoteInput,
): Promise<ChairLogEntry> {
  const meeting = await ctx.db.query.meetings.findFirst({
    where: and(eq(meetings.id, meetingId), eq(meetings.schemeId, schemeId)),
  });
  if (!meeting) throw notFound("Meeting");

  const entry: ChairLogEntry = {
    at: ctx.clock.now().toISOString(),
    kind: input.kind,
    note: input.note,
  };

  await ctx.db.transaction(async (tx) => {
    // SQL-level append so concurrent ticks can't drop each other's entries.
    await tx
      .update(meetings)
      .set({
        chairLog: sql`${meetings.chairLog} || ${JSON.stringify([entry])}::jsonb`,
      })
      .where(eq(meetings.id, meetingId));
    await publishEvent(tx, {
      schemeId,
      stream: `meeting:${meetingId}`,
      type: "meeting.chair.note",
      payload: { meetingId, kind: entry.kind, note: entry.note },
      actor: ctx.actor,
      ...causationFields(ctx),
    });
  });

  if (meeting.videoUrl && ctx.integrations.video.sendChatMessage) {
    try {
      await ctx.integrations.video.sendChatMessage(
        videoRoomName(meetingId),
        input.note,
        "GoodStrata Chair",
      );
    } catch (err) {
      console.warn(`[meetings] chair chat message failed: ${(err as Error).message}`);
    }
  }

  return entry;
}

/** Runaway guard: the conductor stops itself after this many ticks (~1h). */
export const MAX_CONDUCT_TICKS = 60;

export type ConductTickResult =
  | { proceed: true }
  | { proceed: false; reason: "not_found" | "not_in_progress" | "tick_cap" };

/**
 * One beat of the conductor loop (called by the meeting.conduct worker).
 * While the meeting is in progress it publishes a meeting.conduct.tick event —
 * the dispatcher fans that out to the chair agent, which does the actual
 * conducting. Each tick is a fresh correlation root on purpose: a long meeting
 * must not trip the per-correlation agent-run cap.
 */
export async function conductTick(
  ctx: ServiceContext,
  schemeId: string,
  meetingId: string,
  tick: number,
): Promise<ConductTickResult> {
  const meeting = await ctx.db.query.meetings.findFirst({
    where: and(eq(meetings.id, meetingId), eq(meetings.schemeId, schemeId)),
  });
  if (!meeting) return { proceed: false, reason: "not_found" };

  if (meeting.status !== "in_progress") {
    if (meeting.transcriptionStarted) {
      await stopTranscriptionBestEffort(ctx, meetingId);
    }
    return { proceed: false, reason: "not_in_progress" };
  }
  if (tick > MAX_CONDUCT_TICKS) {
    console.warn(`[meetings] conductor tick cap reached for meeting ${meetingId} — stopping`);
    return { proceed: false, reason: "tick_cap" };
  }

  await publishEvent(ctx.db, {
    schemeId,
    stream: `meeting:${meetingId}`,
    type: "meeting.conduct.tick",
    payload: { meetingId, tick },
    actor: ctx.actor,
    // Deliberately NO causation inheritance: each tick starts a fresh chain.
  });
  return { proceed: true };
}

async function stopTranscriptionBestEffort(ctx: ServiceContext, meetingId: string) {
  if (!ctx.integrations.video.stopTranscription) return;
  try {
    await ctx.integrations.video.stopTranscription(videoRoomName(meetingId));
  } catch (err) {
    console.warn(`[meetings] stopTranscription failed: ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Motions + voting (s 89B arrears bar enforced at cast time)
// ---------------------------------------------------------------------------

export const addMotionInput = z.object({
  meetingId: z.string().optional(),
  title: z.string().min(3).max(200),
  text: z.string().min(3).max(5000),
  resolutionType: z.enum(["ordinary", "special", "unanimous"]).default("ordinary"),
  /** s 89C(7): mark a motion to appoint/pay/remove the manager. */
  managerAppointment: z.boolean().optional(),
});
export type AddMotionInput = z.infer<typeof addMotionInput>;

export async function addMotion(ctx: ServiceContext, schemeId: string, input: AddMotionInput) {
  const rows = await ctx.db
    .insert(motions)
    .values({
      schemeId,
      meetingId: input.meetingId ?? null,
      title: input.title,
      text: input.text,
      resolutionType: input.resolutionType,
      status: "draft",
      // Persist the s 89C(7) flag in result (no dedicated column) so cast-time
      // enforcement can read it; the closing tally is merged in later.
      result: input.managerAppointment
        ? ({ managerAppointment: true } satisfies MotionResult)
        : null,
    })
    .returning();
  return rows[0]!;
}

/** Standing (s 89(3)): a poll may only be demanded by a lot owner or a proxy. */
async function assertPollStanding(ctx: ServiceContext, schemeId: string, personId: string) {
  const ownership = await ctx.db.query.ownerships.findFirst({
    where: and(
      eq(ownerships.schemeId, schemeId),
      eq(ownerships.personId, personId),
      isNull(ownerships.endedOn),
    ),
  });
  if (ownership) return;
  const proxy = await ctx.db.query.proxies.findFirst({
    where: and(
      eq(proxies.schemeId, schemeId),
      eq(proxies.proxyPersonId, personId),
      isNull(proxies.revokedAt),
    ),
  });
  if (!proxy) {
    throw new DomainError(
      "NO_STANDING",
      "Only a lot owner or a proxy holder may demand a poll (s 89(3))",
      403,
    );
  }
}

/**
 * s 89(3)–(5): a lot owner or proxy may demand a poll on an ordinary resolution,
 * decided by lot entitlement instead of one vote per lot. The demand may be made
 * "before or after the vote is taken" (s 89(3)):
 *
 * - BEFORE (motion open): recorded on the motion and applied when voting closes.
 * - AFTER (motion declared): valid only while a GENERAL meeting is still in
 *   progress; the poll is re-tallied and DISPLACES the declared result (s 89(5)).
 *
 * Circular ballots and committee motions have no s 89(3) poll. Idempotent.
 */
export async function demandPoll(
  ctx: ServiceContext,
  schemeId: string,
  personId: string,
  motionId: string,
) {
  const motion = await ctx.db.query.motions.findFirst({
    where: and(eq(motions.id, motionId), eq(motions.schemeId, schemeId)),
  });
  if (!motion) throw notFound("Motion");
  if (motion.resolutionType !== "ordinary") {
    throw new DomainError(
      "POLL_NOT_APPLICABLE",
      "Special and unanimous resolutions are already decided by entitlement — a poll only applies to ordinary resolutions",
      422,
    );
  }

  await assertPollStanding(ctx, schemeId, personId);

  if (motion.status === "open") {
    // Pre-vote demand — recorded now, applied when voting closes.
    if (!motion.pollDemanded) {
      await ctx.db.update(motions).set({ pollDemanded: true }).where(eq(motions.id, motionId));
    }
    return { motionId, pollDemanded: true, displaced: false };
  }

  if (motion.status === "carried" || motion.status === "lost") {
    // Post-vote demand (s 89(3) "after the vote is taken"). Valid only while a
    // general meeting the motion belongs to is still in progress; the poll then
    // displaces the show-of-hands result (s 89(5)).
    const meeting = motion.meetingId
      ? await ctx.db.query.meetings.findFirst({
          where: and(eq(meetings.id, motion.meetingId), eq(meetings.schemeId, schemeId)),
        })
      : null;
    const generalInProgress =
      meeting &&
      (meeting.kind === "agm" || meeting.kind === "sgm") &&
      !meetingEnded(meeting.status);
    if (!generalInProgress) {
      throw new DomainError(
        "BAD_STATUS",
        "A poll can only be demanded while voting is open, or after the vote at a general meeting that is still in progress (s 89(3))",
        409,
      );
    }
    if (motion.pollDemanded) {
      // Already decided on the poll basis — idempotent.
      return { motionId, pollDemanded: true, displaced: true };
    }

    const quorate = await generalMeetingQuorate(ctx, schemeId, motion.meetingId);
    const outcome = await ctx.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(motions)
        .where(and(eq(motions.id, motionId), eq(motions.schemeId, schemeId)))
        .for("update");
      const locked = rows[0];
      if (!locked) throw notFound("Motion");
      if (locked.status !== "carried" && locked.status !== "lost") {
        throw new DomainError("BAD_STATUS", "Motion is not in a declared state", 409);
      }
      if (locked.pollDemanded) return null; // raced — already displaced
      // s 89(5): force the entitlement re-tally and overwrite the recorded result.
      locked.pollDemanded = true;
      return await resolveMotion(tx, ctx, schemeId, locked, quorate);
    });
    return { motionId, pollDemanded: true, displaced: true, result: outcome };
  }

  throw new DomainError(
    "BAD_STATUS",
    "A poll can only be demanded while voting is open or before the meeting closes",
    409,
  );
}

export async function openMotion(ctx: ServiceContext, schemeId: string, motionId: string) {
  const motion = await ctx.db.query.motions.findFirst({
    where: and(eq(motions.id, motionId), eq(motions.schemeId, schemeId)),
  });
  if (!motion) throw notFound("Motion");
  if (motion.status !== "draft") throw new DomainError("BAD_STATUS", "Motion is not draft", 409);

  await ctx.db.transaction(async (tx) => {
    await tx
      .update(motions)
      .set({ status: "open", opensAt: ctx.clock.now() })
      .where(eq(motions.id, motionId));
    await publishEvent(tx, {
      schemeId,
      stream: `motion:${motionId}`,
      type: "motion.opened",
      payload: { motionId, resolutionType: motion.resolutionType },
      actor: ctx.actor,
      ...causationFields(ctx),
    });
  });
  return { motionId };
}

export const castVoteInput = z.object({
  motionId: z.string(),
  lotId: z.string(),
  choice: z.enum(["for", "against", "abstain"]),
});
export type CastVoteInput = z.infer<typeof castVoteInput>;

/**
 * Cast a vote for a lot. The caster must own the lot or hold a current proxy
 * for it. Eligibility bars applied at cast time: s 89B (arrears, with the
 * s 89B(3) cleared-funds rule and the s 89B(2) special/unanimous carve-out),
 * s 89C(10) (an owner in arrears may not vote as proxy), and s 89C(7) (a
 * non-owner proxy may not vote on a manager-appointment motion).
 */
export async function castVote(
  ctx: ServiceContext,
  schemeId: string,
  personId: string,
  input: CastVoteInput,
) {
  const motion = await ctx.db.query.motions.findFirst({
    where: and(eq(motions.id, input.motionId), eq(motions.schemeId, schemeId)),
  });
  if (!motion) throw notFound("Motion");
  if (motion.status !== "open") {
    throw new DomainError("MOTION_CLOSED", "Voting is not open on this motion", 409);
  }

  const lot = await ctx.db.query.lots.findFirst({
    where: and(eq(lots.id, input.lotId), eq(lots.schemeId, schemeId)),
  });
  if (!lot) throw notFound("Lot");

  // Standing: owner of the lot, or proxy for it.
  const ownership = await ctx.db.query.ownerships.findFirst({
    where: and(
      eq(ownerships.lotId, input.lotId),
      eq(ownerships.personId, personId),
      isNull(ownerships.endedOn),
    ),
  });
  let viaProxyId: string | null = null;
  if (!ownership) {
    // A person can hold several proxy rows for one lot (a lapsed or
    // otherwise-scoped one alongside a current one), so validity — expiry and
    // meeting scope — must be part of the lookup itself. Checking a single
    // arbitrary row after the fact lets a stale proxy shadow a valid one.
    const today = ctx.clock.now().toISOString().slice(0, 10);
    const proxy = await ctx.db.query.proxies.findFirst({
      where: and(
        eq(proxies.lotId, input.lotId),
        eq(proxies.proxyPersonId, personId),
        eq(proxies.schemeId, schemeId),
        isNull(proxies.revokedAt),
        or(isNull(proxies.expiresOn), gte(proxies.expiresOn, today)),
        // Circular resolutions (meetingId null) accept only general proxies.
        motion.meetingId
          ? or(isNull(proxies.meetingId), eq(proxies.meetingId, motion.meetingId))
          : isNull(proxies.meetingId),
      ),
    });
    if (!proxy) {
      throw new DomainError(
        "NO_STANDING",
        "You are not an owner of this lot and hold no valid proxy for it",
        403,
      );
    }
    viaProxyId = proxy.id;
  }

  const at = ctx.clock.now();

  if (viaProxyId !== null) {
    // s 89C(7): a non-owner proxy may not vote on the appointment, payment or
    // removal of the manager.
    const motionResult = (motion.result ?? null) as MotionResult | null;
    if (motionResult?.managerAppointment) {
      const castsOwnLot = await ctx.db.query.ownerships.findFirst({
        where: and(
          eq(ownerships.schemeId, schemeId),
          eq(ownerships.personId, personId),
          isNull(ownerships.endedOn),
        ),
      });
      if (!castsOwnLot) {
        throw new DomainError(
          "S89C7_INELIGIBLE",
          "A proxy who is not a lot owner cannot vote on the appointment, payment or removal of the manager (s 89C(7))",
          403,
        );
      }
    }

    // s 89C(10): a lot owner who is themselves in arrears cannot vote as proxy
    // for another lot (no special/unanimous carve-out — the bar is on the proxy).
    if (await personInArrears(ctx, schemeId, personId, at)) {
      throw new DomainError(
        "S89C10_INELIGIBLE",
        "You are in arrears and cannot vote as a proxy for another lot (s 89C(10))",
        403,
      );
    }
  }

  // s 89B(1)–(3): a lot in arrears cannot vote, except where a special or
  // unanimous resolution is required (s 89B(2)); a payment counts only once
  // cleared (s 89B(3)). The engine owns the carve-out; the service computes the
  // cleared-funds bar.
  const barredByArrears = await lotBarredByArrears(ctx, schemeId, input.lotId, at);
  if (!lotMayVote({ resolutionType: motion.resolutionType, barredByArrears })) {
    throw new DomainError(
      "S89B_INELIGIBLE",
      "This lot is in arrears and cannot vote on this resolution (s 89B)",
      403,
    );
  }

  return await ctx.db.transaction(async (tx) => {
    const inserted = await tx
      .insert(votes)
      .values({
        motionId: input.motionId,
        lotId: input.lotId,
        castByPersonId: personId,
        viaProxyId,
        choice: input.choice,
        entitlementWeight: lot.entitlement,
        castAt: ctx.clock.now(),
      })
      .onConflictDoNothing({ target: [votes.motionId, votes.lotId] })
      .returning();
    if (inserted.length === 0) {
      throw new DomainError("ALREADY_VOTED", "A vote has already been cast for this lot", 409);
    }

    await publishEvent(tx, {
      schemeId,
      stream: `motion:${input.motionId}`,
      type: "vote.cast",
      payload: {
        motionId: input.motionId,
        lotId: input.lotId,
        choice: input.choice,
        entitlementWeight: lot.entitlement,
        viaProxy: viaProxyId !== null,
      },
      actor: ctx.actor,
      ...causationFields(ctx),
    });

    return inserted[0]!;
  });
}

/**
 * Tally a locked, open (or, for a poll displacement, declared) motion, apply the
 * statutory outcome overlay, write status/result and publish motion.resolved.
 *
 * Outcome overlay:
 * - circular ballot (no meeting) — s 86(2)(a): an ordinary resolution's returned
 *   votes must reach the s 77 quorum floor, else it cannot pass;
 * - general meeting (AGM/SGM) — ss 78/97: an ordinary resolution passed while
 *   inquorate becomes an INTERIM resolution, and a special resolution in the
 *   s 97 50–75% band becomes an INTERIM special resolution (provisionally
 *   carried, ripening after 29 days).
 *
 * @param quorate s 77 quorum for a general-meeting motion (null for committee
 *   and circular motions, where interim resolutions do not apply).
 */
async function resolveMotion(
  tx: DbHandle,
  ctx: ServiceContext,
  schemeId: string,
  motion: typeof motions.$inferSelect,
  quorate: boolean | null,
) {
  const cast = await tx.query.votes.findMany({ where: eq(votes.motionId, motion.id) });
  const allLots = await tx.query.lots.findMany({ where: eq(lots.schemeId, schemeId) });
  const totalEntitlement = allLots.reduce((a, l) => a + l.entitlement, 0);

  const tally = tallyMotion(
    cast.map(
      (v): CastVote => ({
        lotId: v.lotId,
        choice: v.choice as VoteChoice,
        entitlementWeight: v.entitlementWeight,
      }),
    ),
    totalEntitlement,
    motion.resolutionType,
    motion.pollDemanded,
  );

  let carried = tally.carried;
  let interim = false;
  let interimKind: MotionResult["interimKind"] = null;
  let belowQuorumFloor = false;

  if (!motion.meetingId) {
    // s 86(2)(a): returned votes on a circular ordinary ballot must reach the
    // s 77 quorum floor. (Special/unanimous already need 75%/100% of ALL
    // entitlements, which necessarily clears the floor.)
    if (motion.resolutionType === "ordinary" && carried) {
      const returnedLots = new Set(cast.map((v) => v.lotId));
      const returnedEntitlement = allLots
        .filter((l) => returnedLots.has(l.id))
        .reduce((a, l) => a + l.entitlement, 0);
      const floor = quorumMet({
        representedLotCount: returnedLots.size,
        totalLotCount: allLots.length,
        representedEntitlement: returnedEntitlement,
        totalEntitlement,
      });
      if (!floor.met) {
        carried = false;
        belowQuorumFloor = true;
      }
    }
  } else if (quorate !== null) {
    if (motion.resolutionType === "ordinary" && carried && !quorate) {
      interim = true; // s 78
      interimKind = "interim_ordinary";
    } else if (
      motion.resolutionType === "special" &&
      !carried &&
      qualifiesInterimSpecial(tally, quorate)
    ) {
      interim = true; // s 97
      interimKind = "interim_special";
      carried = true; // provisionally carried, pending ripening
    }
  }

  const ripensOn = interim ? addDays(ctx.clock.now(), INTERIM_RIPEN_DAYS) : null;
  const prior = (motion.result ?? {}) as MotionResult;
  const result: MotionResult = {
    ...prior,
    ...tally,
    // Preserve the s 89C(7) flag captured at creation; reset any stale overlay.
    managerAppointment: prior.managerAppointment,
    interim,
    interimKind,
    ripensOn: ripensOn ? ripensOn.toISOString() : null,
    challengedAt: null,
    ripenedAt: null,
    quorate: motion.meetingId ? quorate : null,
    belowQuorumFloor,
  };

  await tx
    .update(motions)
    .set({
      status: carried ? "carried" : "lost",
      closesAt: ctx.clock.now(),
      pollDemanded: motion.pollDemanded,
      result,
    })
    .where(eq(motions.id, motion.id));
  await publishEvent(tx, {
    schemeId,
    stream: `motion:${motion.id}`,
    type: "motion.resolved",
    payload: {
      motionId: motion.id,
      carried,
      basis: tally.basis,
      pollDemanded: tally.pollDemanded,
      interim,
      forCount: tally.forCount,
      againstCount: tally.againstCount,
      abstainCount: tally.abstainCount,
      forWeight: tally.forWeight,
      againstWeight: tally.againstWeight,
      abstainWeight: tally.abstainWeight,
    },
    actor: ctx.actor,
    ...causationFields(ctx),
  });

  // Engine tally augmented with the statutory overlay for the caller/UI.
  return {
    ...tally,
    carried,
    interim,
    interimKind,
    ripensOn: result.ripensOn,
    quorate: result.quorate,
    belowQuorumFloor,
  };
}

/** Close voting: tally with the engine and record the statutory result. */
export async function closeMotion(ctx: ServiceContext, schemeId: string, motionId: string) {
  // s 77 quorum for a general-meeting motion is read BEFORE the row lock (a
  // stable read — attendance is settled by close time — that avoids nesting
  // service reads under the lock). Null for committee/circular motions.
  const pre = await ctx.db.query.motions.findFirst({
    where: and(eq(motions.id, motionId), eq(motions.schemeId, schemeId)),
  });
  if (!pre) throw notFound("Motion");
  const quorate = await generalMeetingQuorate(ctx, schemeId, pre.meetingId);

  return await ctx.db.transaction(async (tx) => {
    // Lock the motion row FIRST, then tally from reads taken under that lock:
    // - a concurrent close blocks here, then sees carried/lost → BAD_STATUS
    //   (one motion.resolved event, not two);
    // - a poll demanded before we got the lock is seen by the tally rather
    //   than lost to a stale pre-transaction read (s 89(3));
    // - votes are snapshotted after the lock, so the recorded result reflects
    //   everything committed when closing began.
    const motionRows = await tx
      .select()
      .from(motions)
      .where(and(eq(motions.id, motionId), eq(motions.schemeId, schemeId)))
      .for("update");
    const motion = motionRows[0];
    if (!motion) throw notFound("Motion");
    if (motion.status !== "open") throw new DomainError("BAD_STATUS", "Motion is not open", 409);

    // s 85(1): a circular resolution ballot must run its 14-day notice period
    // before it can be closed and counted.
    if (
      !motion.meetingId &&
      motion.opensAt &&
      daysBetween(motion.opensAt, ctx.clock.now()) < BALLOT_NOTICE_DAYS
    ) {
      throw new DomainError(
        "BALLOT_OPEN",
        `A circular resolution ballot must stay open at least ${BALLOT_NOTICE_DAYS} days (s 85)`,
        409,
      );
    }

    return await resolveMotion(tx, ctx, schemeId, motion, quorate);
  });
}

/**
 * The AI chair's ready-to-close flag: record that discussion on an open motion
 * appears finished, so a human officer can run the binding tally (closeMotion
 * via the officer-gated route). Advisory only — never closes or tallies.
 * Publishes motion.close.proposed, which the notifier turns into an in-app
 * nudge for the committee officers. Idempotent per motion.
 */
export async function proposeMotionClosure(
  ctx: ServiceContext,
  schemeId: string,
  motionId: string,
) {
  const motion = await ctx.db.query.motions.findFirst({
    where: and(eq(motions.id, motionId), eq(motions.schemeId, schemeId)),
  });
  if (!motion) throw notFound("Motion");
  if (motion.status !== "open") throw new DomainError("BAD_STATUS", "Motion is not open", 409);

  const result = (motion.result ?? {}) as MotionResult;
  if (result.closeProposedAt) {
    return { motionId, closeProposedAt: result.closeProposedAt, alreadyProposed: true };
  }

  const closeProposedAt = ctx.clock.now().toISOString();
  await ctx.db.transaction(async (tx) => {
    const updated: MotionResult = { ...result, closeProposedAt };
    await tx.update(motions).set({ result: updated }).where(eq(motions.id, motionId));
    await publishEvent(tx, {
      schemeId,
      stream: `motion:${motionId}`,
      type: "motion.close.proposed",
      payload: { motionId, meetingId: motion.meetingId, title: motion.title },
      actor: ctx.actor,
      ...causationFields(ctx),
    });
  });
  return { motionId, closeProposedAt, alreadyProposed: false };
}

/**
 * ss 78(4)/97(5): ripen an interim resolution into a final one once its 29-day
 * window has elapsed and it was not challenged/petitioned. A challenged interim
 * resolution does NOT ripen — it is set aside (status → lost); re-passing it
 * requires a fresh motion at a reconvened meeting (not modelled here).
 */
export async function ripenInterimResolution(
  ctx: ServiceContext,
  schemeId: string,
  motionId: string,
) {
  return await ctx.db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(motions)
      .where(and(eq(motions.id, motionId), eq(motions.schemeId, schemeId)))
      .for("update");
    const motion = rows[0];
    if (!motion) throw notFound("Motion");
    const result = (motion.result ?? {}) as MotionResult;
    if (!result.interim) {
      throw new DomainError("NOT_INTERIM", "Motion is not an interim resolution", 409);
    }

    if (result.challengedAt) {
      const updated: MotionResult = { ...result, interim: false, ripenedAt: null };
      await tx
        .update(motions)
        .set({ status: "lost", result: updated })
        .where(eq(motions.id, motionId));
      return { ripened: false, outcome: "challenged" as const };
    }
    const ripensOn = result.ripensOn ? new Date(result.ripensOn) : null;
    if (!ripensOn || ctx.clock.now() < ripensOn) {
      throw new DomainError(
        "NOT_YET_RIPE",
        `An interim resolution ripens on ${result.ripensOn ?? "an unknown date"} (ss 78(4)/97(5))`,
        409,
      );
    }
    // Status stays "carried"; the interim flag clears — it is now final.
    const updated: MotionResult = {
      ...result,
      interim: false,
      ripenedAt: ctx.clock.now().toISOString(),
    };
    await tx.update(motions).set({ result: updated }).where(eq(motions.id, motionId));
    return { ripened: true, outcome: "final" as const };
  });
}

/**
 * s 78 (challenge) / s 97(5) (25% petition): record an objection to an interim
 * resolution before it ripens, blocking automatic ripening. Standing: a lot
 * owner. The 25%-petition threshold for interim SPECIAL resolutions is a
 * documented product follow-up — this records the objection; the threshold test
 * is left to counsel/product.
 */
export async function challengeInterimResolution(
  ctx: ServiceContext,
  schemeId: string,
  personId: string,
  motionId: string,
) {
  const owner = await ctx.db.query.ownerships.findFirst({
    where: and(
      eq(ownerships.schemeId, schemeId),
      eq(ownerships.personId, personId),
      isNull(ownerships.endedOn),
    ),
  });
  if (!owner) {
    throw new DomainError(
      "NO_STANDING",
      "Only a lot owner may challenge an interim resolution",
      403,
    );
  }

  return await ctx.db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(motions)
      .where(and(eq(motions.id, motionId), eq(motions.schemeId, schemeId)))
      .for("update");
    const motion = rows[0];
    if (!motion) throw notFound("Motion");
    const result = (motion.result ?? {}) as MotionResult;
    if (!result.interim) {
      throw new DomainError("NOT_INTERIM", "Motion is not an interim resolution", 409);
    }
    const ripensOn = result.ripensOn ? new Date(result.ripensOn) : null;
    if (ripensOn && ctx.clock.now() >= ripensOn) {
      throw new DomainError("TOO_LATE", "The interim resolution has already ripened", 409);
    }
    if (result.challengedAt) return { challenged: true }; // idempotent
    const updated: MotionResult = { ...result, challengedAt: ctx.clock.now().toISOString() };
    await tx.update(motions).set({ result: updated }).where(eq(motions.id, motionId));
    return { challenged: true };
  });
}

// ---------------------------------------------------------------------------
// Proxies + attendance + quorum + close
// ---------------------------------------------------------------------------

export const submitProxyInput = z.object({
  lotId: z.string(),
  proxyPersonId: z.string(),
  meetingId: z.string().optional(),
  expiresOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export type SubmitProxyInput = z.infer<typeof submitProxyInput>;

/**
 * s 89D(1): a person must not act as proxy for more than one lot owner in a
 * scheme of ≤20 occupiable lots, or more than 5% of lot owners in a larger one.
 * Enforced at appointment against the proxies the person already holds that
 * would be usable at the same meeting.
 *
 * Not code-enforced (data notes for counsel/product): the reg 8A exceptions
 * (multi-lot owners; commercial/retail/industrial developments) and the s 89D
 * family exceptions — they need relationship/development-type data the platform
 * does not yet capture, so the cap is applied conservatively without them.
 */
async function assertProxyCap(
  ctx: ServiceContext,
  schemeId: string,
  proxyPersonId: string,
  lotId: string,
  meetingId: string | null,
) {
  const allLots = await ctx.db.query.lots.findMany({ where: eq(lots.schemeId, schemeId) });
  const activeOwnerships = await ctx.db.query.ownerships.findMany({
    where: and(eq(ownerships.schemeId, schemeId), isNull(ownerships.endedOn)),
  });
  const ownerCount = new Set(activeOwnerships.map((o) => o.personId)).size;
  const cap =
    allLots.length <= PROXY_CAP_SMALL_SCHEME_LOTS
      ? 1
      : Math.max(1, Math.floor(PROXY_CAP_LARGE_SCHEME_FRACTION * ownerCount));

  const today = toDateOnly(ctx.clock.now());
  const held = await ctx.db.query.proxies.findMany({
    where: and(
      eq(proxies.schemeId, schemeId),
      eq(proxies.proxyPersonId, proxyPersonId),
      isNull(proxies.revokedAt),
    ),
  });
  // Proxies usable alongside the new one at the same meeting: same-meeting or
  // standing, unexpired, for a DIFFERENT lot (re-appointing the same lot is not
  // farming).
  const distinctLots = new Set<string>();
  for (const p of held) {
    const current = !p.expiresOn || p.expiresOn >= today;
    const scopeOverlaps = !meetingId || !p.meetingId || p.meetingId === meetingId;
    if (current && scopeOverlaps && p.lotId !== lotId) distinctLots.add(p.lotId);
  }
  if (distinctLots.size >= cap) {
    throw new DomainError(
      "PROXY_CAP",
      `A person may act as proxy for at most ${cap} lot(s) at a meeting in this scheme (s 89D)`,
      422,
    );
  }
}

export async function submitProxy(
  ctx: ServiceContext,
  schemeId: string,
  grantorPersonId: string,
  input: SubmitProxyInput,
) {
  const ownership = await ctx.db.query.ownerships.findFirst({
    where: and(
      eq(ownerships.lotId, input.lotId),
      eq(ownerships.personId, grantorPersonId),
      isNull(ownerships.endedOn),
    ),
  });
  if (!ownership) {
    throw new DomainError("NOT_OWNER", "Only the lot owner can appoint a proxy for it", 403);
  }
  if (grantorPersonId === input.proxyPersonId) {
    throw new DomainError("SELF_PROXY", "You cannot appoint yourself as your proxy", 422);
  }

  // s 89C(6): a proxy authorisation lapses 12 months after it is given. Default
  // the expiry to that statutory maximum and reject anything beyond it, so a
  // "standing" proxy can no longer live forever.
  const statutoryMax = addMonthsDateOnly(toDateOnly(ctx.clock.now()), PROXY_LAPSE_MONTHS);
  if (input.expiresOn && input.expiresOn > statutoryMax) {
    throw new DomainError(
      "PROXY_LAPSE",
      `A proxy authorisation lapses 12 months after it is given (s 89C(6)); expiry cannot be later than ${statutoryMax}`,
      422,
    );
  }
  const expiresOn = input.expiresOn ?? statutoryMax;

  // s 89D: proxy-farming cap. A person may act as proxy for at most one lot in a
  // scheme of ≤20 occupiable lots, or 5% of lot owners in a larger scheme.
  await assertProxyCap(ctx, schemeId, input.proxyPersonId, input.lotId, input.meetingId ?? null);

  return await ctx.db.transaction(async (tx) => {
    const rows = await tx
      .insert(proxies)
      .values({
        schemeId,
        grantorPersonId,
        lotId: input.lotId,
        proxyPersonId: input.proxyPersonId,
        scope: input.meetingId ? "meeting" : "standing",
        meetingId: input.meetingId ?? null,
        expiresOn,
      })
      .returning();
    const proxy = rows[0]!;

    await publishEvent(tx, {
      schemeId,
      stream: `meeting:${input.meetingId ?? "standing"}`,
      type: "proxy.submitted",
      payload: { proxyId: proxy.id, lotId: input.lotId, proxyPersonId: input.proxyPersonId },
      actor: ctx.actor,
      ...causationFields(ctx),
    });
    return proxy;
  });
}

export async function recordAttendance(
  ctx: ServiceContext,
  schemeId: string,
  meetingId: string,
  personId: string,
  mode: "in_person" | "online" | "proxy",
) {
  const meeting = await ctx.db.query.meetings.findFirst({
    where: and(eq(meetings.id, meetingId), eq(meetings.schemeId, schemeId)),
  });
  if (!meeting) throw notFound("Meeting");
  const ownership = await ctx.db.query.ownerships.findFirst({
    where: and(
      eq(ownerships.schemeId, schemeId),
      eq(ownerships.personId, personId),
      isNull(ownerships.endedOn),
    ),
  });
  await ctx.db
    .insert(meetingAttendance)
    .values({ meetingId, personId, lotId: ownership?.lotId ?? null, mode })
    .onConflictDoNothing();
  return quorumStatus(ctx, schemeId, meetingId);
}

/** Lots + entitlement represented by attendees and valid proxies vs the roll (s 77). */
export async function quorumStatus(ctx: ServiceContext, schemeId: string, meetingId: string) {
  const allLots = await ctx.db.query.lots.findMany({ where: eq(lots.schemeId, schemeId) });
  const totalEntitlement = allLots.reduce((a, l) => a + l.entitlement, 0);

  const attendance = await ctx.db.query.meetingAttendance.findMany({
    where: eq(meetingAttendance.meetingId, meetingId),
  });
  const attendeePersonIds = attendance.map((a) => a.personId);

  const representedLots = new Set<string>();
  if (attendeePersonIds.length > 0) {
    const owned = await ctx.db.query.ownerships.findMany({
      where: and(eq(ownerships.schemeId, schemeId), isNull(ownerships.endedOn)),
    });
    for (const o of owned) {
      if (attendeePersonIds.includes(o.personId)) representedLots.add(o.lotId);
    }
    // Proxies held by attendees — same validity rules as cast time: scoped to
    // this meeting (or standing), not revoked, and not past their expiry.
    const today = ctx.clock.now().toISOString().slice(0, 10);
    const proxyRows = await ctx.db.query.proxies.findMany({
      where: and(eq(proxies.schemeId, schemeId), isNull(proxies.revokedAt)),
    });
    for (const p of proxyRows) {
      const scopeOk = !p.meetingId || p.meetingId === meetingId;
      const current = !p.expiresOn || p.expiresOn >= today;
      if (scopeOk && current && attendeePersonIds.includes(p.proxyPersonId)) {
        representedLots.add(p.lotId);
      }
    }
  }

  const representedEntitlement = allLots
    .filter((l) => representedLots.has(l.id))
    .reduce((a, l) => a + l.entitlement, 0);

  // s 77: primary basis is the number of lots represented; entitlement is the
  // fallback limb. The engine applies the two-limb test.
  const quorum = quorumMet({
    representedLotCount: representedLots.size,
    totalLotCount: allLots.length,
    representedEntitlement,
    totalEntitlement,
  });

  return {
    representedLotCount: representedLots.size,
    totalLotCount: allLots.length,
    representedEntitlement,
    totalEntitlement,
    quorate: quorum.met,
    quorumBasis: quorum.basis,
  };
}

/** Close the meeting; the minutes agent reacts to the meeting.closed event. */
export async function closeMeeting(ctx: ServiceContext, schemeId: string, meetingId: string) {
  const meeting = await ctx.db.query.meetings.findFirst({
    where: and(eq(meetings.id, meetingId), eq(meetings.schemeId, schemeId)),
  });
  if (!meeting) throw notFound("Meeting");
  if (meetingEnded(meeting.status)) {
    throw new DomainError("ALREADY_CLOSED", "Meeting is already closed", 409);
  }

  const quorum = await quorumStatus(ctx, schemeId, meetingId);

  // Wind down transcription and preserve what it captured. All best-effort:
  // a video/transcription failure must never block closing the meeting.
  let transcriptDocumentId: string | null = null;
  if (meeting.transcriptionStarted) {
    await stopTranscriptionBestEffort(ctx, meetingId);
    if (ctx.integrations.video.fetchTranscriptText) {
      try {
        const text = await ctx.integrations.video.fetchTranscriptText(videoRoomName(meetingId));
        if (text) {
          const doc = await uploadDocument(ctx, schemeId, {
            filename: `transcript-${meetingId}.txt`,
            contentType: "text/plain",
            content: new TextEncoder().encode(text),
            category: "minutes",
            title: "Meeting transcript",
            accessLevel: "committee",
          });
          transcriptDocumentId = doc.id;
        }
      } catch (err) {
        console.warn(`[meetings] transcript retrieval failed: ${(err as Error).message}`);
      }
    }
  }

  await ctx.db.transaction(async (tx) => {
    await tx
      .update(meetings)
      .set({ status: "closed", quorumMet: quorum.quorate })
      .where(eq(meetings.id, meetingId));
    await publishEvent(tx, {
      schemeId,
      stream: `meeting:${meetingId}`,
      type: "meeting.closed",
      payload: { meetingId, quorumMet: quorum.quorate, transcriptDocumentId },
      actor: ctx.actor,
      ...causationFields(ctx),
    });
  });

  return quorum;
}

/**
 * Officer approval of the agent-drafted minutes. The meetings agent stores its
 * draft committee-only with status "minutes_draft"; this human-invoked step
 * republishes the document owner-visible, flips the meeting to
 * minutes_distributed, and publishes minutes.drafted — the event the notifier
 * fans out to every member — so members are told only once a human has
 * reviewed the LLM's draft.
 */
export async function approveMinutes(ctx: ServiceContext, schemeId: string, meetingId: string) {
  // Same rule as decision resolution: this is a human gate — an agent or
  // system actor must never approve the LLM's own draft.
  if (ctx.actor.kind !== "user") {
    throw new DomainError("FORBIDDEN", "Only a user can approve minutes", 403);
  }
  const meeting = await ctx.db.query.meetings.findFirst({
    where: and(eq(meetings.id, meetingId), eq(meetings.schemeId, schemeId)),
  });
  if (!meeting) throw notFound("Meeting");
  if (meeting.status !== "minutes_draft" || !meeting.minutesDocumentId) {
    throw new DomainError(
      "NO_DRAFT_MINUTES",
      "This meeting has no draft minutes awaiting approval",
      409,
    );
  }
  const documentId = meeting.minutesDocumentId;

  await ctx.db.transaction(async (tx) => {
    await tx.update(documents).set({ accessLevel: "owners" }).where(eq(documents.id, documentId));
    await tx
      .update(meetings)
      .set({ status: "minutes_distributed" })
      .where(eq(meetings.id, meetingId));
    await publishEvent(tx, {
      schemeId,
      stream: `meeting:${meetingId}`,
      type: "minutes.drafted",
      payload: { meetingId, documentId },
      actor: ctx.actor,
      ...causationFields(ctx),
    });
  });

  return { meetingId, documentId };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function meetingDetail(ctx: ServiceContext, schemeId: string, meetingId: string) {
  const meeting = await ctx.db.query.meetings.findFirst({
    where: and(eq(meetings.id, meetingId), eq(meetings.schemeId, schemeId)),
  });
  if (!meeting) throw notFound("Meeting");
  const agenda = await ctx.db.query.agendaItems.findMany({
    where: eq(agendaItems.meetingId, meetingId),
    orderBy: (t, { asc }) => asc(t.order),
  });
  const motionRows = await ctx.db.query.motions.findMany({
    where: and(eq(motions.schemeId, schemeId), eq(motions.meetingId, meetingId)),
    orderBy: (t, { asc }) => asc(t.createdAt),
  });
  const quorum = await quorumStatus(ctx, schemeId, meetingId);
  return {
    meeting,
    agenda,
    motions: motionRows,
    quorum,
    chairLog: meeting.chairLog,
    transcriptionStarted: meeting.transcriptionStarted,
  };
}

export async function listMeetings(ctx: ServiceContext, schemeId: string) {
  return await ctx.db.query.meetings.findMany({
    where: eq(meetings.schemeId, schemeId),
    orderBy: (t, { desc }) => desc(t.scheduledAt),
  });
}
