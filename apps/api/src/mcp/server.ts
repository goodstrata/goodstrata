/**
 * Per-request McpServer factory. The transport is STATELESS: every HTTP request
 * builds a fresh server whose tools close over the authenticated identity
 * ({@link McpAuth}), so there is no cross-request state to leak. Domain tools
 * are registered in ./tools; this file wires the shared tool context.
 */
import { DomainError, type ServiceContext } from "@goodstrata/core";
import type { MembershipRole } from "@goodstrata/shared";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppDeps } from "../deps.js";
import { type McpAuth, type McpScope, resolveMcpActor } from "./auth.js";
import { registerTools } from "./tools/index.js";

/**
 * Shared context handed to every tool registrar. Gives tools the process deps,
 * the caller's identity, a scope gate, and the scheme membership/role gate —
 * so a tool body reads: `ctx.requireScope("mcp:read")` then
 * `const { ctx: svc } = await ctx.actor(schemeId)` then call core services.
 */
export interface McpToolContext {
  deps: AppDeps;
  auth: McpAuth;
  /** Throw FORBIDDEN unless the access token carries `scope`. */
  requireScope(scope: McpScope): void;
  /**
   * Scheme membership + role gate for the current user. 404 for non-members,
   * manager_admin bypass, FORBIDDEN naming the required roles otherwise.
   * Returns the caller's roles and a ServiceContext to pass into core services.
   */
  actor(
    schemeId: string,
    requiredRoles?: MembershipRole[],
  ): Promise<{ roles: MembershipRole[]; ctx: ServiceContext }>;
}

/** MCP server identity advertised to clients during initialize. */
const SERVER_INFO = { name: "goodstrata", version: "0.1.0" } as const;

export function buildMcpServer(deps: AppDeps, auth: McpAuth): McpServer {
  const server = new McpServer(SERVER_INFO, {
    capabilities: { tools: {} },
    instructions:
      "GoodStrata strata/owners-corporation management. Read-only tools are scoped per scheme; the caller must be a member of a scheme to see its data.",
  });

  const toolCtx: McpToolContext = {
    deps,
    auth,
    requireScope(scope) {
      if (!auth.scopes.includes(scope)) {
        throw new DomainError("FORBIDDEN", `This action requires the '${scope}' scope`, 403);
      }
    },
    actor(schemeId, requiredRoles) {
      return resolveMcpActor(deps, auth.userId, schemeId, requiredRoles);
    },
  };

  registerTools(server, toolCtx);
  return server;
}
