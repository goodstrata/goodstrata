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

const MODERATOR_ROLES: MembershipRole[] = [
  "chair",
  "secretary",
  "treasurer",
  "committee_member",
  "manager_admin",
];

const cursorQuery = z.object({ cursor: z.string().optional() });

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

export function communityRoutes(deps: AppDeps) {
  return (
    new Hono<AppEnv>()
      .get(
        "/:schemeId/community/posts",
        requireSchemeMember(deps),
        zv("query", cursorQuery),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const feed = await communityService.listFeed(
            ctx,
            c.get("schemeId"),
            c.get("user").id,
            c.req.valid("query").cursor,
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
        );
        return c.json(thread);
      })
      // Create a post. multipart/form-data (`body` + zero-or-more `images` files)
      // or application/json ({ body }) when there are no images.
      .post("/:schemeId/community/posts", requireSchemeMember(deps), async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const contentType = c.req.header("content-type") ?? "";

        let body: string;
        const files: PostImageUpload[] = [];

        if (contentType.includes("application/json")) {
          const parsed = createPostInput.safeParse(await c.req.json().catch(() => null));
          if (!parsed.success) {
            return c.json({ error: { code: "VALIDATION", message: "Invalid request" } }, 422);
          }
          body = parsed.data.body;
        } else {
          const form = await c.req.parseBody({ all: true });
          const rawBody = form.body;
          const parsed = createPostInput.safeParse({
            body: typeof rawBody === "string" ? rawBody : "",
          });
          if (!parsed.success) {
            return c.json(
              { error: { code: "VALIDATION", message: "A post body is required" } },
              422,
            );
          }
          body = parsed.data.body;

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
              files.push({
                filename: f.name,
                contentType: declared,
                content: new Uint8Array(await f.arrayBuffer()),
              });
            }
          }
        }

        const post = await communityService.createPost(ctx, c.get("schemeId"), { body }, files);
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
