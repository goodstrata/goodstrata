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
              files.push({
                filename: f.name,
                contentType: f.type || "application/octet-stream",
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
        return c.body(bytes.buffer as ArrayBuffer, 200, {
          "content-type": row.mime,
          "content-disposition": `inline; filename="${row.id}"`,
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
