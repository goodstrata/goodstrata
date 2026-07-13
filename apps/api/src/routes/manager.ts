import {
  complianceService,
  createManagerAppointmentInput,
  DomainError,
  managerRegistrationService,
  recordPiPolicyInput,
  recordRegistrationInput,
  schemesService,
  terminateManagerAppointmentInput,
} from "@goodstrata/core";
import { userActor } from "@goodstrata/shared";
import { Hono } from "hono";
import type { AppDeps } from "../deps.js";
import { type AppEnv, requireRole, requireSchemeMember } from "../middleware.js";
import { zv } from "../validate.js";

/**
 * Manager registration & PI insurance (registered-manager path, OC Act
 * s119(5)/reg10). Registration and PI are held at the ORGANISATION level, so
 * these routes resolve the org from the scheme the admin is working in and are
 * gated to `manager_admin` — this is manager back-office, not owner-facing.
 *
 * Writes flow through `managerRegistrationService`, which drives the compliance
 * calendar (`registration_renewal` + `pi_expiry` obligations) via the sole
 * writer of `compliance_obligations`. This route never touches those tables.
 */

/** Manager back-office is admin-only (requireRole also lets manager_admin through). */
const adminOnly = requireRole("manager_admin");
const officerOrAdmin = requireRole("chair", "secretary", "treasurer");

/** Resolve the management org for a scheme, or 404 if the scheme is self-managed. */
async function organizationIdForScheme(
  deps: AppDeps,
  userId: string,
  schemeId: string,
): Promise<string> {
  const ctx = deps.serviceContext(userActor(userId));
  const scheme = await schemesService.getScheme(ctx, schemeId);
  if (!scheme.organizationId) {
    throw new DomainError(
      "NO_MANAGEMENT_ORG",
      "This scheme is not under a management organisation.",
      404,
    );
  }
  return scheme.organizationId;
}

export function managerRoutes(deps: AppDeps) {
  return (
    new Hono<AppEnv>()
      // Registration + PI snapshot: the number, current policy, ≥$2M status,
      // continuity, all PI periods, and the raised manager-level reminders.
      .get("/:schemeId/manager/registration", requireSchemeMember(deps), adminOnly, async (c) => {
        const user = c.get("user");
        const ctx = deps.serviceContext(userActor(user.id));
        const organizationId = await organizationIdForScheme(deps, user.id, c.get("schemeId"));

        const [status, policies, obligations] = await Promise.all([
          managerRegistrationService.getRegistrationStatus(ctx, organizationId),
          managerRegistrationService.listPiPolicies(ctx, organizationId),
          complianceService.listObligations(ctx, { organizationId, window: "open" }),
        ]);
        return c.json({ status, policies, obligations });
      })
      // Record / renew the BLA registration number (raises a review obligation).
      .post(
        "/:schemeId/manager/registration",
        requireSchemeMember(deps),
        adminOnly,
        zv("json", recordRegistrationInput),
        async (c) => {
          const user = c.get("user");
          const ctx = deps.serviceContext(userActor(user.id));
          const organizationId = await organizationIdForScheme(deps, user.id, c.get("schemeId"));
          const result = await managerRegistrationService.recordManagerRegistration(
            ctx,
            organizationId,
            c.req.valid("json"),
          );
          return c.json(result, 201);
        },
      )
      .get("/:schemeId/manager/appointments", requireSchemeMember(deps), async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const appointments = await managerRegistrationService.listAppointments(
          ctx,
          c.get("schemeId"),
        );
        return c.json({ appointments });
      })
      .post(
        "/:schemeId/manager/appointments",
        requireSchemeMember(deps),
        officerOrAdmin,
        zv("json", createManagerAppointmentInput),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const appointment = await managerRegistrationService.createManagerAppointment(
            ctx,
            c.get("schemeId"),
            c.req.valid("json"),
          );
          return c.json({ appointment }, 201);
        },
      )
      .post(
        "/:schemeId/manager/appointments/:appointmentId/activate",
        requireSchemeMember(deps),
        officerOrAdmin,
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const appointment = await managerRegistrationService.activateManagerAppointment(
            ctx,
            c.get("schemeId"),
            c.req.param("appointmentId"),
          );
          return c.json({ appointment });
        },
      )
      .post(
        "/:schemeId/manager/appointments/:appointmentId/terminate",
        requireSchemeMember(deps),
        officerOrAdmin,
        zv("json", terminateManagerAppointmentInput),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const appointment = await managerRegistrationService.terminateManagerAppointment(
            ctx,
            c.get("schemeId"),
            c.req.param("appointmentId"),
            c.req.valid("json"),
          );
          return c.json({ appointment });
        },
      )
      .post(
        "/:schemeId/manager/appointments/:appointmentId/notify",
        requireSchemeMember(deps),
        officerOrAdmin,
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          return c.json(
            await managerRegistrationService.notifyAppointmentChange(
              ctx,
              c.get("schemeId"),
              c.req.param("appointmentId"),
            ),
          );
        },
      )
      // Record a PI policy period (raises a pi_expiry obligation; flags < $2M).
      .post(
        "/:schemeId/manager/pi-policies",
        requireSchemeMember(deps),
        adminOnly,
        zv("json", recordPiPolicyInput),
        async (c) => {
          const user = c.get("user");
          const ctx = deps.serviceContext(userActor(user.id));
          const organizationId = await organizationIdForScheme(deps, user.id, c.get("schemeId"));
          const result = await managerRegistrationService.recordPiPolicy(
            ctx,
            organizationId,
            c.req.valid("json"),
          );
          return c.json(result, 201);
        },
      )
  );
}
