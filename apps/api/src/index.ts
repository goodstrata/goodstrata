import { createDb, runMigrations } from "@goodstrata/db";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "./app.js";
import { createAuth } from "./auth.js";
import { startBackground } from "./boot.js";
import {
  type AppDeps,
  buildModelResolver,
  buildServiceContextFactory,
  integrationsFromEnv,
} from "./deps.js";
import { loadEnv } from "./env.js";
import { SseHub } from "./sse.js";

async function main() {
  const env = loadEnv();
  await runMigrations(env.DATABASE_URL);

  const { db } = createDb(env.DATABASE_URL);
  const integrations = integrationsFromEnv(env);
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
    production: env.NODE_ENV === "production",
  });

  const deps: AppDeps = {
    env,
    db,
    auth,
    integrations,
    clock: { now: () => new Date() },
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
