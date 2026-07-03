/**
 * MCP auth chokepoints — the OAuth/session resolution and per-scheme role
 * gating that every tool funnels through. Mirrors the HTTP middleware in
 * ../middleware.ts (404-not-403 for non-members, manager_admin bypass) but
 * speaks the MCP OAuth token instead of a browser session cookie.
 */
import { DomainError, type ServiceContext, schemesService } from "@goodstrata/core";
import { type MembershipRole, userActor } from "@goodstrata/shared";
import type { AppDeps } from "../deps.js";

/** OAuth scopes issued by the authorization server (see auth.ts). */
export type McpScope = "mcp:read" | "mcp:write" | "mcp:govern";

/** Resolved identity + granted scopes for an authenticated MCP request. */
export interface McpAuth {
  userId: string;
  clientId: string;
  scopes: McpScope[];
}

/**
 * The RFC 9728 protected-resource metadata URL for the MCP resource server.
 * Advertised in the `WWW-Authenticate` header on a 401 so clients can discover
 * the authorization server. Env-driven: MCP_URL in prod, APP_URL same-origin
 * locally.
 */
export function resourceMetadataUrl(deps: AppDeps): string {
  const base = (deps.env.MCP_URL ?? deps.env.APP_URL).replace(/\/$/, "");
  return `${base}/.well-known/oauth-protected-resource`;
}

/** Thrown when the MCP OAuth token is missing/invalid; carries the 401 header. */
export class McpUnauthorizedError extends Error {
  constructor(
    readonly resourceMetadata: string,
    message = "MCP authentication required",
  ) {
    super(message);
    this.name = "McpUnauthorizedError";
  }

  /** Value for the `WWW-Authenticate` response header (RFC 9728 §5.1). */
  wwwAuthenticate(): string {
    return `Bearer resource_metadata="${this.resourceMetadata}"`;
  }
}

/**
 * Resolve the better-auth MCP/OAuth session from request headers.
 * Throws {@link McpUnauthorizedError} (→ 401 + WWW-Authenticate) when there is
 * no valid bearer token.
 */
export async function authenticateMcp(deps: AppDeps, headers: Headers): Promise<McpAuth> {
  const session = await deps.auth.api.getMcpSession({ headers });
  if (!session) {
    throw new McpUnauthorizedError(resourceMetadataUrl(deps));
  }
  const scopes = (session.scopes ?? "")
    .split(" ")
    .map((s) => s.trim())
    .filter(Boolean) as McpScope[];
  return { userId: session.userId, clientId: session.clientId, scopes };
}

/**
 * Scheme membership + role gate, reusing schemesService.rolesForUser.
 * - Non-members get 404 (never 403) so scheme existence is not leaked.
 * - manager_admin always passes any role requirement.
 * - A role miss throws FORBIDDEN naming the required tier.
 *
 * Returns the caller's roles and a ServiceContext scoped to their identity —
 * pass `ctx` straight into @goodstrata/core services.
 */
export async function resolveMcpActor(
  deps: AppDeps,
  userId: string,
  schemeId: string,
  requiredRoles?: MembershipRole[],
): Promise<{ roles: MembershipRole[]; ctx: ServiceContext }> {
  const ctx = deps.serviceContext(userActor(userId));
  const roles = await schemesService.rolesForUser(ctx, schemeId, userId);
  if (roles.length === 0) {
    throw new DomainError("NOT_FOUND", "Scheme not found", 404);
  }
  if (requiredRoles && requiredRoles.length > 0) {
    const ok = roles.includes("manager_admin") || roles.some((r) => requiredRoles.includes(r));
    if (!ok) {
      throw new DomainError("FORBIDDEN", `Requires one of: ${requiredRoles.join(", ")}`, 403);
    }
  }
  return { roles, ctx };
}
