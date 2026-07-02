import {
  committeeService,
  createPersonInput,
  documentsService,
  invitesService,
  lotsService,
  onboardingService,
  peopleService,
} from "@goodstrata/core";
import { DOCUMENT_CATEGORIES, MEMBERSHIP_ROLES, userActor } from "@goodstrata/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { type AppEnv, requireRole, requireSchemeMember } from "../middleware.js";
import { zv } from "../validate.js";

const officerOrAdmin = requireRole("chair", "secretary", "treasurer");

export function lotsRoutes(deps: AppDeps) {
  return new Hono<AppEnv>()
    .get("/:schemeId/lots", requireSchemeMember(deps), async (c) => {
      const ctx = deps.serviceContext(userActor(c.get("user").id));
      return c.json({ lots: await lotsService.listLots(ctx, c.get("schemeId")) });
    })
    .post(
      "/:schemeId/lots/import",
      requireSchemeMember(deps),
      officerOrAdmin,
      zv("json", z.object({ csv: z.string().min(1) })),
      async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const result = await lotsService.importLotsCsv(
          ctx,
          c.get("schemeId"),
          c.req.valid("json").csv,
        );
        return c.json(result, 201);
      },
    );
}

export function peopleRoutes(deps: AppDeps) {
  return new Hono<AppEnv>()
    .get("/:schemeId/people", requireSchemeMember(deps), async (c) => {
      const ctx = deps.serviceContext(userActor(c.get("user").id));
      return c.json({ people: await peopleService.listPeople(ctx, c.get("schemeId")) });
    })
    .post(
      "/:schemeId/people",
      requireSchemeMember(deps),
      officerOrAdmin,
      zv("json", createPersonInput),
      async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const person = await peopleService.createPerson(
          ctx,
          c.get("schemeId"),
          c.req.valid("json"),
        );
        return c.json({ person }, 201);
      },
    )
    .post(
      "/:schemeId/people/:personId/invite",
      requireSchemeMember(deps),
      officerOrAdmin,
      zv("json", z.object({ role: z.enum(MEMBERSHIP_ROLES).default("owner") })),
      async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const result = await invitesService.invitePerson(
          ctx,
          c.get("schemeId"),
          c.req.param("personId"),
          c.req.valid("json").role,
          deps.env.APP_URL,
        );
        return c.json({ expiresAt: result.expiresAt }, 201);
      },
    )
    .get("/:schemeId/members", requireSchemeMember(deps), async (c) => {
      const ctx = deps.serviceContext(userActor(c.get("user").id));
      return c.json({ members: await peopleService.listMembers(ctx, c.get("schemeId")) });
    });
}

export function committeeRoutes(deps: AppDeps) {
  return new Hono<AppEnv>()
    .get("/:schemeId/committee", requireSchemeMember(deps), async (c) => {
      const ctx = deps.serviceContext(userActor(c.get("user").id));
      return c.json({
        committee: await committeeService.listCommittee(ctx, c.get("schemeId")),
      });
    })
    .post(
      "/:schemeId/committee",
      requireSchemeMember(deps),
      officerOrAdmin,
      zv(
        "json",
        z.object({
          userId: z.string().min(1),
          role: z.enum(["chair", "secretary", "treasurer", "committee_member"]),
        }),
      ),
      async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const { userId, role } = c.req.valid("json");
        await committeeService.assignCommitteeRole(ctx, c.get("schemeId"), userId, role);
        return c.json({ ok: true }, 201);
      },
    );
}

export function documentsRoutes(deps: AppDeps) {
  return new Hono<AppEnv>()
    .get(
      "/:schemeId/documents",
      requireSchemeMember(deps),
      zv("query", z.object({ category: z.enum(DOCUMENT_CATEGORIES).optional() })),
      async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const docs = await documentsService.listDocuments(
          ctx,
          c.get("schemeId"),
          c.req.valid("query").category,
        );
        return c.json({ documents: docs });
      },
    )
    .get("/:schemeId/documents/:documentId/content", requireSchemeMember(deps), async (c) => {
      const ctx = deps.serviceContext(userActor(c.get("user").id));
      const docs = await documentsService.listDocuments(ctx, c.get("schemeId"));
      const doc = docs.find((d) => d.id === c.req.param("documentId"));
      if (!doc) {
        return c.json({ error: { code: "NOT_FOUND", message: "Document not found" } }, 404);
      }
      // s146 access levels: committee/admin docs need an officer-tier role.
      if (doc.accessLevel !== "owners") {
        const roles = c.get("roles");
        const officer = roles.some((r) =>
          ["chair", "secretary", "treasurer", "committee_member", "manager_admin"].includes(r),
        );
        if (!officer) {
          return c.json({ error: { code: "FORBIDDEN", message: "Committee access only" } }, 403);
        }
      }
      const content = await deps.integrations.storage.get(doc.storageKey);
      return c.body(content.buffer as ArrayBuffer, 200, {
        "content-type": doc.mime,
        "content-disposition": `inline; filename="${doc.title.replace(/[^\w.\- ]/g, "_")}"`,
      });
    })
    .post("/:schemeId/documents", requireSchemeMember(deps), officerOrAdmin, async (c) => {
      const body = await c.req.parseBody();
      const file = body.file;
      const category = typeof body.category === "string" ? body.category : "other";
      if (!(file instanceof File)) {
        return c.json({ error: { code: "NO_FILE", message: "Attach a file" } }, 422);
      }
      const parsedCategory = z.enum(DOCUMENT_CATEGORIES).catch("other").parse(category);
      const ctx = deps.serviceContext(userActor(c.get("user").id));
      const doc = await documentsService.uploadDocument(ctx, c.get("schemeId"), {
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        content: new Uint8Array(await file.arrayBuffer()),
        category: parsedCategory,
        title: typeof body.title === "string" && body.title ? body.title : undefined,
      });
      return c.json({ document: doc }, 201);
    });
}

export function activationRoutes(deps: AppDeps) {
  return new Hono<AppEnv>()
    .get("/:schemeId/onboarding", requireSchemeMember(deps), async (c) => {
      const ctx = deps.serviceContext(userActor(c.get("user").id));
      return c.json(await onboardingService.onboardingStatus(ctx, c.get("schemeId")));
    })
    .post("/:schemeId/activate", requireSchemeMember(deps), officerOrAdmin, async (c) => {
      const ctx = deps.serviceContext(userActor(c.get("user").id));
      await onboardingService.activateScheme(ctx, c.get("schemeId"));
      return c.json({ ok: true });
    });
}

/** Invite acceptance is deliberately outside scheme scoping (not a member yet). */
export function invitesRoutes(deps: AppDeps) {
  return new Hono<AppEnv>().post(
    "/accept",
    zv("json", z.object({ token: z.string() })),
    async (c) => {
      const ctx = deps.serviceContext(userActor(c.get("user").id));
      const result = await invitesService.acceptInvite(ctx, c.req.valid("json").token);
      return c.json(result);
    },
  );
}

/**
 * Public (pre-auth) invite preview: the recipient hasn't got an account yet,
 * and the unguessable token is the credential.
 */
export function publicInviteRoutes(deps: AppDeps) {
  return new Hono().get("/preview", zv("query", z.object({ token: z.string() })), async (c) => {
    const ctx = deps.serviceContext({ kind: "system", id: "invite-preview" });
    return c.json(await invitesService.previewInvite(ctx, c.req.valid("query").token));
  });
}
