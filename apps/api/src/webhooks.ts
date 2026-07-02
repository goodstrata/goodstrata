import { createHash } from "node:crypto";
import { paymentsService } from "@goodstrata/core";
import { webhookEvents } from "@goodstrata/db";
import { systemActor } from "@goodstrata/shared";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { AppDeps } from "./deps.js";

/**
 * Inbound payment webhooks. Outside auth; authenticity comes from the
 * provider signature; replays are absorbed by the webhook_events ledger and
 * the payments (provider, providerRef) unique key.
 */
export function paymentWebhookRoutes(deps: AppDeps) {
  return new Hono().post("/payments/:provider", async (c) => {
    const providerName = c.req.param("provider");
    const provider = deps.integrations.payments;
    if (providerName !== provider.name) {
      return c.json({ error: { code: "UNKNOWN_PROVIDER", message: "Unknown provider" } }, 404);
    }

    const rawBody = await c.req.text();
    const signature = c.req.header("x-signature");
    const valid = provider.verifyWebhook(rawBody, signature);

    const inbound = valid ? provider.parseWebhook(rawBody) : null;
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
    if (inserted.length === 0) {
      return c.json({ ok: true, duplicate: true }); // replay — already handled
    }

    const ctx = deps.serviceContext(systemActor(`webhook:${providerName}`));
    const result = await paymentsService.recordInboundPayment(ctx, providerName, inbound!);

    await deps.db
      .update(webhookEvents)
      .set({ processedAt: deps.clock.now() })
      .where(eq(webhookEvents.id, inserted[0]!.id));

    return c.json({ ok: true, matched: result.matched });
  });
}

function sha(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
