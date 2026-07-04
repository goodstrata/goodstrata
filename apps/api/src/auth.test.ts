import type { Database } from "@goodstrata/db";
import type { EmailProvider } from "@goodstrata/integrations";
import { describe, expect, it } from "vitest";
import { createAuth } from "./auth.js";

// createAuth never touches the database at construction (better-auth's context
// is lazy), so a bare stub is enough to assert which providers get registered.
const db = {} as unknown as Database;

const email: EmailProvider = {
  name: "test",
  send: async () => ({ providerMessageId: "test" }),
};

function makeAuth(google?: { clientId: string; clientSecret: string }) {
  return createAuth({
    db,
    secret: "test-secret-0123456789abcdef",
    appUrl: "http://localhost:5173",
    email,
    google,
  });
}

describe("createAuth — Google social provider", () => {
  it("registers google when clientId/clientSecret are supplied", () => {
    const auth = makeAuth({ clientId: "test-client-id", clientSecret: "test-client-secret" });
    expect(Object.keys(auth.options.socialProviders ?? {})).toEqual(["google"]);
  });

  it("registers no social providers without google config", () => {
    const auth = makeAuth();
    expect(auth.options.socialProviders ?? {}).toEqual({});
  });

  it("rejects /sign-in/social for google when the provider is not configured", async () => {
    const auth = makeAuth();
    const res = await auth.handler(
      new Request("http://localhost:5173/api/auth/sign-in/social", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:5173",
        },
        body: JSON.stringify({ provider: "google", callbackURL: "/" }),
      }),
    );
    // better-auth answers 4xx ("Provider not found") without touching the DB —
    // the stub db proves no query was attempted.
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it("links a matching-email Google sign-in to an existing account (trustedProviders)", () => {
    const auth = makeAuth({ clientId: "id", clientSecret: "secret" });
    expect(auth.options.account?.accountLinking?.enabled).toBe(true);
    expect(auth.options.account?.accountLinking?.trustedProviders).toContain("google");
  });
});
