import {
  addOwnerInput,
  committeeService,
  createPersonInput,
  documentsService,
  endOwnershipInput,
  invitesService,
  lotsService,
  onboardingService,
  ownershipsService,
  peopleService,
  updateOwnershipInput,
  updatePersonInput,
} from "@goodstrata/core";
import {
  DOCUMENT_ACCESS_LEVELS,
  DOCUMENT_CATEGORIES,
  INVITABLE_ROLES,
  userActor,
} from "@goodstrata/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { type AppEnv, requireRole, requireSchemeMember } from "../middleware.js";
import { zv } from "../validate.js";

const officerOrAdmin = requireRole("chair", "secretary", "treasurer");

/**
 * MIME types safe to render inline in the app origin. The stored `mime` is
 * client-supplied (`file.type` at upload), so serving it verbatim with an
 * `inline` disposition would let an officer upload `text/html` with a `<script>`
 * body and have any member's browser execute it same-origin (stored XSS →
 * session-riding). Anything not on this allowlist is served as a non-renderable
 * `application/octet-stream` download, and `nosniff` stops content-sniffing past
 * it — mirroring the community-image handler's defense. Plain-text types are
 * safe (browsers never execute them, and `nosniff` blocks reinterpretation) and
 * are what the in-app viewer renders as markdown — `text/html` stays banned.
 */
const INLINE_SAFE_DOC_TYPES: ReadonlySet<string> = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
]);

