import type { OutboundEmail } from "@goodstrata/integrations";
import { Hono } from "hono";
import type { AppDeps } from "../deps.js";

/**
 * Dev/e2e-only helpers, mounted ONLY when EMAIL_PROVIDER=memory (never in
 * production). /dev/outbox lets tests read invite links and notices that
 * would otherwise be emailed.
 */
export function devRoutes(deps: AppDeps) {
  return new Hono().get("/outbox", (c) => {
    const email = deps.integrations.email as { sent?: OutboundEmail[] };
    return c.json({ emails: email.sent ?? [] });
  });
}
