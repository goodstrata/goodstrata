import { randomBytes } from "node:crypto";
import { invites, memberships, people, schemes, users } from "@goodstrata/db";
import { publishEvent } from "@goodstrata/events";
import { INVITABLE_ROLES, type MembershipRole, toDateOnly } from "@goodstrata/shared";
import { and, eq, isNull } from "drizzle-orm";
import { causationFields, type ServiceContext } from "../context.js";
import { infoNote, paragraph, renderEmail } from "../email/index.js";
import { DomainError, notFound } from "../errors.js";
import { notifyUsers } from "./notifications.js";

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
  // Defense in depth: an invite must never grant the manager_admin super-role
  // (which bypasses every downstream gate). Route/tool schemas already restrict
  // this, but this is the chokepoint that actually writes the role, so re-check.
  if (!(INVITABLE_ROLES as readonly MembershipRole[]).includes(role)) {
    throw new DomainError("INVALID_ROLE", "That role cannot be granted via invite", 422);
  }

  const person = await ctx.db.query.people.findFirst({
    where: and(eq(people.id, personId), eq(people.schemeId, schemeId)),
  });
  if (!person) throw notFound("Person");
  if (!person.email) {
    throw new DomainError("NO_EMAIL", "Person has no email address to invite", 422);
  }
  const scheme = await ctx.db.query.schemes.findFirst({ where: eq(schemes.id, schemeId) });
  if (!scheme) throw notFound("Scheme");

  const roleLabel = role.replace(/_/g, " ");

  // If the invited email already has a GoodStrata login, don't make them "create
  // an account": link the person record to that user, grant the membership, and
  // notify them. They land straight in the scheme the next time they sign in.
  const existingUser = await ctx.db.query.users.findFirst({
    where: eq(users.email, person.email),
  });
  if (existingUser) {
    await ctx.db.transaction(async (tx) => {
      await tx.update(people).set({ userId: existingUser.id }).where(eq(people.id, personId));
      const active = await tx.query.memberships.findMany({
        where: and(
          eq(memberships.schemeId, schemeId),
          eq(memberships.userId, existingUser.id),
          eq(memberships.role, role),
          isNull(memberships.endedOn),
        ),
      });
      if (active.length === 0) {
        await tx.insert(memberships).values({
          schemeId,
          userId: existingUser.id,
          role,
          startedOn: toDateOnly(ctx.clock.now()),
        });
      }
      await publishEvent(tx, {
        schemeId,
        stream: `person:${personId}`,
        type: "owner.joined",
        payload: { personId, userId: existingUser.id },
        actor: ctx.actor,
        ...causationFields(ctx),
      });
    });

    await notifyUsers(ctx, schemeId, [existingUser.id], {
      title: `You've been added to ${scheme.name}`,
      body: `You now have ${roleLabel} access to ${scheme.name}. Open GoodStrata to see your building.`,
      category: "general",
    });

    const added = renderEmail({
      preheader: `You've been added to ${scheme.name} on GoodStrata.`,
      heading: `You've been added to ${scheme.name}`,
      intro: `Hi ${person.givenName ?? "there"}, you've been added to ${scheme.name} (${scheme.planOfSubdivision}) on GoodStrata as ${roleLabel}. It's linked to your existing account — just sign in.`,
      blocks: [
        paragraph(
          "GoodStrata is the register for your owners corporation — levies, meetings, decisions, and documents, all on the record.",
        ),
      ],
      cta: { label: "Open GoodStrata", url: appUrl },
    });
    await ctx.integrations.email.send({
      to: person.email,
      subject: `You've been added to ${scheme.name} on GoodStrata`,
      text: added.text,
      html: added.html,
    });

    return { linked: true as const, expiresAt: null };
  }

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
  const { html, text } = renderEmail({
    preheader: `You've been invited to join ${scheme.name} on GoodStrata.`,
    heading: `You're invited to join ${scheme.name}`,
    intro: `Hi ${person.givenName ?? "there"}, you've been invited to join ${scheme.name} (${scheme.planOfSubdivision}) on GoodStrata as ${roleLabel}.`,
    blocks: [
      paragraph(
        "GoodStrata is the register for your owners corporation — levies, meetings, decisions, and documents, all on the record. Accept your invitation to set up your login.",
      ),
      infoNote(`This invitation link expires in ${INVITE_TTL_DAYS} days.`),
    ],
    cta: { label: "Accept invitation", url: joinUrl },
  });
  await ctx.integrations.email.send({
    to: person.email,
    subject: `You're invited to ${scheme.name} on GoodStrata`,
    text,
    html,
  });

  return { linked: false as const, token, expiresAt };
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
  // The person's name is already set on the invited record — return it so the
  // join screen can show it read-only rather than asking them to re-type it.
  const person = await ctx.db.query.people.findFirst({
    where: eq(people.id, invite.personId),
  });
  const name = [person?.givenName, person?.familyName].filter(Boolean).join(" ").trim();
  return {
    schemeName: scheme?.name ?? "an owners corporation",
    role: invite.role,
    email: invite.email,
    name: name || null,
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
