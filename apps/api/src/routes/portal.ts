// Public, PRE-AUTH contractor self-service portal.
//
// Mounted OUTSIDE requireAuth (beside publicInviteRoutes) — a contractor who
// received an RFQ or work-order email has no account; the unguessable token in
// the path is the sole credential. Every handler runs under a `system` actor
// and derives schemeId / rfqId / contractorId FROM THE TOKEN, never the body.
//
// Two token families:
//   /api/quote/:token       — GET preview + POST submit a quote (per rfq-channel)
//   /api/work-order/:token  — GET preview + POST accept | decline (per work order)
import { submitQuoteByTokenInput, tradeRfqService } from "@goodstrata/core";
import { Hono } from "hono";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { zv } from "../validate.js";

// ---------------------------------------------------------------------------
// Rate limiting — per-IP + global sliding window, copied from estimator.ts.
// Public unauthenticated POST/GET surface, so token-guessing and quote spam are
// both blunted. Deployed behind Cloudflare, so `cf-connecting-ip` is trusted.
// ---------------------------------------------------------------------------

const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
/** Writes (submit quote / accept / decline) — tight. */
const POST_LIMIT = 20;
/** Reads (previews) — looser, but still bounded so tokens can't be probed at scale. */
const GET_LIMIT = 120;
/** Global backstop across ALL callers, sized well above one instance's real traffic. */
const GLOBAL_LIMIT = 2000;
/**
 * Per-IP cap on FAILED token look-ups (404s). A single IP rotating guessed
 * tokens trips this long before it could brute-force 192 bits — a second
 * throttle independent of the request-rate windows above.
 */
const FAILED_LOOKUP_LIMIT = 30;

const postHits = new Map<string, number[]>();
const getHits = new Map<string, number[]>();
const failHits = new Map<string, number[]>();
let globalHits: number[] = [];

function withinWindow(times: number[] | undefined, now: number): number[] {
  return (times ?? []).filter((t) => now - t < RATE_WINDOW_MS);
}

function pruneIfLarge(map: Map<string, number[]>, now: number): void {
  if (map.size <= 5000) return;
  for (const [key, times] of map) {
    if (times.every((t) => now - t >= RATE_WINDOW_MS)) map.delete(key);
  }
}

/** Returns true when this request should be rejected (429). */
function rateLimited(map: Map<string, number[]>, limit: number, ip: string, now: number): boolean {
  globalHits = globalHits.filter((t) => now - t < RATE_WINDOW_MS);
  if (globalHits.length >= GLOBAL_LIMIT) return true;

  const recent = withinWindow(map.get(ip), now);
  if (recent.length >= limit) {
    map.set(ip, recent);
    return true;
  }
  recent.push(now);
  map.set(ip, recent);
  globalHits.push(now);
  pruneIfLarge(map, now);
  return false;
}

/** True once an IP has burned through too many invalid-token look-ups. */
function tooManyFailures(ip: string, now: number): boolean {
  return withinWindow(failHits.get(ip), now).length >= FAILED_LOOKUP_LIMIT;
}

function recordFailure(ip: string, now: number): void {
  const recent = withinWindow(failHits.get(ip), now);
  recent.push(now);
  failHits.set(ip, recent);
  pruneIfLarge(failHits, now);
}

/**
 * Client IP from a TRUSTED, proxy-set source. The leftmost X-Forwarded-For
 * token is client-controlled (spoofable → a fresh limiter key per request), so
 * prefer Cloudflare's `cf-connecting-ip`, then `x-real-ip`, then the RIGHTMOST
 * XFF entry — never the leftmost. Identical to estimator.ts.
 */
function clientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  const cf = c.req.header("cf-connecting-ip");
  if (cf?.trim()) return cf.trim();
  const real = c.req.header("x-real-ip");
  if (real?.trim()) return real.trim();
  const fwd = c.req.header("x-forwarded-for");
  if (fwd) {
    const parts = fwd
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1]!;
  }
  return "unknown";
}

const RATE_LIMITED = {
  error: { code: "RATE_LIMITED", message: "Too many requests. Try again shortly." },
} as const;

/**
 * True → a thrown error is a token-resolution miss (invalid/unknown token).
 * These are counted toward the per-IP failed-look-up cap; everything else
 * (validation 422, already-quoted 409, RFQ-closed 409) is a legitimate outcome.
 */
function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown; status?: unknown }).code === "NOT_FOUND"
  );
}

export function publicQuoteRoutes(deps: AppDeps) {
  return new Hono()
    .get("/:token", async (c) => {
      const now = Date.now();
      const ip = clientIp(c);
      if (tooManyFailures(ip, now) || rateLimited(getHits, GET_LIMIT, ip, now)) {
        return c.json(RATE_LIMITED, 429);
      }
      const ctx = deps.serviceContext({ kind: "system", id: "quote-portal" });
      try {
        return c.json(await tradeRfqService.getRfqByQuoteToken(ctx, c.req.param("token")));
      } catch (err) {
        if (isNotFound(err)) recordFailure(ip, now);
        throw err;
      }
    })
    .post("/:token", zv("json", submitQuoteByTokenInput), async (c) => {
      const now = Date.now();
      const ip = clientIp(c);
      if (tooManyFailures(ip, now) || rateLimited(postHits, POST_LIMIT, ip, now)) {
        return c.json(RATE_LIMITED, 429);
      }
      const ctx = deps.serviceContext({ kind: "system", id: "quote-portal" });
      try {
        const quote = await tradeRfqService.submitQuoteByToken(
          ctx,
          c.req.param("token"),
          c.req.valid("json"),
        );
        return c.json({ quote }, 201);
      } catch (err) {
        if (isNotFound(err)) recordFailure(ip, now);
        throw err;
      }
    });
}

const workOrderActionInput = z.object({ action: z.enum(["accept", "decline"]) });

export function publicWorkOrderRoutes(deps: AppDeps) {
  return new Hono()
    .get("/:token", async (c) => {
      const now = Date.now();
      const ip = clientIp(c);
      if (tooManyFailures(ip, now) || rateLimited(getHits, GET_LIMIT, ip, now)) {
        return c.json(RATE_LIMITED, 429);
      }
      const ctx = deps.serviceContext({ kind: "system", id: "wo-accept" });
      try {
        return c.json(await tradeRfqService.getWorkOrderByAcceptToken(ctx, c.req.param("token")));
      } catch (err) {
        if (isNotFound(err)) recordFailure(ip, now);
        throw err;
      }
    })
    .post("/:token", zv("json", workOrderActionInput), async (c) => {
      const now = Date.now();
      const ip = clientIp(c);
      if (tooManyFailures(ip, now) || rateLimited(postHits, POST_LIMIT, ip, now)) {
        return c.json(RATE_LIMITED, 429);
      }
      const ctx = deps.serviceContext({ kind: "system", id: "wo-accept" });
      const token = c.req.param("token");
      try {
        const result =
          c.req.valid("json").action === "accept"
            ? await tradeRfqService.acceptWorkOrderByToken(ctx, token)
            : await tradeRfqService.declineWorkOrderByToken(ctx, token);
        return c.json({ workOrder: result });
      } catch (err) {
        if (isNotFound(err)) recordFailure(ip, now);
        throw err;
      }
    });
}
