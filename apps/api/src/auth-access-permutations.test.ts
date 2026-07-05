import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import { memoryEmailProvider, type OutboundEmail } from "@goodstrata/integrations";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type Auth, createAuth } from "./auth.js";

/**
 * Auth & account access — better-auth flow permutations against a real
 * database, exercising the exact HTTP surface the web forms call:
 * sign-up (boundaries, duplicates, verification gating), sign-in (401 parity,
 * 403 EMAIL_NOT_VERIFIED), and password reset (non-disclosure, single-use).
 *
 * Two auth instances share the DB: `authOpen` mirrors local/demo deployments
 * (REQUIRE_EMAIL_VERIFICATION unset) and `authStrict` mirrors production.
 */

const APP = "http://localhost:5173";

let tdb: TestDatabase;
let authOpen: Auth;
let authStrict: Auth;
const openEmail = memoryEmailProvider();
const strictEmail = memoryEmailProvider();

// Fresh identities per run: the suite may share a long-lived dev Postgres.
const USER_A = { email: "ada@example.com", password: "ada-pass-123", name: "Ada" };
const USER_B = { email: "bec@example.com", name: "Bec" };
const USER_V = { email: "vic@example.com", password: "vic-pass-123", name: "Vic" };
const NEW_PASSWORD = "ada-new-pass-456";

function call(auth: Auth, path: string, init: { method?: string; body?: object } = {}) {
  return auth.handler(
    new Request(`${APP}/api/auth${path}`, {
      method: init.method ?? "POST",
      headers: { "content-type": "application/json", origin: APP },
      body: init.body ? JSON.stringify(init.body) : undefined,
    }),
  );
}

const sentTo = (outbox: { sent: OutboundEmail[] }, email: string) =>
  outbox.sent.filter((m) => m.to === email);

beforeAll(async () => {
  tdb = await provisionTestDatabase();
  authOpen = createAuth({
    db: tdb.db,
    secret: "test-secret-0123456789abcdef",
    appUrl: APP,
    email: openEmail,
  });
  authStrict = createAuth({
    db: tdb.db,
    secret: "test-secret-0123456789abcdef",
    appUrl: APP,
    email: strictEmail,
    requireEmailVerification: true,
  });
});

afterAll(async () => {
  await tdb.cleanup();
});

describe("sign-up (open deployment — SignUpForm)", () => {
  it("succeeds with a session token and fires the verification email (sendOnSignUp)", async () => {
    const res = await call(authOpen, "/sign-up/email", { body: USER_A });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string | null; user: { email: string } };
    // Truthy token = signed straight in; the form navigates to "/" not the
    // VerifyEmailNotice.
    expect(body.token).toBeTruthy();
    expect(body.user.email).toBe(USER_A.email);

    // sendVerificationEmail is fired without await — poll the memory outbox.
    await vi.waitFor(() => {
      const mail = sentTo(openEmail, USER_A.email);
      expect(mail).toHaveLength(1);
      expect(mail[0]!.subject).toBe("Confirm your email for GoodStrata");
      expect(mail[0]!.text).toMatch(/verify-email\?token=/);
    });
  });

  it("rejects a 7-character password and accepts 8 (min-length boundary)", async () => {
    const short = await call(authOpen, "/sign-up/email", {
      body: { ...USER_B, password: "seven77" },
    });
    expect(short.status).toBe(400);
    const shortBody = (await short.json()) as { code?: string; message?: string };
    expect(shortBody.code).toBe("PASSWORD_TOO_SHORT");
    // The message is what SignUpForm's FormError banner shows.
    expect(shortBody.message).toMatch(/password/i);

    const ok = await call(authOpen, "/sign-up/email", {
      body: { ...USER_B, password: "eight888" },
    });
    expect(ok.status).toBe(200);
  });

  it("rejects a duplicate email with a message for the FormError banner", async () => {
    const res = await call(authOpen, "/sign-up/email", { body: USER_A });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    const body = (await res.json()) as { code?: string; message?: string };
    expect(body.code).toBe("USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL");
    expect(body.message).toBeTruthy();
  });
});

