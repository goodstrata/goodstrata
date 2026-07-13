import {
  createCertificateRequestInput,
  createInspectionRequestInput,
  createRegisterItemInput,
  issueCertificateInput,
  recordsService,
  updateRegisterBasisInput,
  verifyInspectionRequestInput,
} from "@goodstrata/core";
import { userActor } from "@goodstrata/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { type AppEnv, requireRole, requireSchemeMember } from "../middleware.js";
import { zv } from "../validate.js";

const officerOrAdmin = requireRole("chair", "secretary", "treasurer");

export function recordsRoutes(deps: AppDeps) {
  return new Hono<AppEnv>()
    .get("/:schemeId/records/register", requireSchemeMember(deps), async (c) => {
      const ctx = deps.serviceContext(userActor(c.get("user").id));
      return c.json({
        register: await recordsService.getOwnersCorporationRegister(ctx, c.get("schemeId")),
      });
    })
    .post(
      "/:schemeId/records/register/items",
      requireSchemeMember(deps),
      officerOrAdmin,
      zv("json", createRegisterItemInput),
      async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const item = await recordsService.createRegisterItem(
          ctx,
          c.get("schemeId"),
          c.req.valid("json"),
        );
        return c.json({ item }, 201);
      },
    )
    .patch(
      "/:schemeId/records/register/basis",
      requireSchemeMember(deps),
      officerOrAdmin,
      zv("json", updateRegisterBasisInput),
      async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        return c.json({
          scheme: await recordsService.updateRegisterBasis(
            ctx,
            c.get("schemeId"),
            c.req.valid("json"),
          ),
        });
      },
    )
    .get("/:schemeId/records/inspections", requireSchemeMember(deps), officerOrAdmin, async (c) => {
      const ctx = deps.serviceContext(userActor(c.get("user").id));
      return c.json({
        requests: await recordsService.listInspectionRequests(ctx, c.get("schemeId")),
      });
    })
    .post(
      "/:schemeId/records/inspections",
      requireSchemeMember(deps),
      zv("json", createInspectionRequestInput),
      async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const request = await recordsService.createInspectionRequest(
          ctx,
          c.get("schemeId"),
          c.req.valid("json"),
        );
        return c.json({ request }, 201);
      },
    )
    .post(
      "/:schemeId/records/inspections/:requestId/verify",
      requireSchemeMember(deps),
      officerOrAdmin,
      zv("json", verifyInspectionRequestInput),
      async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        return c.json({
          request: await recordsService.verifyInspectionRequest(
            ctx,
            c.get("schemeId"),
            c.req.param("requestId"),
            c.req.valid("json"),
          ),
        });
      },
    )
    .post(
      "/:schemeId/records/inspections/:requestId/schedule",
      requireSchemeMember(deps),
      officerOrAdmin,
      zv("json", z.object({ scheduledAt: z.coerce.date() })),
      async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        return c.json({
          request: await recordsService.scheduleInspection(
            ctx,
            c.get("schemeId"),
            c.req.param("requestId"),
            c.req.valid("json").scheduledAt,
          ),
        });
      },
    )
    .post(
      "/:schemeId/records/inspections/:requestId/complete",
      requireSchemeMember(deps),
      officerOrAdmin,
      zv("json", z.object({ printedPages: z.number().int().nonnegative().default(0) })),
      async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        return c.json({
          request: await recordsService.completeInspection(
            ctx,
            c.get("schemeId"),
            c.req.param("requestId"),
            c.req.valid("json").printedPages,
          ),
        });
      },
    )
    .get(
      "/:schemeId/records/certificates",
      requireSchemeMember(deps),
      officerOrAdmin,
      async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        return c.json({
          requests: await recordsService.listCertificateRequests(ctx, c.get("schemeId")),
        });
      },
    )
    .get(
      "/:schemeId/records/certificates/:requestId/package",
      requireSchemeMember(deps),
      async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        return c.json({
          package: await recordsService.getCertificatePackage(
            ctx,
            c.get("schemeId"),
            c.req.param("requestId"),
          ),
        });
      },
    )
    .post(
      "/:schemeId/records/certificates",
      requireSchemeMember(deps),
      zv("json", createCertificateRequestInput),
      async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const request = await recordsService.createCertificateRequest(
          ctx,
          c.get("schemeId"),
          c.req.valid("json"),
        );
        return c.json({ request }, 201);
      },
    )
    .post(
      "/:schemeId/records/certificates/:requestId/payment",
      requireSchemeMember(deps),
      officerOrAdmin,
      zv("json", z.object({ paidAt: z.coerce.date() })),
      async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        return c.json({
          request: await recordsService.recordCertificateFeePaid(
            ctx,
            c.get("schemeId"),
            c.req.param("requestId"),
            c.req.valid("json").paidAt,
          ),
        });
      },
    )
    .post(
      "/:schemeId/records/certificates/:requestId/issue",
      requireSchemeMember(deps),
      officerOrAdmin,
      zv("json", issueCertificateInput),
      async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        return c.json({
          request: await recordsService.issueCertificate(
            ctx,
            c.get("schemeId"),
            c.req.param("requestId"),
            c.req.valid("json"),
          ),
        });
      },
    );
}
