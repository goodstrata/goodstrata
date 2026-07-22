import { Container, getContainer } from "@cloudflare/containers";

interface Env {
  DEMO: DurableObjectNamespace<GoodstrataDemo>;
  /** wrangler secret — when present the demo agents run on OpenRouter. */
  OPENROUTER_API_KEY?: string;
  /** wrangler secret — when present, committee video calls use Daily.co. */
  DAILY_API_KEY?: string;
  /** wrangler secrets — when both present, "Sign in with Google" is offered. */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}

const ROBOTS_TXT = `# GoodStrata application host; indexing is suppressed by X-Robots-Tag. Public site: https://goodstrata.com.au
User-agent: *
Disallow:
`;

function suppressIndexing(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Robots-Tag", "noindex, nofollow");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
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
        ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
          ? {
              GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
              GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
            }
          : {}),
      },
    });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    // Already-indexed app URLs must remain crawlable until search engines see
    // the response-level noindex directive and remove them.
    if ((request.method === "GET" || request.method === "HEAD") && pathname === "/robots.txt") {
      const body = request.method === "HEAD" ? null : ROBOTS_TXT;
      return suppressIndexing(
        new Response(body, {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        }),
      );
    }

    const response = await getContainer(env.DEMO).fetch(request);
    return suppressIndexing(response);
  },
};
