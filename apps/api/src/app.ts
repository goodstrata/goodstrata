import { DomainError } from "@goodstrata/core";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import type { AppDeps } from "./deps.js";
import { mcpRoutes } from "./mcp/index.js";
import { type AppEnv, requireAuth } from "./middleware.js";
import { agentRunsRoutes } from "./routes/agents.js";
import { communityRoutes } from "./routes/community.js";
import { complianceRoutes } from "./routes/compliance.js";
import { devRoutes } from "./routes/dev.js";
import { documentsPdfRoutes } from "./routes/documents-pdf.js";
import { estimatorRoutes } from "./routes/estimator.js";
import { eventsRoutes } from "./routes/events.js";
import { decisionsRoutes, financeRoutes } from "./routes/finance.js";
import { grievancesRoutes } from "./routes/grievances.js";
import { maintenanceRoutes } from "./routes/maintenance.js";
import { managerRoutes } from "./routes/manager.js";
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
import { overviewRoutes } from "./routes/overview.js";
import { profileRoutes } from "./routes/profile.js";
import { schemesRoutes } from "./routes/schemes.js";
import { trustRoutes } from "./routes/trust.js";
import { type SseHub, sseRoutes } from "./sse.js";
import { paymentWebhookRoutes } from "./webhooks.js";

export function createApp(deps: AppDeps, hub: SseHub) {
  // Authenticated, typed API surface — AppType is consumed by the web client.
  const api = new Hono<AppEnv>()
    .use("*", requireAuth(deps))
    .route("/schemes", schemesRoutes(deps))
    .route("/schemes", overviewRoutes(deps))
    .route("/schemes", eventsRoutes(deps))
    .route("/schemes", sseRoutes(deps, hub))
    .route("/schemes", lotsRoutes(deps))
    .route("/schemes", peopleRoutes(deps))
    .route("/schemes", committeeRoutes(deps))
    .route("/schemes", documentsRoutes(deps))
    .route("/schemes", activationRoutes(deps))
    .route("/schemes", financeRoutes(deps))
    .route("/schemes", documentsPdfRoutes(deps))
    .route("/schemes", trustRoutes(deps))
    .route("/schemes", decisionsRoutes(deps))
    .route("/schemes", maintenanceRoutes(deps))
    .route("/schemes", grievancesRoutes(deps))
    .route("/schemes", complianceRoutes(deps))
    .route("/schemes", communityRoutes(deps))
    .route("/schemes", meetingsRoutes(deps))
    .route("/schemes", notificationsRoutes(deps))
    .route("/schemes", agentRunsRoutes(deps))
    .route("/schemes", managerRoutes(deps))
    .route("/invites", invitesRoutes(deps))
    .route("/profile", profileRoutes(deps));

  const app = new Hono()
    .use("*", logger())
    // Public "what am I paying my strata manager?" tool — called cross-origin
    // from the static marketing site, so this one path is CORS-open to it.
    .use(
      "/api/tools/*",
      cors({
        origin: ["https://goodstrata.com.au", "https://www.goodstrata.com.au"],
        allowMethods: ["POST", "OPTIONS"],
        maxAge: 86400,
      }),
    )
    .route("/api", estimatorRoutes(deps))
    .get("/api/health", (c) => c.json({ ok: true }))
    // Public auth-page descriptor: one-click demo entry buttons (only ever
    // populated when DEMO_MODE=1) plus which social sign-in providers this
    // deployment has configured — a runtime capability, so one web build
    // serves every deployment and the Google button only shows where the
    // credentials exist.
    .get("/api/demo-info", (c) => {
      const socialProviders =
        deps.env.GOOGLE_CLIENT_ID && deps.env.GOOGLE_CLIENT_SECRET ? ["google"] : [];
      return c.json(
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
              socialProviders,
            }
          : { demo: false, accounts: [], socialProviders },
      );
    })
    .on(["POST", "GET"], "/api/auth/*", (c) => deps.auth.handler(c.req.raw))
    // MCP server: OAuth-bearer /mcp transport + discovery metadata at the root.
    // Mounted outside /api because it carries its own auth (not the session
    // cookie). Host-aware, degrades to same-origin locally.
    .route("/", mcpRoutes(deps))
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
