import { Container, getContainer } from "@cloudflare/containers";

interface Env {
  DEMO: DurableObjectNamespace<GoodstrataDemo>;
  /** wrangler secret — when present the demo agents run on OpenRouter. */
  OPENROUTER_API_KEY?: string;
  /** wrangler secret — when present, committee video calls use Daily.co. */
  DAILY_API_KEY?: string;
}

/**
 * Cloudflare Containers front for the GoodStrata public demo.
 * One singleton container: Postgres + app + seeded demo scheme, ephemeral by
 * design — a fresh instance re-seeds itself and the agents run on boot.
 */
export class GoodstrataDemo extends Container<Env> {
  defaultPort = 3000;
  // Keep the demo warm for an hour after the last visitor; cold start
  // (initdb + seed) takes ~30s and yields a pristine building.
  sleepAfter = "1h";

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env, {
      envVars: {
        ...(env.OPENROUTER_API_KEY
          ? {
              AI_PROVIDER: "local",
              AI_DEFAULT_MODEL: "local:qwen/qwen3-30b-a3b",
              OPENAI_COMPAT_BASE_URL: "https://openrouter.ai/api",
              OPENAI_COMPAT_API_KEY: env.OPENROUTER_API_KEY,
            }
          : {}),
        ...(env.DAILY_API_KEY ? { VIDEO_PROVIDER: "daily", DAILY_API_KEY: env.DAILY_API_KEY } : {}),
      },
    });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const container = getContainer(env.DEMO);
    return container.fetch(request);
  },
};
