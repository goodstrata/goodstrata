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
 * If `image` is an avatar URL we serve for this user, return its storage key.
 * Anything else (external URL, another user's avatar, traversal attempt) → null.
 */
function ownedAvatarKey(userId: string, image: string | null | undefined): string | null {
  if (!image) return null;
  const prefix = `/api/profile/avatar/${userId}/`;
  if (!image.startsWith(prefix)) return null;
  const file = image.slice(prefix.length);
  if (!file || file.includes("/") || file.includes("..")) return null;
  return `avatars/${userId}/${file}`;
}

/**
 * Profile routes — mounted under the authenticated /api surface, so the parent
 * requireAuth middleware has already put the user on the context.
 *
 * - POST   /profile/avatar   multipart upload → S3 StorageProvider, sets the
 *                            better-auth user.image to a served URL and cleans
 *                            up the previously stored file.
 * - DELETE /profile/avatar   clears user.image and removes the stored file.
 * - GET    /profile/avatar/:userId/:file   member-scoped image content (any
 *                            signed-in member; the filename carries an unguessable
 *                            UUID so keys can't be enumerated).
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

      // The current image (if it's one of ours) becomes garbage once replaced.
      const session = await deps.auth.api.getSession({ headers: c.req.raw.headers });
      const previousKey = ownedAvatarKey(user.id, session?.user.image);

      // Same-origin served URL; an <img> request carries the session cookie so
      // the member-scoped GET below authenticates it.
      const image = `/api/profile/avatar/${user.id}/${filename}`;
      await deps.auth.api.updateUser({
        body: { image },
        headers: c.req.raw.headers,
      });

      if (previousKey && previousKey !== key) {
        // Best effort — an orphaned file must never fail the upload.
        try {
          await deps.integrations.storage.delete(previousKey);
        } catch {
          // ignore
        }
      }

      return c.json({ image }, 201);
    })
    .delete("/avatar", async (c) => {
      const user = c.get("user");
      const session = await deps.auth.api.getSession({ headers: c.req.raw.headers });
      const key = ownedAvatarKey(user.id, session?.user.image);
      await deps.auth.api.updateUser({
        body: { image: null },
        headers: c.req.raw.headers,
      });
      if (key) {
        // Best effort — a leftover file must never fail the removal.
        try {
          await deps.integrations.storage.delete(key);
        } catch {
          // ignore
        }
      }
      return c.json({ ok: true });
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
