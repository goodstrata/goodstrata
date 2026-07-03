/**
 * Entry-point read tools: enumerate the caller's schemes and open one. These
 * are how a client discovers the scheme ids every other tool needs.
 */
import { schemesService } from "@goodstrata/core";
import { userActor } from "@goodstrata/shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpToolContext } from "../server.js";
import { guard, jsonResult } from "./helpers.js";

export function registerSchemeTools(server: McpServer, ctx: McpToolContext): void {
  // ── list_schemes ─────────────────────────────────────────────────────────
  // No scheme guard: this is the entry point that returns exactly the schemes
  // the caller belongs to (membership is the filter), each with their roles.
  server.registerTool(
    "list_schemes",
    {
      title: "List my schemes",
      description:
        "List the strata schemes / owners corporations the authenticated user belongs to, with the roles they hold in each. The entry point — every other tool needs a schemeId from here.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () =>
      guard(async () => {
        ctx.requireScope("mcp:read");
        const svc = ctx.deps.serviceContext(userActor(ctx.auth.userId));
        const rows = await schemesService.listSchemesForUser(svc, ctx.auth.userId);
        const schemes = rows.map(({ scheme, roles }) => ({
          schemeId: scheme.id,
          name: scheme.name,
          planOfSubdivision: scheme.planOfSubdivision,
          status: scheme.status,
          tier: scheme.tier,
          suburb: scheme.suburb,
          roles,
        }));
        const summary =
          schemes.length === 0
            ? "You are not a member of any scheme."
            : `You belong to ${schemes.length} scheme(s): ${schemes
                .map((s) => `${s.name} (${s.roles.join("/")})`)
                .join(", ")}.`;
        return jsonResult(summary, { count: schemes.length, schemes });
      }),
  );

  // ── get_scheme ───────────────────────────────────────────────────────────
  // Membership-gated: non-members get NOT_FOUND (never FORBIDDEN) so scheme
  // existence is not leaked.
  server.registerTool(
    "get_scheme",
    {
      title: "Get scheme",
      description:
        "Get a single scheme's details plus the caller's roles in it. Returns NOT_FOUND if the caller is not a member (existence is never leaked).",
      inputSchema: { schemeId: z.string().describe("Scheme id from list_schemes") },
      annotations: { readOnlyHint: true },
    },
    ({ schemeId }) =>
      guard(async () => {
        ctx.requireScope("mcp:read");
        const { roles, ctx: svc } = await ctx.actor(schemeId);
        const scheme = await schemesService.getScheme(svc, schemeId);
        return jsonResult(
          `${scheme.name} (${scheme.planOfSubdivision}) — status ${scheme.status}; your roles: ${roles.join(", ")}.`,
          { scheme, roles },
        );
      }),
  );
}