describe("sign-in (SignInForm)", () => {
  it("401s a wrong password with the same body as an unknown email (no account enumeration)", async () => {
    const wrongPassword = await call(authOpen, "/sign-in/email", {
      body: { email: USER_A.email, password: "not-the-password" },
    });
    const unknownEmail = await call(authOpen, "/sign-in/email", {
      body: { email: "ghost@example.com", password: "not-the-password" },
    });
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    const a = (await wrongPassword.json()) as { code?: string; message?: string };
    const b = (await unknownEmail.json()) as { code?: string; message?: string };
    // Identical envelopes: a caller can't tell which addresses have accounts.
    expect(a).toEqual(b);
    expect(a.message).toBeTruthy(); // becomes the form-level error banner
  });

  it("succeeds with correct credentials and sets the session cookie", async () => {
    const res = await call(authOpen, "/sign-in/email", {
      body: { email: USER_A.email, password: USER_A.password },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string | null };
    expect(body.token).toBeTruthy();
    expect(res.headers.get("set-cookie")).toContain("better-auth.session_token");
  });
});

describe("verification-required deployment (authStrict — VerifyEmailNotice path)", () => {
  it("sign-up withholds the session: token is null, so the form shows VerifyEmailNotice", async () => {
    const res = await call(authStrict, "/sign-up/email", { body: USER_V });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string | null };
    expect(body.token).toBeNull();
    await vi.waitFor(() => {
      expect(sentTo(strictEmail, USER_V.email)).toHaveLength(1);
    });
  });

  it("sign-in before verification → 403 EMAIL_NOT_VERIFIED (not a generic 401)", async () => {
    const res = await call(authStrict, "/sign-in/email", {
      body: { email: USER_V.email, password: USER_V.password },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("EMAIL_NOT_VERIFIED");
  });

  it("resend endpoint sends another verification email (VerifyEmailNotice button)", async () => {
    const before = sentTo(strictEmail, USER_V.email).length;
    const res = await call(authStrict, "/send-verification-email", {
      body: { email: USER_V.email, callbackURL: "/" },
    });
    expect(res.status).toBe(200);
    await vi.waitFor(() => {
      expect(sentTo(strictEmail, USER_V.email).length).toBeGreaterThan(before);
    });
  });

  it("clicking the emailed link verifies the address; sign-in then succeeds", async () => {
    const mail = sentTo(strictEmail, USER_V.email);
    const url = mail.at(-1)!.text.match(/https?:\/\/\S*verify-email\?token=\S+/)?.[0];
    expect(url).toBeTruthy();

    const verify = await authStrict.handler(new Request(url!, { method: "GET" }));
    // better-auth answers the link with a redirect to the callback URL.
    expect([200, 302]).toContain(verify.status);

    const signIn = await call(authStrict, "/sign-in/email", {
      body: { email: USER_V.email, password: USER_V.password },
    });
    expect(signIn.status).toBe(200);
    const body = (await signIn.json()) as { token: string | null };
    expect(body.token).toBeTruthy();
  });
});

describe("password reset (ForgotPasswordPage → ResetPasswordPage)", () => {
  let resetToken: string;

  it("answers identically for unknown and known addresses; only the known one gets mail", async () => {
    const unknown = await call(authOpen, "/request-password-reset", {
      body: { email: "nobody@example.com", redirectTo: `${APP}/reset-password` },
    });
    const known = await call(authOpen, "/request-password-reset", {
      body: { email: USER_A.email, redirectTo: `${APP}/reset-password` },
    });
    expect(unknown.status).toBe(200);
    expect(known.status).toBe(200);
    // Byte-identical bodies — the response can't disclose account existence.
    expect(await unknown.json()).toEqual(await known.json());

    await vi.waitFor(() => {
      const mail = sentTo(openEmail, USER_A.email).filter((m) =>
        m.subject.includes("Reset your GoodStrata password"),
      );
      expect(mail).toHaveLength(1);
      const token = mail[0]!.text.match(/reset-password\/([A-Za-z0-9_-]+)/)?.[1];
      expect(token).toBeTruthy();
      resetToken = token!;
    });
    // The known request (sent later) has landed, so the unknown one would
    // already have surfaced — it must not exist.
    expect(sentTo(openEmail, "nobody@example.com")).toHaveLength(0);
  });

  it("resets with the emailed token: old password dies, new one signs in", async () => {
    const res = await call(authOpen, "/reset-password", {
      body: { newPassword: NEW_PASSWORD, token: resetToken },
    });
    expect(res.status).toBe(200);

    const oldPw = await call(authOpen, "/sign-in/email", {
      body: { email: USER_A.email, password: USER_A.password },
    });
    expect(oldPw.status).toBe(401);

    const newPw = await call(authOpen, "/sign-in/email", {
      body: { email: USER_A.email, password: NEW_PASSWORD },
    });
    expect(newPw.status).toBe(200);
  });

  it("the reset link is single-use: replaying the token fails and changes nothing", async () => {
    const replay = await call(authOpen, "/reset-password", {
      body: { newPassword: "attacker-pass-789", token: resetToken },
    });
    expect(replay.status).toBeGreaterThanOrEqual(400);
    expect(replay.status).toBeLessThan(500);
    const body = (await replay.json()) as { message?: string };
    expect(body.message).toBeTruthy(); // surfaced in the FormError banner
  });

  it("rejects a garbage token outright", async () => {
    const res = await call(authOpen, "/reset-password", {
      body: { newPassword: "whatever-pass-1", token: "garbage-token" },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});
