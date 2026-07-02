import { arrearsService } from "@goodstrata/core";
import { schemes } from "@goodstrata/db";
import type { OutboundEmail } from "@goodstrata/integrations";
import { systemActor } from "@goodstrata/shared";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { zv } from "../validate.js";

/**
 * Dev/e2e-only helpers, mounted ONLY off-production:
 *  - /dev/outbox: read captured emails (memory provider)
 *  - /dev/simulate-payment: exercise the REAL webhook path with a signed body
 *  - /dev/run-arrears-scan: run the daily sweep now (tests/demos don't wait for cron)
 */
export function devRoutes(deps: AppDeps, selfUrl: string) {
  return new Hono()
    .get("/outbox", (c) => {
      const email = deps.integrations.email as { sent?: OutboundEmail[] };
      return c.json({ emails: email.sent ?? [] });
    })
    .post(
      "/simulate-payment",
      zv(
        "json",
        z.object({
          payid: z.string(),
          amountCents: z.number().int().positive(),
          payerName: z.string().default("Simulated Payer"),
        }),
      ),
      async (c) => {
        const { payid, amountCents, payerName } = c.req.valid("json");
        const provider = deps.integrations.payments;
        if (!("buildWebhookBody" in provider) || !("sign" in provider)) {
          return c.json(
            { error: { code: "NOT_MOCK", message: "Simulator requires the mock provider" } },
            400,
          );
        }
        const mock = provider as typeof provider & {
          buildWebhookBody(input: object): string;
          sign(body: string): string;
        };
        const body = mock.buildWebhookBody({
          payid,
          amountCents,
          paidAt: deps.clock.now().toISOString(),
          payerName,
        });
        // Round-trip through the real webhook endpoint — same verification,
        // idempotency, and reconciliation path as production.
        const res = await fetch(`${selfUrl}/webhooks/payments/${provider.name}`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-signature": mock.sign(body) },
          body,
        });
        return c.json(await res.json(), res.status as 200);
      },
    )
    .post("/run-arrears-scan", async (c) => {
      const ctx = deps.serviceContext(systemActor("dev:arrears-scan"));
      const activeSchemes = await deps.db.query.schemes.findMany({
        where: eq(schemes.status, "active"),
      });
      const results = [];
      for (const scheme of activeSchemes) {
        results.push({
          schemeId: scheme.id,
          ...(await arrearsService.scanArrears(ctx, scheme.id)),
        });
      }
      return c.json({ results });
    });
}
