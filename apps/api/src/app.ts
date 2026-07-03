import { DomainError } from "@goodstrata/core";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import type { AppDeps } from "./deps.js";
import { type AppEnv, requireAuth } from "./middleware.js";
import { agentRunsRoutes } from "./routes/agents.js";
import { communityRoutes } from "./routes/community.js";
import { devRoutes } from "./routes/dev.js";
import { eventsRoutes } from "./routes/events.js";
import { decisionsRoutes, financeRoutes } from "./routes/finance.js";
import { maintenanceRoutes } from "./routes/maintenance.js";
import { meetingsRoutes } from "./routes/meetings.js";
import { notificationsRoutes } from "./routes/notifications.js";
import {
  activationRoutes,
  committeeRoutes,
  documentsRoutes,
  invitesRoutes,
  lotsRoutes,
  peopleRoutes,
  publicInviteRoutes,
} from "./routes/onboarding.js";
import { schemesRoutes } from "./routes/schemes.js";
import { type SseHub, sseRoutes } from "./sse.js";
import { paymentWebhookRoutes } from "./webhooks.js";

export function createApp(deps: AppDeps, hub: SseHub) {
  // Authenticated, typed API surface — AppType is consumed by the web client.
  const api = new Hono<AppEnv>()
    .use("*", requireAuth(deps))
    .route("/schemes", schemesRoutes(deps))
    .route("/schemes", eventsRoutes(deps))
    .route("/schemes", sseRoutes(deps, hub))
    .route("/schemes", lotsRoutes(deps))
    .route("/schemes", peopleRoutes(deps))
    .route("/schemes", committeeRoutes(deps))
    .route("/schemes", documentsRoutes(deps))
    .route("/schemes", activationRoutes(deps))
    .route("/schemes", financeRoutes(deps))
    .route("/schemes", decisionsRoutes(deps))
    .route("/schemes", maintenanceRoutes(deps))
    .route("/schemes", communityRoutes(deps))
    .route("/schemes", meetingsRoutes(deps))
    .route("/schemes", notificationsRoutes(deps))
    .route("/schemes", agentRunsRoutes(deps))
    .route("/invites", invitesRoutes(deps));

  const app = new Hono()
    .use("*", logger())
    .get("/api/health", (c) => c.json({ ok: true }))
    // Public sandbox descriptor: the login page renders one-click demo entry
    // buttons from this. Only ever populated when DEMO_MODE=1.
    .get("/api/demo-info", (c) =>
      c.json(
        deps.env.DEMO_MODE === "1"
          ? {
              demo: true,
              accounts: [
                {
                  label: "Committee (chair & treasurer)",
                  email: "demo@goodstrata.local",
                  password: "goodstrata-demo",
                },
                {
                  label: "Lot owner (Alex, lot 2)",
                  email: "alex@demo.goodstrata.local",
                  password: "goodstrata-demo",
                },
              ],
            }
          : { demo: false, accounts: [] },
      ),
    )
    .on(["POST", "GET"], "/api/auth/*", (c) => deps.auth.handler(c.req.raw))
    .route("/api/invites", publicInviteRoutes(deps))
    .route("/webhooks", paymentWebhookRoutes(deps))
    .route("/api", api);

  // Dev/test-only introspection and simulators — never in production.
  if (deps.env.NODE_ENV !== "production") {
    app.route("/dev", devRoutes(deps, `http://localhost:${deps.env.PORT}`));
  }

  app.onError((err, c) => {
    if (err instanceof DomainError) {
      return c.json(
        { error: { code: err.code, message: err.message, details: err.details } },
        // biome-ignore lint/suspicious/noExplicitAny: status is validated by DomainError constructor
        err.status as any,
      );
    }
    if (err instanceof HTTPException) {
      return err.getResponse();
    }
    console.error("[api] unhandled", err);
    return c.json({ error: { code: "INTERNAL", message: "Internal server error" } }, 500);
  });

  return { app, api };
}

export type Api = ReturnType<typeof createApp>["api"];
