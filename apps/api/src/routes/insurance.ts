import {
  createInsuranceClaimInput,
  insuranceService,
  recordInsurancePolicyInput,
  recordInsuranceValuationInput,
  updateInsuranceClaimInput,
} from "@goodstrata/core";
import { userActor } from "@goodstrata/shared";
import { Hono } from "hono";
import type { AppDeps } from "../deps.js";
import { type AppEnv, requireRole, requireSchemeMember } from "../middleware.js";
import { zv } from "../validate.js";

const officerOrAdmin = requireRole("chair", "secretary", "treasurer");

export function insuranceRoutes(deps: AppDeps) {
  return new Hono<AppEnv>()
    .get("/:schemeId/insurance", requireSchemeMember(deps), async (c) => {
      const ctx = deps.serviceContext(userActor(c.get("user").id));
      const data = await insuranceService.listInsurance(ctx, c.get("schemeId"));
      const canReadClaims = c
        .get("roles")
        .some((role) => ["chair", "secretary", "treasurer", "manager_admin"].includes(role));
      return c.json({ ...data, claims: canReadClaims ? data.claims : [] });
    })
    .post(
      "/:schemeId/insurance/policies",
      requireSchemeMember(deps),
      officerOrAdmin,
      zv("json", recordInsurancePolicyInput),
      async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const policy = await insuranceService.recordPolicy(
          ctx,
          c.get("schemeId"),
          c.req.valid("json"),
        );
        return c.json({ policy }, 201);
      },
    )
    .post(
      "/:schemeId/insurance/valuations",
      requireSchemeMember(deps),
      officerOrAdmin,
      zv("json", recordInsuranceValuationInput),
      async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const valuation = await insuranceService.recordValuation(
          ctx,
          c.get("schemeId"),
          c.req.valid("json"),
        );
        return c.json({ valuation }, 201);
      },
    )
    .post(
      "/:schemeId/insurance/claims",
      requireSchemeMember(deps),
      officerOrAdmin,
      zv("json", createInsuranceClaimInput),
      async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const claim = await insuranceService.createClaim(
          ctx,
          c.get("schemeId"),
          c.req.valid("json"),
        );
        return c.json({ claim }, 201);
      },
    )
    .patch(
      "/:schemeId/insurance/claims/:claimId",
      requireSchemeMember(deps),
      officerOrAdmin,
      zv("json", updateInsuranceClaimInput),
      async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const claim = await insuranceService.updateClaim(
          ctx,
          c.get("schemeId"),
          c.req.param("claimId"),
          c.req.valid("json"),
        );
        return c.json({ claim });
      },
    );
}
