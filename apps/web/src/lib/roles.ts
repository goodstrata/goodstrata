import { useQuery } from "@tanstack/react-query";
import { api, unwrap } from "@/lib/api";

export interface SchemeDetail {
  scheme: { name: string; planOfSubdivision: string; status: string; tier: number };
  roles: string[];
}

/** Single source of truth for the scheme header query (shared cache key). */
export function schemeQueryOptions(schemeId: string) {
  return {
    queryKey: ["scheme", schemeId] as const,
    queryFn: async () =>
      unwrap<SchemeDetail>(await api.schemes[":schemeId"].$get({ param: { schemeId } })),
  };
}

export const OFFICER_ROLES = ["chair", "secretary", "treasurer", "manager_admin"];
const COMMITTEE_ROLES = ["committee_member", "chair", "secretary", "treasurer"];

/** Everyone who sits on the committee, plus the manager. Drives the full nav. */
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
 * True for a plain resident — someone who holds a membership on this scheme but
 * does NOT sit on the committee. Drives the focused owner presentation (nav set
 * + landing).
 *
 * A committee member is NOT an owner viewer: they sit on the governing body, so
 * they get the full register (governance, finance, the registers) — deciding,
 * meetings and grievances are their job, and they are notified to act on them.
 * What they don't get is officer POWERS; those hang off useIsOfficer, and the
 * API enforces them independently.
 *
 * Returns false while roles are still loading (roles === []), so the committee
 * layout is never flashed before the owner layout resolves.
 */
export function useIsOwnerView(schemeId: string): boolean {
  const roles = useSchemeRoles(schemeId);
  return roles.length > 0 && !roles.some((r) => COMMITTEE_VIEW_ROLES.includes(r));
}

/**
 * True for anyone who sits on the committee (a plain committee_member included)
 * or manages the scheme. Use this to decide what a viewer may SEE — the
 * governance registers are the committee's business. Use useIsOfficer to decide
 * what they may DO; the API draws the same line.
 */
export function useIsCommittee(schemeId: string): boolean {
  return useSchemeRoles(schemeId).some((r) => COMMITTEE_VIEW_ROLES.includes(r));
}

/** Mirrors core's rolesAllowedToDecide for a decision's decider tier. */
export function canDecide(roles: string[], deciderRole: string): boolean {
  if (roles.includes("manager_admin")) return true;
  if (deciderRole === "treasurer") return roles.includes("treasurer");
  if (deciderRole === "committee") return roles.some((r) => COMMITTEE_ROLES.includes(r));
  // all_owners (and anything unknown): every member may decide.
  return true;
}
