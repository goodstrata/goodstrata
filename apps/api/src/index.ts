import { createDb, runMigrations } from "@goodstrata/db";
import { systemClock } from "@goodstrata/shared";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "./app.js";
import { createAuth } from "./auth.js";
import { startBackground } from "./boot.js";
import {
  type AppDeps,
  buildModelResolver,
  buildServiceContextFactory,
  deliveryProviderWarnings,
  integrationsFromEnv,
} from "./deps.js";
import { loadEnv } from "./env.js";
import { SseHub } from "./sse.js";

async function main() {
  const env = loadEnv();
  await runMigrations(env.DATABASE_URL);

  // Route the request-path query pool through the transaction pooler so bursts
  // of concurrent reads (e.g. the Finance tab's fan-out) multiplex instead of
  // exhausting the session pooler. LISTEN + pg-boss keep their session pooler.
  const { db } = createDb(env.DATABASE_URL, { transactionPool: true });
  const integrations = integrationsFromEnv({
    ...env,
    // Unsubscribe links must always be mintable — fall back to the auth secret.
    UNSUBSCRIBE_SECRET: env.UNSUBSCRIBE_SECRET ?? env.BETTER_AUTH_SECRET,
  });

  // Silent-no-op guard: in production a "console" email/SMS provider only
  // logs — nothing is delivered. Shout once at boot (and via /api/health);
  // never crash, a self-host may legitimately run without SMS.
  for (const warning of deliveryProviderWarnings(env, integrations)) {
    console.error(`[boot] ${warning}`);
  }
  const auth = createAuth({
    db,
    secret: env.BETTER_AUTH_SECRET,
    appUrl: env.APP_URL,
    mcpUrl: env.MCP_URL,
    email: integrations.email,
    google:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
        : undefined,
    requireEmailVerification: env.REQUIRE_EMAIL_VERIFICATION === "1",
  });

  const deps: AppDeps = {
    env,
    db,
    auth,
    integrations,
    clock: systemClock,
    resolveModel: await buildModelResolver(env),
    serviceContext: buildServiceContextFactory(db, integrations),
  };

  const hub = new SseHub();
  hub.start(env.DATABASE_URL);

  const { app } = createApp(deps, hub);

  // Production single-image mode: serve the built PWA with SPA fallback.
  if (env.WEB_DIST) {
    app.use("*", serveStatic({ root: env.WEB_DIST }));
    app.use("*", serveStatic({ root: env.WEB_DIST, path: "index.html" }));
  }

  const background = await startBackground(deps);

  const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    console.log(`goodstrata api listening on :${info.port}`);
  });

  const shutdown = async () => {
    console.log("shutting down…");
    server.close();
    await background.stop();
    await hub.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
