/**
 * MCP tool registry. Phase 1 (this file) ships only the `whoami` scaffold that
 * proves the auth + scope wiring end-to-end; the read-only domain tools land in
 * the next phase.
 *
 * ── How to add a tool ──────────────────────────────────────────────────────
 * MVP is READ-ONLY: gate every tool on `ctx.requireScope("mcp:read")`.
 *
 *   server.registerTool(
 *     "list_levies",
 *     {
 *       description: "List levies for a scheme the caller belongs to.",
 *       inputSchema: { schemeId: z.string().describe("Scheme id") },
 *     },
 *     async ({ schemeId }) => {
 *       ctx.requireScope("mcp:read");
 *       const { ctx: svc } = await ctx.actor(schemeId); // 404s non-members
 *       const levies = await leviesService.list(svc, schemeId);
 *       return { content: [{ type: "text", text: JSON.stringify(levies) }] };
 *     },
 *   );
 *
 * `ctx.actor(schemeId, [roles])` enforces membership/role (manager_admin
 * bypasses); pass its returned `svc` ServiceContext to @goodstrata/core
 * services. Officer-only reads use `ctx.actor(schemeId, ["chair","secretary","treasurer"])`.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpToolContext } from "../server.js";
import { registerFinancialPositionTool } from "./financial.js";
import { registerPortfolioTools } from "./portfolio.js";
import { registerSchemeHealthTool } from "./scheme-health.js";
import { registerSchemeTools } from "./schemes.js";

export function registerTools(server: McpServer, ctx: McpToolContext): void {
  // Entry-point + single-scheme + cross-scheme composite read tools.
  registerSchemeTools(server, ctx); // list_schemes, get_scheme
  registerPortfolioTools(server, ctx); // get_portfolio_briefing, find_my_pending_actions
  registerSchemeHealthTool(server, ctx); // get_scheme_health
  registerFinancialPositionTool(server, ctx); // get_financial_position

  // Scaffold/health tool: confirms the OAuth token resolved and reports the
  // granted scopes.
  server.registerTool(
    "whoami",
    {
      description:
        "Return the authenticated GoodStrata user id and the MCP scopes granted to this session.",
      inputSchema: {},
    },
    async () => {
      ctx.requireScope("mcp:read");
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              userId: ctx.auth.userId,
              clientId: ctx.auth.clientId,
              scopes: ctx.auth.scopes,
            }),
          },
        ],
      };
    },
  );
}
