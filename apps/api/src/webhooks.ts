import { createHash } from "node:crypto";
import { DomainError, paymentsService } from "@goodstrata/core";
import { webhookEvents } from "@goodstrata/db";
import { systemActor } from "@goodstrata/shared";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { AppDeps } from "./deps.js";

/**
 * Inbound payment webhooks. Outside auth; authenticity comes from the
 * provider signature; replays are absorbed by the webhook_events ledger and
 * the payments (provider, providerRef) unique key.
 *
 * Delivery contract (money must never be silently dropped):
 *  - bad signature            → 401, event recorded (signatureValid=false)
 *  - unparseable payload      → 400, event recorded, left unprocessed
 *  - invalid amount/currency  → 200 {rejected}, event recorded, left unprocessed
 *  - unattributable scheme    → 200 {parked}, event recorded, left unprocessed —
 *    a provider retry (or a later levy issue) reprocesses it, since a REPLAY of
 *    an event that never finished processing is retried, not skipped
 *  - transient processing err → 500 so the provider retries; the retry heals
 *  - success                  → processedAt stamped; true replays return {duplicate}
 */
export function paymentWebhookRoutes(deps: AppDeps) {
  return new Hono().post("/payments/:provider", async (c) => {
    const providerName = c.req.param("provider");
    const provider = deps.integrations.payments;
    if (providerName !== provider.name) {
      return c.json({ error: { code: "UNKNOWN_PROVIDER", message: "Unknown provider" } }, 404);
    }

    const rawBody = await c.req.text();
    const signature = c.req.header(provider.signatureHeader ?? "x-signature");
    const valid = provider.verifyWebhook(rawBody, signature);
    if (!valid) {
      console.warn(
        `[webhooks] ${providerName}: signature verification failed (signature ${signature ? "present" : "missing"})`,
      );
    }

    let inbound: ReturnType<typeof provider.parseWebhook> | null = null;
    let parseError: unknown = null;
    if (valid) {
      try {
        inbound = provider.parseWebhook(rawBody);
      } catch (err) {
        parseError = err;
      }
    }
    const providerEventId = inbound?.providerRef ?? sha(rawBody);

    const inserted = await deps.db
      .insert(webhookEvents)
      .values({
        provider: providerName,
        providerEventId,
        signatureValid: valid,
        payload: inbound?.raw ?? rawBody,
      })
      .onConflictDoNothing()
      .returning({ id: webhookEvents.id });

    if (!valid) {
      return c.json({ error: { code: "BAD_SIGNATURE", message: "Signature invalid" } }, 401);
    }
    if (parseError) {
      console.error(`[webhooks] ${providerName}: unparseable payload`, parseError);
      return c.json({ error: { code: "BAD_PAYLOAD", message: "Payload unparseable" } }, 400);
    }

    let eventId = inserted[0]?.id;
    if (!eventId) {
      // Replay. Only skip if the original delivery actually FINISHED —
      // otherwise the retry is our chance to recover the payment.
      const existing = await deps.db.query.webhookEvents.findFirst({
        where: and(
          eq(webhookEvents.provider, providerName),
          eq(webhookEvents.providerEventId, providerEventId),
        ),
      });
      if (existing?.processedAt) {
        return c.json({ ok: true, duplicate: true }); // replay — already handled
      }
      eventId = existing?.id;
    }

    const ctx = deps.serviceContext(systemActor(`webhook:${providerName}`));
    try {
      const result = await paymentsService.recordInboundPayment(ctx, providerName, inbound!);

      if (eventId) {
        await deps.db
          .update(webhookEvents)
          .set({ processedAt: deps.clock.now() })
          .where(eq(webhookEvents.id, eventId));
      }

      return c.json({ ok: true, matched: result.matched, duplicate: result.duplicate ?? false });
    } catch (err) {
      if (err instanceof DomainError && err.code === "UNATTRIBUTABLE_PAYMENT") {
        // Real money we can't yet attribute to a scheme. The payload is on the
        // ledger (unprocessed) and surfaces in the status count; ack so the
        // provider stops hammering — a later replay/retry can still heal it.
        console.error(`[webhooks] ${providerName}: unattributable payment parked`, err.message);
        return c.json({ ok: true, parked: true });
      }
      if (err instanceof DomainError && err.code === "INVALID_PAYMENT") {
        console.error(`[webhooks] ${providerName}: invalid payment rejected`, err.message);
        return c.json({ ok: true, rejected: true });
      }
      // Transient failure (db hiccup, race). 5xx → provider retries; the
      // replay path above reprocesses because processedAt was never stamped.
      console.error(`[webhooks] ${providerName}: payment processing failed — will retry`, err);
      return c.json(
        { error: { code: "PROCESSING_FAILED", message: "Payment processing failed" } },
        500,
      );
    }
  });
}

function sha(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
