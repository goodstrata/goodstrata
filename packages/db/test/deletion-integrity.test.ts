import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  communityPosts,
  decisions,
  decisionVotes,
  memberships,
  notifications,
  people,
  schemes,
  users,
} from "../src/schema/index.js";
import { provisionTestDatabase, type TestDatabase } from "../src/testing.js";

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await provisionTestDatabase();
});

afterAll(async () => {
  await tdb.cleanup();
});

/**
 * Before this migration, `people.userId`, `memberships.userId`,
 * `community_posts.authorUserId`, `notifications.userId`,
 * `decisions.decidedByUserId` and `decision_votes.userId` referenced
 * `users.id` with no ON DELETE action — deleting a better-auth account with
 * any scheme history hit a foreign-key violation and could not complete.
 * These columns are now ON DELETE SET NULL: the login link severs, but the
 * roll entry, role-period history, post, ballot, and notification survive.
 */
describe("account deletion severs userId links instead of blocking on an FK violation", () => {
  it("deletes cleanly and nulls every userId link while the linked rows survive", async () => {
    const { db } = tdb;

    const [scheme] = await db
      .insert(schemes)
      .values({
        name: "Deletion Test OC",
        planOfSubdivision: `PS${randomUUID().slice(0, 6)}D`,
        addressLine1: "1 Delete St",
        suburb: "Testville",
        postcode: "3000",
        tier: 3,
      })
      .returning();

    const userId = `user_${randomUUID()}`;
    await db
      .insert(users)
      .values({ id: userId, name: "Departing Owner", email: `${userId}@example.com` });

    const [person] = await db
      .insert(people)
      .values({ schemeId: scheme!.id, userId, givenName: "Departing", familyName: "Owner" })
      .returning();

    const [membership] = await db
      .insert(memberships)
      .values({ schemeId: scheme!.id, userId, role: "owner", startedOn: "2026-01-01" })
      .returning();

    const [post] = await db
      .insert(communityPosts)
      .values({ schemeId: scheme!.id, authorUserId: userId, body: "Hello, neighbours" })
      .returning();

    const [notification] = await db
      .insert(notifications)
      .values({
        schemeId: scheme!.id,
        userId,
        title: "Welcome",
        body: "You're on the roll",
        category: "general",
      })
      .returning();

    const [decision] = await db
      .insert(decisions)
      .values({
        schemeId: scheme!.id,
        kind: "other",
        title: "Test decision",
        summaryMd: "Does this survive account deletion?",
        options: [
          { id: "approve", label: "Approve" },
          { id: "decline", label: "Decline" },
        ],
        deciderRole: "committee",
        decidedByUserId: userId,
      })
      .returning();

    const [vote] = await db
      .insert(decisionVotes)
      .values({ decisionId: decision!.id, userId, choice: "approve" })
      .returning();

    // What better-auth's deleteUser adapter call ultimately runs: a bare
    // DELETE on users, exercising every FK above in one statement.
    await expect(db.delete(users).where(eq(users.id, userId))).resolves.not.toThrow();

    const [survivingPerson] = await db.select().from(people).where(eq(people.id, person!.id));
    expect(survivingPerson?.userId).toBeNull();
    expect(survivingPerson?.givenName).toBe("Departing");

    const [survivingMembership] = await db
      .select()
      .from(memberships)
      .where(eq(memberships.id, membership!.id));
    expect(survivingMembership?.userId).toBeNull();
    expect(survivingMembership?.role).toBe("owner");

    const [survivingPost] = await db
      .select()
      .from(communityPosts)
      .where(eq(communityPosts.id, post!.id));
    expect(survivingPost?.authorUserId).toBeNull();
    expect(survivingPost?.body).toBe("Hello, neighbours");

    const [survivingNotification] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.id, notification!.id));
    expect(survivingNotification?.userId).toBeNull();

    const [survivingDecision] = await db
      .select()
      .from(decisions)
      .where(eq(decisions.id, decision!.id));
    expect(survivingDecision?.decidedByUserId).toBeNull();

    const [survivingVote] = await db
      .select()
      .from(decisionVotes)
      .where(eq(decisionVotes.id, vote!.id));
    expect(survivingVote?.userId).toBeNull();
  });
});