export function lotsRoutes(deps: AppDeps) {
  return new Hono<AppEnv>()
    .get("/:schemeId/lots/mine", requireSchemeMember(deps), async (c) => {
      const ctx = deps.serviceContext(userActor(c.get("user").id));
      const userId = c.get("user").id;
      const allLots = await lotsService.listLots(ctx, c.get("schemeId"));
      const lots = allLots
        .filter((lot) => lot.owners.some((owner) => owner.userId === userId))
        .map((lot) => ({
          ...lot,
          // A personal endpoint never returns the other co-owner's contact details.
          owners: lot.owners.filter((owner) => owner.userId === userId),
        }));
      return c.json({ lots });
    })
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
    )
    .post(
      "/:schemeId/lots/:lotId/owners",
      requireSchemeMember(deps),
      officerOrAdmin,
      zv("json", addOwnerInput),
      async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const ownership = await ownershipsService.addOwner(
          ctx,
          c.get("schemeId"),
          c.req.param("lotId"),
          c.req.valid("json"),
        );
        return c.json({ ownership }, 201);
      },
    )
    .post(
      "/:schemeId/lots/:lotId/owners/:ownershipId/end",
      requireSchemeMember(deps),
      officerOrAdmin,
      zv("json", endOwnershipInput),
      async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const ownership = await ownershipsService.endOwnership(
          ctx,
          c.get("schemeId"),
          c.req.param("lotId"),
          c.req.param("ownershipId"),
          c.req.valid("json"),
        );
        return c.json({ ownership });
      },
    )
    .post(
      "/:schemeId/lots/:lotId/owners/:ownershipId/levy-recipient",
      requireSchemeMember(deps),
      officerOrAdmin,
      async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const ownership = await ownershipsService.setLevyRecipient(
          ctx,
          c.get("schemeId"),
          c.req.param("lotId"),
          c.req.param("ownershipId"),
        );
        return c.json({ ownership });
      },
    )
    .patch(
      "/:schemeId/lots/:lotId/owners/:ownershipId",
      requireSchemeMember(deps),
      officerOrAdmin,
      zv("json", updateOwnershipInput),
      async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const ownership = await ownershipsService.updateOwnership(
          ctx,
          c.get("schemeId"),
          c.req.param("lotId"),
          c.req.param("ownershipId"),
          c.req.valid("json"),
        );
        return c.json({ ownership });
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
    .patch(
      "/:schemeId/people/:personId",
      requireSchemeMember(deps),
      officerOrAdmin,
      zv("json", updatePersonInput),
      async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const person = await peopleService.updatePerson(
          ctx,
          c.get("schemeId"),
          c.req.param("personId"),
          c.req.valid("json"),
        );
        return c.json({ person });
      },
    )
    .post(
      "/:schemeId/people/:personId/invite",
      requireSchemeMember(deps),
      officerOrAdmin,
      zv("json", z.object({ role: z.enum(INVITABLE_ROLES).default("owner") })),
      async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const result = await invitesService.invitePerson(
          ctx,
          c.get("schemeId"),
          c.req.param("personId"),
          c.req.valid("json").role,
          deps.env.APP_URL,
        );
        return c.json({ linked: result.linked, expiresAt: result.expiresAt }, 201);
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

/**
 * Public shape of a register entry. Never exposes the internal storage key or
 * the raw uploader Actor blob — members read files via the content endpoint.
 */
function documentDto(d: {
  id: string;
  title: string;
  category: string;
  mime: string;
  sizeBytes: number;
  accessLevel: string;
  retentionUntil: string | null;
  supersedesDocumentId: string | null;
  createdAt: Date;
}) {
  return {
    id: d.id,
    title: d.title,
    category: d.category,
    mime: d.mime,
    sizeBytes: d.sizeBytes,
    accessLevel: d.accessLevel,
    retentionUntil: d.retentionUntil,
    supersedesDocumentId: d.supersedesDocumentId,
    createdAt: d.createdAt,
  };
}

export function documentsRoutes(deps: AppDeps) {
  return new Hono<AppEnv>()
    .get(
      "/:schemeId/documents",
      requireSchemeMember(deps),
      zv(
        "query",
        z.object({
          category: z.enum(DOCUMENT_CATEGORIES).optional(),
          /** "true" adds superseded revisions to the register (version history). */
          includeSuperseded: z.enum(["true", "false"]).optional(),
        }),
      ),
      async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const query = c.req.valid("query");
        // s146 tiers: the register only lists records this member may read,
        // so an owner never sees a committee record they'd then be refused.
        const docs = await documentsService.listDocuments(
          ctx,
          c.get("schemeId"),
          query.category,
          documentsService.accessLevelsForRoles(c.get("roles")),
          { includeSuperseded: query.includeSuperseded === "true" },
        );
        return c.json({ documents: docs.map(documentDto) });
      },
    )
    .get("/:schemeId/documents/:documentId/history", requireSchemeMember(deps), async (c) => {
      const ctx = deps.serviceContext(userActor(c.get("user").id));
      const doc = await documentsService.getDocument(
        ctx,
        c.get("schemeId"),
        c.req.param("documentId"),
      );
      if (!doc || doc.deletedAt) {
        return c.json({ error: { code: "NOT_FOUND", message: "Document not found" } }, 404);
      }
      // Same s146 tier gate as the content endpoint, applied per revision —
      // an older revision may sit at a different tier than the head.
      const allowed = documentsService.accessLevelsForRoles(c.get("roles"));
      if (!allowed.includes(doc.accessLevel)) {
        return c.json({ error: { code: "FORBIDDEN", message: "Committee access only" } }, 403);
      }
      const chain = await documentsService.getDocumentChain(ctx, c.get("schemeId"), doc.id);
      return c.json({
        documents: chain.filter((d) => allowed.includes(d.accessLevel)).map(documentDto),
      });
    })
    .get("/:schemeId/documents/:documentId/content", requireSchemeMember(deps), async (c) => {
      const ctx = deps.serviceContext(userActor(c.get("user").id));
      const doc = await documentsService.getDocument(
        ctx,
        c.get("schemeId"),
        c.req.param("documentId"),
      );
      // Soft-deleted documents 404 like absent ones; superseded revisions stay
      // served (audit trail) at their original tier.
      if (!doc || doc.deletedAt) {
        return c.json({ error: { code: "NOT_FOUND", message: "Document not found" } }, 404);
      }
      // s146 access levels: committee/admin docs need an officer-tier role.
      const allowed = documentsService.accessLevelsForRoles(c.get("roles"));
      if (!allowed.includes(doc.accessLevel)) {
        return c.json({ error: { code: "FORBIDDEN", message: "Committee access only" } }, 403);
      }
      const content = await deps.integrations.storage.get(doc.storageKey);
      // Never serve a client-supplied mime inline unless it's a known-safe type;
      // otherwise force a download so mislabelled/hostile content can't execute
      // as HTML/script in the app origin.
      const declared = doc.mime.split(";")[0]!.trim().toLowerCase();
      const safeMime = INLINE_SAFE_DOC_TYPES.has(declared) ? declared : "application/octet-stream";
      const disposition = safeMime === "application/octet-stream" ? "attachment" : "inline";
      const safeName = doc.title.replace(/[^\w.\- ]/g, "_");
      return c.body(content.buffer as ArrayBuffer, 200, {
        "content-type": safeMime,
        "content-disposition": `${disposition}; filename="${safeName}"`,
        "x-content-type-options": "nosniff",
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
      const parsedAccess = z
        .enum(DOCUMENT_ACCESS_LEVELS)
        .catch("owners")
        .parse(typeof body.accessLevel === "string" ? body.accessLevel : "owners");
      const ctx = deps.serviceContext(userActor(c.get("user").id));
      const doc = await documentsService.uploadDocument(ctx, c.get("schemeId"), {
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        content: new Uint8Array(await file.arrayBuffer()),
        category: parsedCategory,
        accessLevel: parsedAccess,
        title: typeof body.title === "string" && body.title ? body.title : undefined,
      });
      return c.json({ document: documentDto(doc) }, 201);
    })
    .post(
      "/:schemeId/documents/:documentId/supersede",
      requireSchemeMember(deps),
      officerOrAdmin,
      async (c) => {
        const body = await c.req.parseBody();
        const file = body.file;
        if (!(file instanceof File)) {
          return c.json({ error: { code: "NO_FILE", message: "Attach a file" } }, 422);
        }
        // Unlike plain upload, absent category/accessLevel inherit from the
        // superseded revision (service default) rather than falling back to
        // other/owners.
        const parsedCategory =
          typeof body.category === "string" && body.category
            ? z.enum(DOCUMENT_CATEGORIES).catch("other").parse(body.category)
            : undefined;
        const parsedAccess =
          typeof body.accessLevel === "string" && body.accessLevel
            ? z.enum(DOCUMENT_ACCESS_LEVELS).catch("owners").parse(body.accessLevel)
            : undefined;
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const doc = await documentsService.supersedeDocument(
          ctx,
          c.get("schemeId"),
          c.req.param("documentId"),
          {
            filename: file.name,
            contentType: file.type || "application/octet-stream",
            content: new Uint8Array(await file.arrayBuffer()),
            category: parsedCategory,
            accessLevel: parsedAccess,
            title: typeof body.title === "string" && body.title ? body.title : undefined,
          },
        );
        return c.json({ document: documentDto(doc) }, 201);
      },
    )
    .delete(
      "/:schemeId/documents/:documentId",
      requireSchemeMember(deps),
      officerOrAdmin,
      async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        // Soft-delete; RETENTION_HELD (409) while a statutory retention window
        // is still open (s144: financial records, 7 years).
        await documentsService.deleteDocument(ctx, c.get("schemeId"), c.req.param("documentId"));
        return c.json({ ok: true });
      },
    );
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
