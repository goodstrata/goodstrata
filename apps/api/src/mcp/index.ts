/**
 * MCP HTTP surface, mounted on the top-level Hono app (it carries its own OAuth
 * bearer auth, so it lives outside the cookie-authenticated /api sub-app).
 *
 * Endpoints:
 *   POST|GET|DELETE /mcp                              — StreamableHTTP transport
 *   GET /.well-known/oauth-protected-resource         — RFC 9728 (resource → AS)
 *   GET /.well-known/oauth-authorization-server       — OAuth AS metadata
 *
 * Transport is STATELESS (sessionIdGenerator: undefined): a fresh McpServer +
 * transport per request. The deprecated SSE transport is never used.
 *
 * Host routing degrades gracefully. When MCP_URL and APP_URL share an origin
 * (local dev / single container) all routes are served everywhere. When they
 * differ, /mcp + protected-resource metadata are served on the MCP host and the
 * AS metadata on the app host — driven entirely by env, no hardcoded hosts.
 */
import type { HttpBindings } from "@hono/node-server";
import { RESPONSE_ALREADY_SENT } from "@hono/node-server/utils/response";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { oAuthDiscoveryMetadata, oAuthProtectedResourceMetadata } from "better-auth/plugins";
import { Hono } from "hono";
import type { AppDeps } from "../deps.js";
import { authenticateMcp, McpUnauthorizedError } from "./auth.js";
import { buildMcpServer } from "./server.js";

type McpEnv = { Bindings: HttpBindings };

function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

export function mcpRoutes(deps: AppDeps) {
  const app = new Hono<McpEnv>();

  // When the MCP host and app host differ, we gate each route on the Host
  // header. hostMatches(undefined) is always true (same-origin / no config).
  const mcpHost = hostOf(deps.env.MCP_URL);
  const appHost = hostOf(deps.env.APP_URL);
  const splitHosts = !!mcpHost && !!appHost && mcpHost !== appHost;
  const servedOn = (expected: string | undefined) => (host: string | null) =>
    !splitHosts || !expected || !host || host === expected;

  const onMcpHost = servedOn(mcpHost);
  const onAppHost = servedOn(appHost);

  // ── OAuth discovery metadata (served by better-auth helpers) ──────────────
  // Resource metadata lives with the resource server (the MCP host).
  const protectedResource = oAuthProtectedResourceMetadata(deps.auth);
  app.get("/.well-known/oauth-protected-resource", (c) => {
    if (!onMcpHost(c.req.header("host") ?? null)) return c.notFound();
    return protectedResource(c.req.raw);
  });

  // AS metadata lives with the authorization server (the app host).
  const discovery = oAuthDiscoveryMetadata(deps.auth);
  app.get("/.well-known/oauth-authorization-server", (c) => {
    if (!onAppHost(c.req.header("host") ?? null)) return c.notFound();
    return discovery(c.req.raw);
  });

  // ── StreamableHTTP transport (POST/GET/DELETE /mcp) ───────────────────────
  app.on(["POST", "GET", "DELETE"], "/mcp", async (c) => {
    if (!onMcpHost(c.req.header("host") ?? null)) return c.notFound();

    let auth: Awaited<ReturnType<typeof authenticateMcp>>;
    try {
      auth = await authenticateMcp(deps, c.req.raw.headers);
    } catch (err) {
      if (err instanceof McpUnauthorizedError) {
        return c.json(
          { jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null },
          401,
          { "WWW-Authenticate": err.wwwAuthenticate() },
        );
      }
      throw err;
    }

    const server = buildMcpServer(deps, auth);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
      enableJsonResponse: true,
    });

    const { incoming, outgoing } = c.env;
    outgoing.on("close", () => {
      void transport.close();
      void server.close();
    });

    await server.connect(transport);

    // Pre-parse the JSON-RPC body from Hono's request so the transport does not
    // re-read the (already consumed) Node stream. GET/DELETE carry no body.
    const body = c.req.method === "POST" ? await c.req.json().catch(() => undefined) : undefined;

    await transport.handleRequest(incoming, outgoing, body);
    return RESPONSE_ALREADY_SENT;
  });

  return app;
}
