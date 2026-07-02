import { randomBytes } from "node:crypto";
import { invites, memberships, people, schemes } from "@goodstrata/db";
import { publishEvent } from "@goodstrata/events";
import { type MembershipRole, toDateOnly } from "@goodstrata/shared";
import { and, eq, isNull } from "drizzle-orm";
import { causationFields, type ServiceContext } from "../context.js";
import { DomainError, notFound } from "../errors.js";

const INVITE_TTL_DAYS = 14;

/**
 * Email an invite to a person (owner/committee/tenant) to join the portal.
 * The link carries a one-time token; accepting links their login to the
 * person record and creates the membership.
 */
export async function invitePerson(
  ctx: ServiceContext,
  schemeId: string,
  personId: string,
  role: MembershipRole,
  appUrl: string,
) {
  const person = await ctx.db.query.people.findFirst({
    where: and(eq(people.id, personId), eq(people.schemeId, schemeId)),
  });
  if (!person) throw notFound("Person");
  if (!person.email) {
    throw new DomainError("NO_EMAIL", "Person has no email address to invite", 422);
  }
  const scheme = await ctx.db.query.schemes.findFirst({ where: eq(schemes.id, schemeId) });
  if (!scheme) throw notFound("Scheme");

  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(ctx.clock.now().getTime() + INVITE_TTL_DAYS * 86_400_000);

  await ctx.db.transaction(async (tx) => {
    await tx.insert(invites).values({
      schemeId,
      personId,
      email: person.email!,
      role,
      token,
      expiresAt,
    });
    await publishEvent(tx, {
      schemeId,
      stream: `person:${personId}`,
      type: "owner.invited",
      payload: { personId, email: person.email! },
      actor: ctx.actor,
      ...causationFields(ctx),
    });
  });

  const joinUrl = `${appUrl}/join?token=${token}`;
  await ctx.integrations.email.send({
    to: person.email,
    subject: `You're invited to ${scheme.name} on GoodStrata`,
    text: [
      `Hi ${person.givenName ?? "there"},`,
      "",
      `You've been invited to join ${scheme.name} (${scheme.planOfSubdivision}) on GoodStrata as ${role.replace("_", " ")}.`,
      "",
      `Accept your invite: ${joinUrl}`,
      "",
      `This link expires in ${INVITE_TTL_DAYS} days.`,
    ].join("\n"),
  });

  return { token, expiresAt };
}

/** Public preview so the join page can say what the invite is for. */
export async function previewInvite(ctx: ServiceContext, token: string) {
  const invite = await ctx.db.query.invites.findFirst({ where: eq(invites.token, token) });
  if (!invite || invite.acceptedAt || invite.expiresAt < ctx.clock.now()) {
    throw new DomainError("INVALID_INVITE", "This invite is invalid or has expired", 410);
  }
  const scheme = await ctx.db.query.schemes.findFirst({
    where: eq(schemes.id, invite.schemeId),
  });
  return {
    schemeName: scheme?.name ?? "an owners corporation",
    role: invite.role,
    email: invite.email,
  };
}

/** Accept an invite as the signed-in user: link person ↔ user, add membership. */
export async function acceptInvite(ctx: ServiceContext, token: string) {
  if (ctx.actor.kind !== "user") {
    throw new DomainError("FORBIDDEN", "Sign in to accept an invite", 403);
  }
  const userId = ctx.actor.id;

  return await ctx.db.transaction(async (tx) => {
    const invite = await tx.query.invites.findFirst({ where: eq(invites.token, token) });
    if (!invite || invite.acceptedAt || invite.expiresAt < ctx.clock.now()) {
      throw new DomainError("INVALID_INVITE", "This invite is invalid or has expired", 410);
    }

    await tx.update(invites).set({ acceptedAt: ctx.clock.now() }).where(eq(invites.id, invite.id));

    await tx.update(people).set({ userId }).where(eq(people.id, invite.personId));

    const existing = await tx.query.memberships.findMany({
      where: and(
        eq(memberships.schemeId, invite.schemeId),
        eq(memberships.userId, userId),
        eq(memberships.role, invite.role),
        isNull(memberships.endedOn),
      ),
    });
    if (existing.length === 0) {
      await tx.insert(memberships).values({
        schemeId: invite.schemeId,
        userId,
        role: invite.role,
        startedOn: toDateOnly(ctx.clock.now()),
      });
    }

    await publishEvent(tx, {
      schemeId: invite.schemeId,
      stream: `person:${invite.personId}`,
      type: "owner.joined",
      payload: { personId: invite.personId, userId },
      actor: ctx.actor,
      ...causationFields(ctx),
    });

    return { schemeId: invite.schemeId };
  });
}
