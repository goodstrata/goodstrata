import {
  agendaItems,
  lots,
  meetingAttendance,
  meetings,
  motions,
  ownerships,
  people,
  proxies,
  schemes,
  votes,
} from "@goodstrata/db";
import { publishEvent } from "@goodstrata/events";
import { daysBetween, type VoteChoice } from "@goodstrata/shared";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { causationFields, type ServiceContext } from "../context.js";
import { type CastVote, quorumMet, tallyMotion } from "../engines/voting.js";
import { DomainError, notFound } from "../errors.js";
import { arrearsForScheme } from "./arrears.js";
import { sendEmail } from "./comms.js";

const AGM_NOTICE_DAYS = 14; // s 71: at least 14 days' notice

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

/** Send the statutory meeting notice to every owner (14-day rule for GMs). */
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
    if (days < AGM_NOTICE_DAYS) {
      throw new DomainError(
        "NOTICE_TOO_LATE",
        `General meetings need at least ${AGM_NOTICE_DAYS} days' notice (meeting is in ${days})`,
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
    await tx
      .update(meetings)
      .set({ status: "notice_sent", noticeSentAt: ctx.clock.now() })
      .where(eq(meetings.id, meetingId));
    await publishEvent(tx, {
      schemeId,
      stream: `meeting:${meetingId}`,
      type: "meeting.notice.issued",
      payload: { meetingId, recipients: reachable.length },
      actor: ctx.actor,
      ...causationFields(ctx),
    });
  });

  for (const owner of reachable) {
    await sendEmail(ctx, {
      schemeId,
      personId: owner.personId,
      to: owner.email!,
      subject: `Notice of ${meeting.kind.toUpperCase()}: ${meeting.title} — ${scheme?.name}`,
      template: "meeting_notice",
      related: { type: "meeting", id: meetingId },
      body: [
        `Dear ${owner.givenName ?? "Owner"},`,
        "",
        `Notice is given of the following meeting of ${scheme?.name}:`,
        "",
        `${meeting.title}`,
        `When: ${meeting.scheduledAt.toLocaleString("en-AU", { timeZone: "Australia/Melbourne" })}`,
        meeting.location ? `Where: ${meeting.location}` : "",
        "",
        "Agenda:",
        ...agenda.map((a) => `  ${a.order}. ${a.title}`),
        "",
        "You may vote in person, online, or appoint a proxy via the portal before the meeting.",
        "",
        `${scheme?.name} — powered by GoodStrata`,
      ]
        .filter((l) => l !== "")
        .join("\n"),
    });
  }

  return { recipients: reachable.length };
}

