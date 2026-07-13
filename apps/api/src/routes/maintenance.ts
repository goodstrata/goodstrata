import {
  addMaintenancePlanItemInput,
  approveMaintenancePlanInput,
  createAssetInput,
  createContractorInput,
  createEntityCommentInput,
  createRequestInput,
  createStatutoryMaintenancePlanInput,
  entityCommentsService,
  maintenanceService,
  type RequestImageUpload,
  reviewMaintenancePlanInput,
  statutoryMaintenanceService,
  THREAD_OFFICER_ROLES,
} from "@goodstrata/core";
import { people } from "@goodstrata/db";
import type { MembershipRole } from "@goodstrata/shared";
import { userActor } from "@goodstrata/shared";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { z } from "zod";
import type { AppDeps } from "../deps.js";
import { type AppEnv, requireRole, requireSchemeMember } from "../middleware.js";
import { zv } from "../validate.js";

const officerOrAdmin = requireRole("chair", "secretary", "treasurer");

/**
 * Officer verdict for the comment-thread endpoints. Middleware can't express
 * "requester OR officer", so the service enforces it — the route only reports
 * whether the caller holds an officer role (same set officerOrAdmin accepts,
 * manager_admin included).
 */
const isThreadOfficer = (roles: MembershipRole[]) =>
  roles.some((r) => THREAD_OFFICER_ROLES.includes(r));

// The reporter's identity comes from the session, never the payload — a
// member must not be able to file a report as somebody else.
const reportInput = createRequestInput.omit({ reportedByPersonId: true });

/**
 * Image MIME types we accept for report photos — the same allowlist as
 * community uploads, for the same reason: the client-supplied Content-Type is
 * NOT trusted for serving. Without an allowlist a member could upload
 * `text/html` with a `<script>` body and the content endpoint would later
 * serve it inline same-origin (stored XSS). We both reject non-images here
 * and force a safe content-type on serve.
 */
const ALLOWED_IMAGE_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

