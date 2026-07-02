import { DomainError } from "@goodstrata/core";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import type { AppDeps } from "./deps.js";
import { type AppEnv, requireAuth } from "./middleware.js";
import { devRoutes } from "./routes/dev.js";
import { eventsRoutes } from "./routes/events.js";
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
    .route("/invites", invitesRoutes(deps));

  const app = new Hono()
    .use("*", logger())
    .get("/api/health", (c) => c.json({ ok: true }))
    .on(["POST", "GET"], "/api/auth/*", (c) => deps.auth.handler(c.req.raw))
    .route("/api/invites", publicInviteRoutes(deps))
    .route("/api", api);

  // Test/dev-only introspection; the memory provider only exists off-prod.
  if (deps.integrations.email.name === "memory") {
    app.route("/dev", devRoutes(deps));
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