// ---------------------------------------------------------------------------
// Video meetings (Daily.co in production; console provider offline)
// ---------------------------------------------------------------------------

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
  if (meeting.status === "closed" || meeting.status === "minutes_distributed") {
    throw new DomainError("ALREADY_CLOSED", "Meeting is already closed", 409);
  }
  if (meeting.videoUrl) return { url: meeting.videoUrl };

  const room = await ctx.integrations.video.createRoom({
    name: videoRoomName(meetingId),
    expiresMinutes: VIDEO_ROOM_EXPIRES_MINUTES,
  });

  await ctx.db.transaction(async (tx) => {
    await tx
      .update(meetings)
      .set({
        videoUrl: room.url,
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
// Motions + voting (s 89 enforced at cast time)
// ---------------------------------------------------------------------------

export const addMotionInput = z.object({
  meetingId: z.string().optional(),
  title: z.string().min(3).max(200),
  text: z.string().min(3).max(5000),
  resolutionType: z.enum(["ordinary", "special", "unanimous"]).default("ordinary"),
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
    })
    .returning();
  return rows[0]!;
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
 * for it. s 89: lots with overdue levies cannot vote on ordinary resolutions.
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
    const proxy = await ctx.db.query.proxies.findFirst({
      where: and(
        eq(proxies.lotId, input.lotId),
        eq(proxies.proxyPersonId, personId),
        eq(proxies.schemeId, schemeId),
        isNull(proxies.revokedAt),
      ),
    });
    const valid =
      proxy &&
      (!proxy.expiresOn || proxy.expiresOn >= ctx.clock.now().toISOString().slice(0, 10)) &&
      (!proxy.meetingId || proxy.meetingId === motion.meetingId);
    if (!valid) {
      throw new DomainError(
        "NO_STANDING",
        "You are not an owner of this lot and hold no valid proxy for it",
        403,
      );
    }
    viaProxyId = proxy.id;
  }

  // s 89: overdue lots are barred from ordinary resolutions.
  if (motion.resolutionType === "ordinary") {
    const arrears = await arrearsForScheme(ctx, schemeId);
    if (arrears.some((a) => a.lotId === input.lotId)) {
      throw new DomainError(
        "S89_INELIGIBLE",
        "This lot has overdue levies and cannot vote on ordinary resolutions (s 89)",
        403,
      );
    }
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

/** Close voting: tally with the engine and record the statutory result. */
export async function closeMotion(ctx: ServiceContext, schemeId: string, motionId: string) {
  const motion = await ctx.db.query.motions.findFirst({
    where: and(eq(motions.id, motionId), eq(motions.schemeId, schemeId)),
  });
  if (!motion) throw notFound("Motion");
  if (motion.status !== "open") throw new DomainError("BAD_STATUS", "Motion is not open", 409);

  const cast = await ctx.db.query.votes.findMany({ where: eq(votes.motionId, motionId) });
  const allLots = await ctx.db.query.lots.findMany({ where: eq(lots.schemeId, schemeId) });
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
  );

  await ctx.db.transaction(async (tx) => {
    await tx
      .update(motions)
      .set({
        status: tally.carried ? "carried" : "lost",
        closesAt: ctx.clock.now(),
        result: tally,
      })
      .where(eq(motions.id, motionId));
    await publishEvent(tx, {
      schemeId,
      stream: `motion:${motionId}`,
      type: "motion.resolved",
      payload: {
        motionId,
        carried: tally.carried,
        forWeight: tally.forWeight,
        againstWeight: tally.againstWeight,
        abstainWeight: tally.abstainWeight,
      },
      actor: ctx.actor,
      ...causationFields(ctx),
    });
  });

  return tally;
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
        expiresOn: input.expiresOn ?? null,
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
    where: and(eq(ownerships.personId, personId), isNull(ownerships.endedOn)),
  });
  await ctx.db
    .insert(meetingAttendance)
    .values({ meetingId, personId, lotId: ownership?.lotId ?? null, mode })
    .onConflictDoNothing();
  return quorumStatus(ctx, schemeId, meetingId);
}

/** Entitlement represented by attendees + valid proxies vs the roll. */
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
    // Proxies held by attendees.
    const proxyRows = await ctx.db.query.proxies.findMany({
      where: and(eq(proxies.schemeId, schemeId), isNull(proxies.revokedAt)),
    });
    for (const p of proxyRows) {
      const scopeOk = !p.meetingId || p.meetingId === meetingId;
      if (scopeOk && attendeePersonIds.includes(p.proxyPersonId)) representedLots.add(p.lotId);
    }
  }

  const representedEntitlement = allLots
    .filter((l) => representedLots.has(l.id))
    .reduce((a, l) => a + l.entitlement, 0);

  return {
    representedEntitlement,
    totalEntitlement,
    quorate: quorumMet(representedEntitlement, totalEntitlement),
  };
}

/** Close the meeting; the minutes agent reacts to the meeting.closed event. */
export async function closeMeeting(ctx: ServiceContext, schemeId: string, meetingId: string) {
  const meeting = await ctx.db.query.meetings.findFirst({
    where: and(eq(meetings.id, meetingId), eq(meetings.schemeId, schemeId)),
  });
  if (!meeting) throw notFound("Meeting");
  if (meeting.status === "closed" || meeting.status === "minutes_distributed") {
    throw new DomainError("ALREADY_CLOSED", "Meeting is already closed", 409);
  }

  const quorum = await quorumStatus(ctx, schemeId, meetingId);

  await ctx.db.transaction(async (tx) => {
    await tx
      .update(meetings)
      .set({ status: "closed", quorumMet: quorum.quorate })
      .where(eq(meetings.id, meetingId));
    await publishEvent(tx, {
      schemeId,
      stream: `meeting:${meetingId}`,
      type: "meeting.closed",
      payload: { meetingId, quorumMet: quorum.quorate },
      actor: ctx.actor,
      ...causationFields(ctx),
    });
  });

  return quorum;
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
  return { meeting, agenda, motions: motionRows, quorum };
}

export async function listMeetings(ctx: ServiceContext, schemeId: string) {
  return await ctx.db.query.meetings.findMany({
    where: eq(meetings.schemeId, schemeId),
    orderBy: (t, { desc }) => desc(t.scheduledAt),
  });
}
