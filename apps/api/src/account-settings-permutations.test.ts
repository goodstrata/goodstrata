import { randomUUID } from "node:crypto";
import { accounts, sessions, users } from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import {
  memoryEmailProvider,
  memorySmsProvider,
  memoryStorageProvider,
  mockPaymentsProvider,
} from "@goodstrata/integrations";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Auth, createAuth } from "./auth.js";
import type { AppDeps } from "./deps.js";
import { type AppEnv, requireAuth } from "./middleware.js";
import { profileRoutes } from "./routes/profile.js";

/**
 * Account settings permutation coverage — the server contracts behind
 * /settings (ProfileSection + SecuritySection):
 *
 * - avatar upload/remove/serve (apps/api profile routes) across the full
 *   input matrix: no file, wrong type, empty, oversize, valid, replace,
 *   traversal, cross-user reads;
 * - better-auth account flows the cards call: update-user (name),
 *   change-email (same/taken/new; verified pending vs unverified immediate),
 *   change-password (wrong current, short new, success + revokeOtherSessions),
 *   sessions (list/revoke one/revoke rest), list-accounts variants
 *   (credential-only vs google-only vs both) driving unlink refusal, and
 *   delete-user (wrong password, credential success, social-only success).
 *
 * Real better-auth against a provisioned Postgres — no mocks of the auth
 * layer itself. Every request carries a unique x-forwarded-for so
 * better-auth's in-memory rate limiter never couples tests together.
 */

const APP_URL = "http://localhost:5173";
const ORIGIN = APP_URL;

let tdb: TestDatabase;
let auth: Auth;
let app: Hono;

const email = memoryEmailProvider();
const storage = memoryStorageProvider();
const integrations = {
  email,
  sms: memorySmsProvider(),
  storage,
  payments: mockPaymentsProvider(),
};

// Unique per-request IP: better-auth keys its rate limiter on the client IP,
// so distinct addresses keep tests independent and deterministic.
let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return `10.9.${Math.floor(ipCounter / 200)}.${(ipCounter % 200) + 1}`;
}

function cookieOf(res: Response): string {
  const set = res.headers.getSetCookie();
  return set.map((c) => c.split(";")[0]!).join("; ");
}

function req(path: string, init: RequestInit & { cookie?: string } = {}) {
  const { cookie, headers, ...rest } = init;
  return app.request(`${APP_URL}${path}`, {
    ...rest,
    headers: {
      origin: ORIGIN,
      "x-forwarded-for": nextIp(),
      ...(cookie ? { cookie } : {}),
      ...(headers as Record<string, string> | undefined),
    },
  });
}