/**
 * Per-image size cap. Uploads are fully buffered in memory before hitting
 * object storage, so an unbounded file would let one member exhaust the API
 * process; 10 MB comfortably covers phone photos.
 */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export function maintenanceRoutes(deps: AppDeps) {
  return (
    new Hono<AppEnv>()
      .get("/:schemeId/maintenance", requireSchemeMember(deps), async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        return c.json({ requests: await maintenanceService.listRequests(ctx, c.get("schemeId")) });
      })
      // Report an issue. multipart/form-data (fields + zero-or-more `images`
      // files) or application/json when there are no photos.
      .post("/:schemeId/maintenance", requireSchemeMember(deps), async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const contentType = c.req.header("content-type") ?? "";

        let input: z.infer<typeof reportInput>;
        const files: RequestImageUpload[] = [];

        if (contentType.includes("multipart/form-data")) {
          const form = await c.req.parseBody({ all: true });
          const parsed = reportInput.safeParse({
            title: typeof form.title === "string" ? form.title : "",
            description: typeof form.description === "string" ? form.description : "",
            lotId: typeof form.lotId === "string" && form.lotId ? form.lotId : undefined,
            reportedEmergency:
              typeof form.reportedEmergency === "string"
                ? form.reportedEmergency === "true"
                : undefined,
          });
          if (!parsed.success) {
            return c.json(
              {
                error: {
                  code: "VALIDATION",
                  message: "Invalid request",
                  details: parsed.error.issues,
                },
              },
              422,
            );
          }
          input = parsed.data;

          const field = form.images;
          const candidates = Array.isArray(field) ? field : field ? [field] : [];
          for (const f of candidates) {
            if (f instanceof File) {
              // Normalize away any charset parameter, then allowlist. Reject
              // anything that isn't a known image type so we never store (and
              // later serve) attacker-chosen content types like text/html.
              const declared = (f.type || "").split(";")[0]!.trim().toLowerCase();
              if (!ALLOWED_IMAGE_TYPES.has(declared)) {
                return c.json(
                  {
                    error: {
                      code: "UNSUPPORTED_IMAGE",
                      message: "Photos must be PNG, JPEG, WebP or GIF.",
                    },
                  },
                  422,
                );
              }
              if (f.size > MAX_IMAGE_BYTES) {
                return c.json(
                  {
                    error: {
                      code: "IMAGE_TOO_LARGE",
                      message: "Each photo must be 10 MB or smaller.",
                    },
                  },
                  422,
                );
              }
              files.push({
                filename: f.name,
                contentType: declared,
                content: new Uint8Array(await f.arrayBuffer()),
              });
            }
          }
        } else {
          const parsed = reportInput.safeParse(await c.req.json().catch(() => null));
          if (!parsed.success) {
            return c.json(
              {
                error: {
                  code: "VALIDATION",
                  message: "Invalid request",
                  details: parsed.error.issues,
                },
              },
              422,
            );
          }
          input = parsed.data;
        }

        const person = await deps.db.query.people.findFirst({
          where: and(eq(people.schemeId, c.get("schemeId")), eq(people.userId, c.get("user").id)),
        });
        const request = await maintenanceService.createMaintenanceRequest(
          ctx,
          c.get("schemeId"),
          { ...input, reportedByPersonId: person?.id },
          files,
        );
        return c.json({ request }, 201);
      })
      .get(
        "/:schemeId/maintenance/images/:imageId/content",
        requireSchemeMember(deps),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const { row, bytes } = await maintenanceService.getRequestImage(
            ctx,
            c.get("schemeId"),
            c.req.param("imageId"),
          );
          // Defense in depth: only ever emit a known-safe image content-type.
          // Unexpected stored mimes are served as a non-renderable download so
          // a mislabelled row can't execute as HTML/script in the app origin.
          // `nosniff` stops the browser from content-sniffing past it.
          const safeMime = ALLOWED_IMAGE_TYPES.has(row.mime)
            ? row.mime
            : "application/octet-stream";
          const disposition = safeMime === "application/octet-stream" ? "attachment" : "inline";
          return c.body(bytes.buffer as ArrayBuffer, 200, {
            "content-type": safeMime,
            "content-disposition": `${disposition}; filename="${row.id}"`,
            "x-content-type-options": "nosniff",
          });
        },
      )
      // Comment thread on a request — the requester and the officer tier only
      // (participation is enforced in the service; see entityComments).
      .get("/:schemeId/maintenance/:requestId/comments", requireSchemeMember(deps), async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const comments = await entityCommentsService.listComments(
          ctx,
          c.get("schemeId"),
          "maintenance_request",
          c.req.param("requestId"),
          { userId: c.get("user").id, isOfficer: isThreadOfficer(c.get("roles")) },
        );
        return c.json({ comments });
      })
      .post(
        "/:schemeId/maintenance/:requestId/comments",
        requireSchemeMember(deps),
        zv("json", createEntityCommentInput),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const result = await entityCommentsService.addComment(
            ctx,
            c.get("schemeId"),
            "maintenance_request",
            c.req.param("requestId"),
            { userId: c.get("user").id, isOfficer: isThreadOfficer(c.get("roles")) },
            c.req.valid("json"),
          );
          return c.json(result, 201);
        },
      )
      .get("/:schemeId/maintenance-plans", requireSchemeMember(deps), async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        return c.json(await statutoryMaintenanceService.listPlans(ctx, c.get("schemeId")));
      })
      .get("/:schemeId/assets", requireSchemeMember(deps), async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        return c.json({
          assets: await statutoryMaintenanceService.listAssets(ctx, c.get("schemeId")),
        });
      })
      .post(
        "/:schemeId/assets",
        requireSchemeMember(deps),
        officerOrAdmin,
        zv("json", createAssetInput),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const asset = await statutoryMaintenanceService.createAsset(
            ctx,
            c.get("schemeId"),
            c.req.valid("json"),
          );
          return c.json({ asset }, 201);
        },
      )
      .get("/:schemeId/maintenance-plans/agm-report", requireSchemeMember(deps), async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        return c.json(
          await statutoryMaintenanceService.getAgmMaintenanceReport(ctx, c.get("schemeId")),
        );
      })
      .post(
        "/:schemeId/maintenance-plans",
        requireSchemeMember(deps),
        officerOrAdmin,
        zv("json", createStatutoryMaintenancePlanInput),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const plan = await statutoryMaintenanceService.createPlan(
            ctx,
            c.get("schemeId"),
            c.req.valid("json"),
          );
          return c.json({ plan }, 201);
        },
      )
      .post(
        "/:schemeId/maintenance-plans/:planId/items",
        requireSchemeMember(deps),
        officerOrAdmin,
        zv("json", addMaintenancePlanItemInput),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const item = await statutoryMaintenanceService.addPlanItem(
            ctx,
            c.get("schemeId"),
            c.req.param("planId"),
            c.req.valid("json"),
          );
          return c.json({ item }, 201);
        },
      )
      .post(
        "/:schemeId/maintenance-plans/:planId/approve",
        requireSchemeMember(deps),
        officerOrAdmin,
        zv("json", approveMaintenancePlanInput),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const plan = await statutoryMaintenanceService.approvePlan(
            ctx,
            c.get("schemeId"),
            c.req.param("planId"),
            c.req.valid("json"),
          );
          return c.json({ plan });
        },
      )
      .post(
        "/:schemeId/maintenance-plans/:planId/review",
        requireSchemeMember(deps),
        officerOrAdmin,
        zv("json", reviewMaintenancePlanInput),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const plan = await statutoryMaintenanceService.reviewPlan(
            ctx,
            c.get("schemeId"),
            c.req.param("planId"),
            c.req.valid("json"),
          );
          return c.json({ plan });
        },
      )
      // Soft-delete: the author retracts their own; officers moderate any.
      .delete(
        "/:schemeId/maintenance/comments/:commentId",
        requireSchemeMember(deps),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const result = await entityCommentsService.deleteComment(
            ctx,
            c.get("schemeId"),
            c.req.param("commentId"),
            { userId: c.get("user").id, isOfficer: isThreadOfficer(c.get("roles")) },
          );
          return c.json(result);
        },
      )
      .get("/:schemeId/work-orders", requireSchemeMember(deps), async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        return c.json({
          workOrders: await maintenanceService.listWorkOrders(ctx, c.get("schemeId")),
        });
      })
      // Manual fallback for the agent flow: an officer raises a work order on a
      // triaged request. Threshold routing (auto / committee gate / emergency)
      // is decided by code in the service, same as the agent path.
      .post(
        "/:schemeId/work-orders",
        requireSchemeMember(deps),
        officerOrAdmin,
        zv("json", maintenanceService.proposeWorkOrderInput),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const route = await maintenanceService.proposeWorkOrder(
            ctx,
            c.get("schemeId"),
            c.req.valid("json"),
          );
          return c.json({ route }, 201);
        },
      )
      .post(
        "/:schemeId/work-orders/:workOrderId/complete",
        requireSchemeMember(deps),
        officerOrAdmin,
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const result = await maintenanceService.completeWorkOrder(
            ctx,
            c.get("schemeId"),
            c.req.param("workOrderId"),
          );
          return c.json(result);
        },
      )
      .get("/:schemeId/contractors", requireSchemeMember(deps), async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        return c.json({
          contractors: await maintenanceService.listContractors(ctx, c.get("schemeId")),
        });
      })
      .post(
        "/:schemeId/contractors",
        requireSchemeMember(deps),
        officerOrAdmin,
        zv("json", createContractorInput),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const contractor = await maintenanceService.createContractor(
            ctx,
            c.get("schemeId"),
            c.req.valid("json"),
          );
          return c.json({ contractor }, 201);
        },
      )
  );
}
