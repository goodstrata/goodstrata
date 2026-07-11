import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

/**
 * The scheme header payload: the scheme's identity plus the roles the
 * signed-in user holds on it. Mirrors apps/web/src/lib/roles.ts — the mobile
 * `api<T>(path)` client stands in for web's typed RPC client.
 */
export interface SchemeDetail {
  scheme: { name: string; planOfSubdivision: string; status: string; tier: number };
  roles: string[];
}

/** Single source of truth for the scheme header query (shared cache key). */
export function schemeQueryOptions(schemeId: string) {
  return {
    queryKey: ["scheme", schemeId] as const,
    queryFn: () => api<SchemeDetail>(`/api/schemes/${schemeId}`),
  };
}

export const OFFICER_ROLES = ["chair", "secretary", "treasurer", "manager_admin"];
const COMMITTEE_ROLES = ["committee_member", "chair", "secretary", "treasurer"];

/** Everyone who sits on the committee, plus the manager. Drives the full hub. */
const COMMITTEE_VIEW_ROLES = [...COMMITTEE_ROLES, "manager_admin"];

/** Roles the signed-in user holds on this scheme ([] while loading). */
export function useSchemeRoles(schemeId: string): string[] {
  const { data } = useQuery(schemeQueryOptions(schemeId));
  return data?.roles ?? [];
}

/**
 * True when the user can perform officer actions (create budgets, schedule
 * meetings, invite people, …). Mirrors the API's requireRole guard.
 */
export function useIsOfficer(schemeId: string): boolean {
  return useSchemeRoles(schemeId).some((r) => OFFICER_ROLES.includes(r));
}

/**
 * True for a plain resident — a member who does NOT sit on the committee.
 * Drives the focused owner presentation.
 *
 * A committee member is NOT an owner viewer: they sit on the governing body, so
 * they get the full hub (governance, finance, the registers). What they don't
 * get is officer POWERS — those hang off useIsOfficer. Mirrors web's
 * apps/web/src/lib/roles.ts. Returns false while roles are still loading
 * (roles === []), so the committee layout is never flashed before the owner
 * layout resolves. Presentation only; the API still enforces access.
 */
export function useIsOwnerView(schemeId: string): boolean {
  const roles = useSchemeRoles(schemeId);
  return roles.length > 0 && !roles.some((r) => COMMITTEE_VIEW_ROLES.includes(r));
}

/** Mirrors core's rolesAllowedToDecide for a decision's decider tier. */
export function canDecide(roles: string[], deciderRole: string): boolean {
  if (roles.includes("manager_admin")) return true;
  if (deciderRole === "treasurer") return roles.includes("treasurer");
  if (deciderRole === "committee") return roles.some((r) => COMMITTEE_ROLES.includes(r));
  // all_owners (and anything unknown): every member may decide.
  return true;
}
