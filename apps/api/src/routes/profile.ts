import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { AppDeps } from "../deps.js";
import type { AppEnv } from "../middleware.js";

/** Image content types we accept for avatars, mapped to a stored extension. */
const AVATAR_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** Reverse map: stored extension → content type, for serving. */
const EXT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Profile routes — mounted under the authenticated /api surface, so the parent
 * requireAuth middleware has already put the user on the context.
 *
 * - POST /profile/avatar   multipart upload → S3 StorageProvider, sets the
 *                          better-auth user.image to a served URL.
 * - GET  /profile/avatar/:userId/:file   member-scoped image content (any
 *                          signed-in member; the filename carries an unguessable
 *                          UUID so keys can't be enumerated).
 */
export function profileRoutes(deps: AppDeps) {
  return new Hono<AppEnv>()
    .post("/avatar", async (c) => {
      const user = c.get("user");
      const body = await c.req.parseBody();
      const file = body.file;
      if (!(file instanceof File)) {
        return c.json({ error: { code: "NO_FILE", message: "Attach an image." } }, 422);
      }
      const ext = AVATAR_TYPES[file.type];
      if (!ext) {
        return c.json(
          {
            error: {
              code: "UNSUPPORTED_TYPE",
              message: "Use a PNG, JPEG, WebP or GIF image.",
            },
          },
          422,
        );
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.byteLength === 0) {
        return c.json({ error: { code: "EMPTY_FILE", message: "That image is empty." } }, 422);
      }
      if (bytes.byteLength > MAX_AVATAR_BYTES) {
        return c.json({ error: { code: "TOO_LARGE", message: "Keep images under 5 MB." } }, 422);
      }

      const filename = `${randomUUID()}.${ext}`;
      // Namespaced by user so a delete/cleanup could target a single owner.
      const key = `avatars/${user.id}/${filename}`;
      await deps.integrations.storage.put(key, bytes, file.type);

      // Same-origin served URL; an <img> request carries the session cookie so
      // the member-scoped GET below authenticates it.
      const image = `/api/profile/avatar/${user.id}/${filename}`;
      await deps.auth.api.updateUser({
        body: { image },
        headers: c.req.raw.headers,
      });

      return c.json({ image }, 201);
    })
    .get("/avatar/:userId/:file", async (c) => {
      const userId = c.req.param("userId");
      const fileParam = c.req.param("file");
      // Guard against traversal: params must be plain path segments.
      if (userId.includes("/") || fileParam.includes("/") || fileParam.includes("..")) {
        return c.json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404);
      }
      const ext = fileParam.split(".").pop()?.toLowerCase() ?? "";
      const mime = EXT_MIME[ext];
      if (!mime) {
        return c.json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404);
      }
      const key = `avatars/${userId}/${fileParam}`;
      let content: Uint8Array;
      try {
        content = await deps.integrations.storage.get(key);
      } catch {
        return c.json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404);
      }
      return c.body(content.buffer as ArrayBuffer, 200, {
        "content-type": mime,
        // Content is immutable (UUID filename); cache privately in the browser.
        "cache-control": "private, max-age=86400",
      });
    });
}
