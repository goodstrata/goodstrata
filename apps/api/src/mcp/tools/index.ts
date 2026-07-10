/**
 * MCP tool registry, in three scope tiers:
 * - `mcp:read`  — the read-only domain tools (schemes, portfolio, health,
 *   financial position) plus the `whoami` scaffold;
 * - `mcp:write` — the safe mutating tools in ./writes.ts (create records or
 *   open a human decision gate; never money/statutory effects);
 * - `mcp:govern` — the money-moving / statutory tools in ./governed.ts, each
 *   two-phase (dry-run preview → signed confirm token, see ../confirm.ts).
 *
 * ── How to add a tool ──────────────────────────────────────────────────────
 * Gate on the scope FIRST (`ctx.requireScope(...)` — a missing scope must fail
 * before any scheme lookup), then on membership/role:
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
 * services. Officer-only tools use `ctx.actor(schemeId, ["chair","secretary","treasurer"])`.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpToolContext } from "../server.js";
import { registerFinancialPositionTool } from "./financial.js";
import { registerGovernedTools } from "./governed.js";
import { registerPortfolioTools } from "./portfolio.js";
import { registerSchemeHealthTool } from "./scheme-health.js";
import { registerSchemeTools } from "./schemes.js";
import { registerWriteTools } from "./writes.js";

export function registerTools(server: McpServer, ctx: McpToolContext): void {
  // Entry-point + single-scheme + cross-scheme composite read tools.
  registerSchemeTools(server, ctx); // list_schemes, get_scheme
  registerPortfolioTools(server, ctx); // get_portfolio_briefing, find_my_pending_actions
  registerSchemeHealthTool(server, ctx); // get_scheme_health
  registerFinancialPositionTool(server, ctx); // get_financial_position

  // Mutating tools — every one gated on the `mcp:write` scope (see writes.ts).
  // create_scheme, create_maintenance_request, create_community_post,
  // add_community_comment, invite_person, draft_budget (opens a decision gate).
  registerWriteTools(server, ctx);

  // Governed money-moving / statutory tools — gated on `mcp:govern` + officer
  // tier, each two-phase preview→confirm (see governed.ts): issue_levy_run,
  // send_meeting_notice, resolve_decision, cast_motion_vote, close_meeting.
  registerGovernedTools(server, ctx);

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
