import {
  communityService,
  createCommentInput,
  createPostInput,
  type PostImageUpload,
} from "@goodstrata/core";
import type { MembershipRole } from "@goodstrata/shared";
import { userActor } from "@goodstrata/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { type AppEnv, requireSchemeMember } from "../middleware.js";
import { zv } from "../validate.js";

/**
 * The officer tier: may moderate the board AND is the audience of the private
 * committee-visibility channel (create + read committee posts).
 */
const MODERATOR_ROLES: MembershipRole[] = [
  "chair",
  "secretary",
  "treasurer",
  "committee_member",
  "manager_admin",
];

/** Viewer descriptor the community service uses to scope committee posts. */
function viewerFrom(roles: MembershipRole[]) {
  return { isOfficer: roles.some((r) => MODERATOR_ROLES.includes(r)) };
}

const cursorQuery = z.object({ cursor: z.string().optional() });

/**
 * Feed listing accepts an optional channel filter: `channel=committee` narrows
 * to the committee-visibility discussion. The service composes it with the
 * viewer's visibility scope, so for a non-officer it only ever yields an empty
 * page (never a leak).
 */
const feedQuery = cursorQuery.extend({ channel: z.enum(["committee"]).optional() });

/**
 * Image MIME types we accept for community uploads. The client-supplied
 * Content-Type is NOT trusted for serving: without an allowlist, a member could
 * upload `text/html` with a `<script>` body and the content endpoint would later
 * serve it inline same-origin (stored XSS → member-to-member session-riding). We
 * both reject non-images here and force a safe content-type on serve.
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

export function communityRoutes(deps: AppDeps) {
  return (
    new Hono<AppEnv>()
      .get(
        "/:schemeId/community/posts",
        requireSchemeMember(deps),
        zv("query", feedQuery),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const feed = await communityService.listFeed(
            ctx,
            c.get("schemeId"),
            c.get("user").id,
            c.req.valid("query").cursor,
            viewerFrom(c.get("roles")),
            c.req.valid("query").channel,
          );
          return c.json(feed);
        },
      )
      .get("/:schemeId/community/posts/:postId", requireSchemeMember(deps), async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const thread = await communityService.getThread(
          ctx,
          c.get("schemeId"),
          c.req.param("postId"),
          c.get("user").id,
          viewerFrom(c.get("roles")),
        );
        return c.json(thread);
      })
      // Create a post. multipart/form-data (`body` + zero-or-more `images` files)
      // or application/json ({ body }) when there are no images.
      .post("/:schemeId/community/posts", requireSchemeMember(deps), async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const contentType = c.req.header("content-type") ?? "";

        let body: string;
        let visibility: "scheme" | "committee" | undefined;
        const files: PostImageUpload[] = [];

        if (contentType.includes("application/json")) {
          const parsed = createPostInput.safeParse(await c.req.json().catch(() => null));
          if (!parsed.success) {
            return c.json({ error: { code: "VALIDATION", message: "Invalid request" } }, 422);
          }
          body = parsed.data.body;
          visibility = parsed.data.visibility;
        } else {
          const form = await c.req.parseBody({ all: true });
          const rawBody = form.body;
          const rawVisibility = form.visibility;
          const parsed = createPostInput.safeParse({
            body: typeof rawBody === "string" ? rawBody : "",
            visibility: typeof rawVisibility === "string" ? rawVisibility : undefined,
          });
          if (!parsed.success) {
            return c.json(
              { error: { code: "VALIDATION", message: "A post body is required" } },
              422,
            );
          }
          body = parsed.data.body;
          visibility = parsed.data.visibility;

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
                      message: "Images must be PNG, JPEG, WebP or GIF.",
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
        }

        const post = await communityService.createPost(
          ctx,
          c.get("schemeId"),
          { body, visibility },
          files,
          viewerFrom(c.get("roles")),
        );
        return c.json({ post }, 201);
      })
      .post(
        "/:schemeId/community/posts/:postId/comments",
        requireSchemeMember(deps),
        zv("json", createCommentInput),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const result = await communityService.addComment(
            ctx,
            c.get("schemeId"),
            c.req.param("postId"),
            c.req.valid("json"),
            viewerFrom(c.get("roles")),
          );
          return c.json(result, 201);
        },
      )
      .post("/:schemeId/community/posts/:postId/like", requireSchemeMember(deps), async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const result = await communityService.togglePostLike(
          ctx,
          c.get("schemeId"),
          c.req.param("postId"),
          c.get("user").id,
          viewerFrom(c.get("roles")),
        );
        return c.json(result);
      })
      .post(
        "/:schemeId/community/comments/:commentId/like",
        requireSchemeMember(deps),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const result = await communityService.toggleCommentLike(
            ctx,
            c.get("schemeId"),
            c.req.param("commentId"),
            c.get("user").id,
            viewerFrom(c.get("roles")),
          );
          return c.json(result);
        },
      )
      .get("/:schemeId/community/images/:imageId/content", requireSchemeMember(deps), async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const { row, bytes } = await communityService.getPostImage(
          ctx,
          c.get("schemeId"),
          c.req.param("imageId"),
          viewerFrom(c.get("roles")),
        );
        // Defense in depth: only ever emit a known-safe image content-type. Legacy
        // or otherwise-unexpected stored mimes are served as a non-renderable
        // download so a mislabelled row can't execute as HTML/script in the app
        // origin. `nosniff` stops the browser from content-sniffing past it.
        const safeMime = ALLOWED_IMAGE_TYPES.has(row.mime) ? row.mime : "application/octet-stream";
        const disposition = safeMime === "application/octet-stream" ? "attachment" : "inline";
        return c.body(bytes.buffer as ArrayBuffer, 200, {
          "content-type": safeMime,
          "content-disposition": `${disposition}; filename="${row.id}"`,
          "x-content-type-options": "nosniff",
        });
      })
      // Soft-delete: the author, or any officer, may remove a post/comment.
      .delete("/:schemeId/community/posts/:postId", requireSchemeMember(deps), async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const canModerate = c.get("roles").some((r) => MODERATOR_ROLES.includes(r));
        const result = await communityService.deletePost(
          ctx,
          c.get("schemeId"),
          c.req.param("postId"),
          {
            userId: c.get("user").id,
            canModerate,
          },
        );
        return c.json(result);
      })
      .delete("/:schemeId/community/comments/:commentId", requireSchemeMember(deps), async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const canModerate = c.get("roles").some((r) => MODERATOR_ROLES.includes(r));
        const result = await communityService.deleteComment(
          ctx,
          c.get("schemeId"),
          c.req.param("commentId"),
          { userId: c.get("user").id, canModerate },
        );
        return c.json(result);
      })
  );
}