function authPost(path: string, body: unknown, cookie?: string) {
  return req(`/api/auth${path}`, {
    method: "POST",
    cookie,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function authGet(path: string, cookie?: string) {
  return req(`/api/auth${path}`, { method: "GET", cookie });
}

let userSeq = 0;
async function signUp(prefix: string, password = "initial-pass-123") {
  userSeq += 1;
  const address = `${prefix}.${userSeq}.${randomUUID().slice(0, 8)}@perm.test`;
  const res = await authPost("/sign-up/email", {
    name: `${prefix} user`,
    email: address,
    password,
  });
  expect(res.status).toBe(200);
  const cookie = cookieOf(res);
  const session = await getSession(cookie);
  expect(session?.user?.email).toBe(address);
  return { email: address, password, cookie, userId: session!.user.id as string };
}

async function signIn(address: string, password: string) {
  const res = await authPost("/sign-in/email", { email: address, password });
  expect(res.status).toBe(200);
  return cookieOf(res);
}

interface SessionShape {
  user: { id: string; name: string; email: string; emailVerified: boolean; image?: string | null };
  session: { token: string };
}

async function getSession(cookie: string): Promise<SessionShape | null> {
  const res = await authGet("/get-session", cookie);
  expect(res.status).toBe(200);
  return (await res.json()) as SessionShape | null;
}

/** Link a fake Google account row — the shape better-auth's list-accounts reads. */
async function linkGoogleRow(userId: string) {
  await tdb.db.insert(accounts).values({
    id: randomUUID(),
    accountId: `google-${randomUUID()}`,
    providerId: "google",
    userId,
  });
}

/** Turn a fresh credential signup into a social-only (Google) account. */
async function makeGoogleOnly(userId: string) {
  await linkGoogleRow(userId);
  await tdb.db.delete(accounts).where(eq(accounts.providerId, "credential"));
}

function pngFile(bytes: number, name = "avatar.png", type = "image/png"): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

async function uploadAvatar(cookie: string, file: File | string) {
  const form = new FormData();
  form.set("file", file);
  return req("/api/profile/avatar", { method: "POST", cookie, body: form });
}

beforeAll(async () => {
  tdb = await provisionTestDatabase();
  auth = createAuth({
    db: tdb.db,
    secret: "test-secret-0123456789abcdef",
    appUrl: APP_URL,
    email,
  });
  const deps = { db: tdb.db, auth, integrations } as unknown as AppDeps;
  const authed = new Hono<AppEnv>()
    .use("*", requireAuth(deps))
    .route("/profile", profileRoutes(deps));
  app = new Hono()
    .on(["POST", "GET"], "/api/auth/*", (c) => deps.auth.handler(c.req.raw))
    .route("/api", authed);
}, 120_000);

afterAll(async () => {
  await tdb.cleanup();
});

/* -------------------------------------------------------------------------- */
/* Display name (DisplayNameCard → updateUser)                                */
/* -------------------------------------------------------------------------- */

describe("display name — update-user", () => {
  it("saves a new name and reflects it on the session", async () => {
    const u = await signUp("name");
    const res = await authPost("/update-user", { name: "Renamed Person" }, u.cookie);
    expect(res.status).toBe(200);
    const session = await getSession(u.cookie);
    expect(session?.user.name).toBe("Renamed Person");
  });

  it("rejects an unauthenticated update", async () => {
    const res = await authPost("/update-user", { name: "Ghost" });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

/* -------------------------------------------------------------------------- */
/* Email (EmailCard → changeEmail)                                            */
/* -------------------------------------------------------------------------- */

describe("email — change-email", () => {
  it("rejects changing to the SAME address server-side (mirrors the client-side throw)", async () => {
    const u = await signUp("email-same");
    const res = await authPost("/change-email", { newEmail: u.email }, u.cookie);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { message?: string }).message).toMatch(/same/i);
  });

  it("changing to another user's email answers 200 (anti-enumeration) but never moves the address", async () => {
    const a = await signUp("email-a");
    const b = await signUp("email-b");
    const sentBefore = email.sent.length;
    const res = await authPost("/change-email", { newEmail: a.email }, b.cookie);
    // better-auth deliberately answers success here so the endpoint can't be
    // used to probe which addresses exist…
    expect(res.status).toBe(200);
    // …but nothing changes and no takeover mail goes out.
    expect((await getSession(b.cookie))?.user.email).toBe(b.email);
    expect((await getSession(a.cookie))?.user.email).toBe(a.email);
    expect(email.sent.slice(sentBefore).filter((m) => m.to === a.email)).toEqual([]);
  });

  it("verified account: change stays PENDING and mails the confirmation to the OLD address", async () => {
    const u = await signUp("email-verified");
    // Simulate a verified address (signup leaves it unverified in tests).
    await tdb.db.update(users).set({ emailVerified: true }).where(eq(users.id, u.userId));

    const newEmail = `changed.${randomUUID().slice(0, 8)}@perm.test`;
    const res = await authPost("/change-email", { newEmail, callbackURL: "/settings" }, u.cookie);
    expect(res.status).toBe(200);

    // Address does NOT change until the emailed link is followed — this is the
    // server invariant behind the UI's "Confirm your new address" alert.
    const session = await getSession(u.cookie);
    expect(session?.user.email).toBe(u.email);

    // Confirmation goes to the OLD address (hijacked-session protection).
    await expect
      .poll(() => email.sent.find((m) => m.to === u.email && /email change/i.test(m.subject)))
      .toBeTruthy();
  });

  it("unverified account: change stays PENDING and the verification goes to the NEW address", async () => {
    const u = await signUp("email-unverified");
    const newEmail = `direct.${randomUUID().slice(0, 8)}@perm.test`;
    const res = await authPost("/change-email", { newEmail, callbackURL: "/settings" }, u.cookie);
    expect(res.status).toBe(200);

    // No immediate update — the link in the mail completes the change.
    expect((await getSession(u.cookie))?.user.email).toBe(u.email);
    await expect
      .poll(() =>
        email.sent.find((m) => m.to === newEmail && /confirm your email/i.test(m.subject)),
      )
      .toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- */
/* Password (ChangePasswordCard / SetPasswordCard)                            */
/* -------------------------------------------------------------------------- */

describe("password — change-password", () => {
  it("rejects a wrong current password and leaves the old one working", async () => {
    const u = await signUp("pw-wrong");
    const res = await authPost(
      "/change-password",
      { currentPassword: "not-the-password", newPassword: "brand-new-pass-123" },
      u.cookie,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message?: string };
    expect(body.message).toMatch(/password/i);
    // Old password still signs in; the attempted new one does not.
    await signIn(u.email, u.password);
    const bad = await authPost("/sign-in/email", {
      email: u.email,
      password: "brand-new-pass-123",
    });
    expect(bad.status).toBeGreaterThanOrEqual(400);
  });

  it("rejects a 7-character new password server-side", async () => {
    const u = await signUp("pw-short");
    const res = await authPost(
      "/change-password",
      { currentPassword: u.password, newPassword: "seven77" },
      u.cookie,
    );
    expect(res.status).toBe(400);
    await signIn(u.email, u.password); // unchanged
  });

  it("changes the password and revokeOtherSessions actually ends other devices", async () => {
    const u = await signUp("pw-rotate");
    const otherDevice = await signIn(u.email, u.password);
    expect(await getSession(otherDevice)).not.toBeNull();

    const res = await authPost(
      "/change-password",
      { currentPassword: u.password, newPassword: "rotated-pass-456", revokeOtherSessions: true },
      u.cookie,
    );
    expect(res.status).toBe(200);
    // better-auth rotates the acting session too, handing back a fresh cookie
    // (the browser picks this up transparently) — the OLD acting token dies.
    const rotated = cookieOf(res);
    expect(rotated).not.toBe("");

    expect(await getSession(otherDevice)).toBeNull();
    expect(await getSession(u.cookie)).toBeNull();
    expect(await getSession(rotated)).not.toBeNull();

    // The sessions list the UI refetches now holds only the rotated session.
    const list = await authGet("/list-sessions", rotated);
    expect(list.status).toBe(200);
    expect(((await list.json()) as unknown[]).length).toBe(1);

    // Old password dead, new one live.
    const old = await authPost("/sign-in/email", { email: u.email, password: u.password });
    expect(old.status).toBeGreaterThanOrEqual(400);
    await signIn(u.email, "rotated-pass-456");
  });

  it("social-only account: request-password-reset emails a set-password link", async () => {
    const u = await signUp("pw-social");
    await makeGoogleOnly(u.userId);
    const res = await authPost("/request-password-reset", {
      email: u.email,
      redirectTo: `${APP_URL}/reset-password`,
    });
    expect(res.status).toBe(200);
    await expect
      .poll(() => email.sent.find((m) => m.to === u.email && /reset/i.test(m.subject)))
      .toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- */
/* Sessions (SessionsCard)                                                    */
/* -------------------------------------------------------------------------- */

describe("sessions — list/revoke", () => {
  it("lists every device and revoke-session ends exactly the targeted one", async () => {
    const u = await signUp("sess");
    const other = await signIn(u.email, u.password);
    const otherToken = (await getSession(other))!.session.token;

    const list = await authGet("/list-sessions", u.cookie);
    const rows = (await list.json()) as { token: string }[];
    expect(rows.length).toBe(2);
    expect(rows.map((r) => r.token)).toContain(otherToken);

    const res = await authPost("/revoke-session", { token: otherToken }, u.cookie);
    expect(res.status).toBe(200);

    expect(await getSession(other)).toBeNull();
    expect(await getSession(u.cookie)).not.toBeNull();
    const after = (await (await authGet("/list-sessions", u.cookie)).json()) as unknown[];
    expect(after.length).toBe(1);
  });

  it("revoke-other-sessions keeps only the current device", async () => {
    const u = await signUp("sess-rest");
    const b = await signIn(u.email, u.password);
    const c = await signIn(u.email, u.password);

    const res = await authPost("/revoke-other-sessions", {}, u.cookie);
    expect(res.status).toBe(200);

    expect(await getSession(b)).toBeNull();
    expect(await getSession(c)).toBeNull();
    expect(await getSession(u.cookie)).not.toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Connected accounts (ConnectedAccountsCard) — the variant axis              */
/* -------------------------------------------------------------------------- */

describe("linked accounts — credential / google / both variants", () => {
  it("credential-only: list-accounts reports exactly one credential provider", async () => {
    const u = await signUp("acct-cred");
    const res = await authGet("/list-accounts", u.cookie);
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { providerId: string }[];
    expect(rows.map((r) => r.providerId)).toEqual(["credential"]);
  });

  it("credential-only: unlinking the last (credential) method is refused", async () => {
    const u = await signUp("acct-last");
    const res = await authPost("/unlink-account", { providerId: "credential" }, u.cookie);
    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = (await res.json()) as { message?: string };
    expect(body.message).toMatch(/last account/i);
    const rows = (await (await authGet("/list-accounts", u.cookie)).json()) as unknown[];
    expect(rows.length).toBe(1); // still there
  });

  it("both methods: google unlinks cleanly and credential remains", async () => {
    const u = await signUp("acct-both");
    await linkGoogleRow(u.userId);

    const before = (await (await authGet("/list-accounts", u.cookie)).json()) as {
      providerId: string;
    }[];
    expect(before.map((r) => r.providerId).sort()).toEqual(["credential", "google"]);

    const res = await authPost("/unlink-account", { providerId: "google" }, u.cookie);
    expect(res.status).toBe(200);

    const after = (await (await authGet("/list-accounts", u.cookie)).json()) as {
      providerId: string;
    }[];
    expect(after.map((r) => r.providerId)).toEqual(["credential"]);
  });

  it("google-only: unlinking google (the only method) is refused — the UI's disabled button mirrors this", async () => {
    const u = await signUp("acct-google");
    await makeGoogleOnly(u.userId);

    const res = await authPost("/unlink-account", { providerId: "google" }, u.cookie);
    expect(res.status).toBeGreaterThanOrEqual(400);
    const rows = (await (await authGet("/list-accounts", u.cookie)).json()) as {
      providerId: string;
    }[];
    expect(rows.map((r) => r.providerId)).toEqual(["google"]);
  });
});

/* -------------------------------------------------------------------------- */
/* Delete account (DangerCard)                                                */
/* -------------------------------------------------------------------------- */

describe("delete account — delete-user", () => {
  it("wrong password: refused, account and session intact", async () => {
    const u = await signUp("del-wrong");
    const res = await authPost("/delete-user", { password: "not-my-password" }, u.cookie);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await getSession(u.cookie)).not.toBeNull();
    const row = await tdb.db.query.users.findFirst({ where: eq(users.id, u.userId) });
    expect(row).toBeTruthy();
  });

  it("credential account + correct password: user, sessions and accounts are gone", async () => {
    const u = await signUp("del-ok");
    const res = await authPost("/delete-user", { password: u.password }, u.cookie);
    expect(res.status).toBe(200);

    expect(await getSession(u.cookie)).toBeNull();
    expect(await tdb.db.query.users.findFirst({ where: eq(users.id, u.userId) })).toBeUndefined();
    expect(
      await tdb.db.query.sessions.findFirst({ where: eq(sessions.userId, u.userId) }),
    ).toBeUndefined();
    expect(
      await tdb.db.query.accounts.findFirst({ where: eq(accounts.userId, u.userId) }),
    ).toBeUndefined();

    // Sign-in afterwards fails — the account truly no longer exists.
    const back = await authPost("/sign-in/email", { email: u.email, password: u.password });
    expect(back.status).toBeGreaterThanOrEqual(400);
  });

  it("social-only account: deletes without a password on a fresh session", async () => {
    const u = await signUp("del-social");
    await makeGoogleOnly(u.userId);
    const res = await authPost("/delete-user", {}, u.cookie);
    expect(res.status).toBe(200);
    expect(await tdb.db.query.users.findFirst({ where: eq(users.id, u.userId) })).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* Avatar (AvatarCard → /api/profile/avatar)                                  */
/* -------------------------------------------------------------------------- */

describe("avatar — upload/serve/remove", () => {
  it("requires authentication on every verb", async () => {
    const post = await uploadAvatar("", pngFile(10));
    expect(post.status).toBe(401);
    const del = await req("/api/profile/avatar", { method: "DELETE" });
    expect(del.status).toBe(401);
    const get = await req("/api/profile/avatar/u/x.png", { method: "GET" });
    expect(get.status).toBe(401);
  });

  it("422 NO_FILE when the multipart field is missing or not a file", async () => {
    const u = await signUp("av-nofile");
    const empty = new FormData();
    empty.set("note", "no file here");
    const res = await req("/api/profile/avatar", { method: "POST", cookie: u.cookie, body: empty });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("NO_FILE");

    const stringField = await uploadAvatar(u.cookie, "just-a-string");
    expect(stringField.status).toBe(422);
    expect(((await stringField.json()) as { error: { code: string } }).error.code).toBe("NO_FILE");
  });

  it("422 UNSUPPORTED_TYPE for a non-image file", async () => {
    const u = await signUp("av-type");
    const res = await uploadAvatar(u.cookie, pngFile(10, "notes.txt", "text/plain"));
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("UNSUPPORTED_TYPE");
  });

  it("422 EMPTY_FILE for a zero-byte image", async () => {
    const u = await signUp("av-empty");
    const res = await uploadAvatar(u.cookie, pngFile(0));
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("EMPTY_FILE");
  });

  it("422 TOO_LARGE just past the 5 MB boundary; exactly 5 MB is accepted", async () => {
    const u = await signUp("av-size");
    const over = await uploadAvatar(u.cookie, pngFile(5 * 1024 * 1024 + 1));
    expect(over.status).toBe(422);
    expect(((await over.json()) as { error: { code: string } }).error.code).toBe("TOO_LARGE");

    const exact = await uploadAvatar(u.cookie, pngFile(5 * 1024 * 1024));
    expect(exact.status).toBe(201);
  });

  it("valid upload: 201, user.image set, bytes stored and served with the right mime", async () => {
    const u = await signUp("av-ok");
    const res = await uploadAvatar(u.cookie, pngFile(64, "me.png", "image/png"));
    expect(res.status).toBe(201);
    const { image } = (await res.json()) as { image: string };
    expect(image).toMatch(new RegExp(`^/api/profile/avatar/${u.userId}/[0-9a-f-]{36}\\.png$`));

    const session = await getSession(u.cookie);
    expect(session?.user.image).toBe(image);

    // Stored under the user's namespace…
    const key = `avatars/${u.userId}/${image.split("/").pop()}`;
    expect(storage.files.has(key)).toBe(true);

    // …and served back to any signed-in member (avatars are member-visible).
    const viewer = await signUp("av-viewer");
    const got = await req(image, { method: "GET", cookie: viewer.cookie });
    expect(got.status).toBe(200);
    expect(got.headers.get("content-type")).toBe("image/png");
    expect((await got.arrayBuffer()).byteLength).toBe(64);
  });

  it("gif and webp uploads keep their type through storage and serving", async () => {
    const u = await signUp("av-formats");
    for (const [type, ext] of [
      ["image/webp", "webp"],
      ["image/gif", "gif"],
    ] as const) {
      const res = await uploadAvatar(u.cookie, pngFile(32, `pic.${ext}`, type));
      expect(res.status).toBe(201);
      const { image } = (await res.json()) as { image: string };
      expect(image.endsWith(`.${ext}`)).toBe(true);
      const got = await req(image, { method: "GET", cookie: u.cookie });
      expect(got.headers.get("content-type")).toBe(type);
    }
  });

  it("replacing the avatar deletes the previous stored file", async () => {
    const u = await signUp("av-replace");
    const first = await uploadAvatar(u.cookie, pngFile(16));
    const firstImage = ((await first.json()) as { image: string }).image;
    const firstKey = `avatars/${u.userId}/${firstImage.split("/").pop()}`;
    expect(storage.files.has(firstKey)).toBe(true);

    const second = await uploadAvatar(u.cookie, pngFile(24, "new.webp", "image/webp"));
    expect(second.status).toBe(201);
    const secondImage = ((await second.json()) as { image: string }).image;
    expect(secondImage).not.toBe(firstImage);

    // Old bytes cleaned up, new bytes present, session points at the new URL.
    expect(storage.files.has(firstKey)).toBe(false);
    expect(storage.files.has(`avatars/${u.userId}/${secondImage.split("/").pop()}`)).toBe(true);
    expect((await getSession(u.cookie))?.user.image).toBe(secondImage);
  });

  it("DELETE clears user.image and removes the stored file", async () => {
    const u = await signUp("av-del");
    const up = await uploadAvatar(u.cookie, pngFile(16));
    const image = ((await up.json()) as { image: string }).image;
    const key = `avatars/${u.userId}/${image.split("/").pop()}`;

    const res = await req("/api/profile/avatar", { method: "DELETE", cookie: u.cookie });
    expect(res.status).toBe(200);
    expect((await res.json()) as { ok: boolean }).toEqual({ ok: true });

    expect(storage.files.has(key)).toBe(false);
    expect((await getSession(u.cookie))?.user.image ?? null).toBeNull();
  });

  it("serving 404s on unknown extensions, missing files and traversal shapes", async () => {
    const u = await signUp("av-404");
    const cases = [
      `/api/profile/avatar/${u.userId}/nope.txt`, // extension not in the allowlist
      `/api/profile/avatar/${u.userId}/${randomUUID()}.png`, // valid shape, nothing stored
      `/api/profile/avatar/${u.userId}/..%2Fsecret.png`, // encoded traversal
    ];
    for (const path of cases) {
      const res = await req(path, { method: "GET", cookie: u.cookie });
      expect(res.status).toBe(404);
    }
  });
});
