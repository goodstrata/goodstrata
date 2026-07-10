/**
 * Two-phase preview→confirm tokens for the GOVERNED MCP tools (`mcp:govern`).
 *
 * A governed tool called WITHOUT a confirm token runs a genuine dry-run (pure
 * reads + pure engines, never a mutation) and returns exactly what WOULD
 * happen plus a short-lived signed token. Called WITH the token, the tool
 * verifies the SAME user is confirming the SAME tool with the SAME arguments
 * inside the expiry window, then executes for real.
 *
 * The token is stateless — HMAC-SHA256 over { tool, canonical-args hash,
 * user id, expiry } with a secret from env (MCP_CONFIRM_SECRET, falling back
 * to BETTER_AUTH_SECRET) — so there is no DB table to migrate or clean up.
 * The token itself is deliberately NOT single-use: every governed service call
 * is idempotency-guarded at the domain layer (ALREADY_ISSUED, NOTICE_SENT,
 * ALREADY_VOTED, ALREADY_RESOLVED, ALREADY_CLOSED), so a replayed confirm
 * cannot double-execute — it surfaces the domain conflict instead.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { DomainError } from "@goodstrata/core";
import type { AppDeps } from "../deps.js";
import type { McpAuth } from "./auth.js";

/**
 * How long a preview stays confirmable. Short on purpose: the dry-run is a
 * snapshot of live state (tallies, arrears, recipients), and a stale preview
 * must not authorise an execution the officer never saw.
 */
export const CONFIRM_TTL_MS = 10 * 60 * 1000;

const RE_PREVIEW =
  "Call the tool again WITHOUT confirmToken to get a fresh preview and a new token.";

interface ConfirmPayload {
  v: 1;
  tool: string;
  user: string;
  /** SHA-256 of the canonicalized tool arguments (confirmToken excluded). */
  args: string;
  /** Expiry, epoch milliseconds. */
  exp: number;
}

/**
 * Deterministic JSON: object keys sorted recursively (arrays keep order,
 * `undefined` members dropped — matching JSON.stringify semantics) so the
 * hash is stable regardless of the property order the client sent.
 */
function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function argsHash(args: unknown): string {
  return createHash("sha256").update(canonicalize(args)).digest("hex");
}

function secretOf(deps: AppDeps): string {
  return deps.env.MCP_CONFIRM_SECRET ?? deps.env.BETTER_AUTH_SECRET;
}

function sign(secret: string, payloadB64: string): string {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

function invalidToken(): DomainError {
  return new DomainError("CONFIRM_INVALID", `Confirm token is not valid. ${RE_PREVIEW}`, 403);
}

/** Mint the confirm token a governed tool returns alongside its dry-run. */
export function issueConfirmToken(
  deps: AppDeps,
  auth: McpAuth,
  tool: string,
  args: unknown,
): { confirmToken: string; confirmTokenExpiresAt: string } {
  const exp = deps.clock.now().getTime() + CONFIRM_TTL_MS;
  const payload: ConfirmPayload = { v: 1, tool, user: auth.userId, args: argsHash(args), exp };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return {
    confirmToken: `${payloadB64}.${sign(secretOf(deps), payloadB64)}`,
    confirmTokenExpiresAt: new Date(exp).toISOString(),
  };
}

/**
 * Verify a confirm token against the CURRENT call. Throws a DomainError —
 * surfaced by `guard` as a tool error telling the model to re-preview — on:
 * - CONFIRM_INVALID: malformed token or bad signature;
 * - CONFIRM_EXPIRED: past its TTL;
 * - CONFIRM_MISMATCH: minted for a different tool, arguments, or user.
 */
export function verifyConfirmToken(
  deps: AppDeps,
  auth: McpAuth,
  tool: string,
  args: unknown,
  token: string,
): void {
  const parts = token.split(".");
  const [payloadB64, sig] = parts;
  if (parts.length !== 2 || !payloadB64 || !sig) throw invalidToken();

  const expected = Buffer.from(sign(secretOf(deps), payloadB64));
  const provided = Buffer.from(sig);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    throw invalidToken();
  }

  let payload: ConfirmPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as ConfirmPayload;
  } catch {
    throw invalidToken();
  }
  if (payload.v !== 1) throw invalidToken();

  if (deps.clock.now().getTime() > payload.exp) {
    throw new DomainError(
      "CONFIRM_EXPIRED",
      `Confirm token has expired — the preview it authorised is stale. ${RE_PREVIEW}`,
      409,
    );
  }
  if (payload.tool !== tool || payload.user !== auth.userId || payload.args !== argsHash(args)) {
    throw new DomainError(
      "CONFIRM_MISMATCH",
      `Confirm token does not match this call — the tool, its arguments, or the caller changed since the preview. ${RE_PREVIEW}`,
      409,
    );
  }
}
