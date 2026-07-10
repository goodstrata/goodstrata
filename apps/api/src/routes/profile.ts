import { randomUUID } from "node:crypto";
import { notificationPreferencesService } from "@goodstrata/core";
import {
  NOTIFICATION_GROUPS,
  NOTIFICATION_PREF_CHANNELS,
  NOTIFICATION_TYPE_META,
  NOTIFICATION_TYPES,
  userActor,
} from "@goodstrata/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import type { AppEnv } from "../middleware.js";
import { zv } from "../validate.js";

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

/** One (type, channel, enabled) edit — validated against the shared registry. */
const prefUpdateSchema = z.object({
  type: z.enum(NOTIFICATION_TYPES),
  channel: z.enum(NOTIFICATION_PREF_CHANNELS),
  enabled: z.boolean(),
});

/**
 * The PATCH body accepts either a single edit (the settings screen's per-toggle
 * autosave) or a batch under `updates` (set many at once), so the UI can use
 * whichever fits without a second endpoint.
 */
const prefPatchSchema = z.union([
  prefUpdateSchema,
  z.object({ updates: z.array(prefUpdateSchema).min(1).max(64) }),
]);

/** One device registration: the Expo token is the natural key (upsert target). */
const pushTokenRegisterSchema = z.object({
  token: z.string().min(1).max(4096),
  platform: z.enum(["ios", "android"]),
  deviceName: z.string().max(200).nullish(),
});

const pushTokenDeleteSchema = z.object({ token: z.string().min(1).max(4096) });

/**
 * Compose the settings payload from the shared registry (groups/labels/help) +
 * the user's effective matrix (pref row ⋁ default) + their phone-on-file state.
 * Copy lives once in `@goodstrata/shared`; the API only shapes it.
 */
async function notificationPreferencesPayload(
  deps: AppDeps,
  userId: string,
): Promise<{
  smsAvailable: boolean;
  phone: string | null;
  groups: Array<{
    key: string;
    label: string;
    types: Array<{
      type: string;
      label: string;
      help: string;
      channels: Record<string, boolean>;
    }>;
  }>;
}> {
  const ctx = deps.serviceContext(userActor(userId));
  const [matrix, phone] = await Promise.all([
    notificationPreferencesService.listEffectivePreferences(ctx, userId),
    notificationPreferencesService.resolveUserPhone(ctx, userId),
  ]);
  const groups = NOTIFICATION_GROUPS.map((group) => ({
    key: group.key,
    label: group.label,
    types: group.types.map((type) => ({
      type,
      label: NOTIFICATION_TYPE_META[type].label,
      help: NOTIFICATION_TYPE_META[type].help,
      channels: matrix[type],
    })),
  }));
  return { smsAvailable: phone.hasPhone, phone: phone.phone, groups };
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
  return (
    new Hono<AppEnv>()
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
      })
      // The current user's notification preference matrix: every type × channel
      // with its effective on/off (pref row over default), grouped and labelled
      // for the settings screen, plus phone-on-file state for the SMS column.
      .get("/notification-preferences", async (c) => {
        const user = c.get("user");
        return c.json(await notificationPreferencesPayload(deps, user.id));
      })
      // Upsert one or many (type, channel, enabled). userId is always the session
      // user — never trusted from the body. Storing sms=on with no phone is
      // allowed; send-time gating (phone on file) is the real guard. Returns the
      // fresh full payload so the client can reconcile its optimistic update.
      .patch("/notification-preferences", zv("json", prefPatchSchema), async (c) => {
        const user = c.get("user");
        const body = c.req.valid("json");
        const updates = "updates" in body ? body.updates : [body];
        const ctx = deps.serviceContext(userActor(user.id));
        for (const update of updates) {
          await notificationPreferencesService.upsertPreference(ctx, user.id, {
            notificationType: update.type,
            channel: update.channel,
            enabled: update.enabled,
          });
        }
        return c.json(await notificationPreferencesPayload(deps, user.id));
      })
      // Register (or refresh) this device's Expo push token for the SESSION
      // user. Tokens are per-user, never scheme-scoped — the notifier fans out
      // to every device of a recipient. Upsert on token: a shared device that
      // signs into another account re-points the row (see the service note).
      .post("/push-tokens", zv("json", pushTokenRegisterSchema), async (c) => {
        const user = c.get("user");
        const body = c.req.valid("json");
        const ctx = deps.serviceContext(userActor(user.id));
        const row = await notificationPreferencesService.registerPushToken(ctx, user.id, {
          token: body.token,
          platform: body.platform,
          deviceName: body.deviceName ?? null,
        });
        return c.json({ id: row.id, platform: row.platform }, 201);
      })
      // Forget this device (the sign-out path). Only the session user's own
      // registration can be removed; an unknown token is a no-op, so sign-out
      // stays idempotent even after a server-side prune.
      .delete("/push-tokens", zv("json", pushTokenDeleteSchema), async (c) => {
        const user = c.get("user");
        const body = c.req.valid("json");
        const ctx = deps.serviceContext(userActor(user.id));
        const { removed } = await notificationPreferencesService.removePushToken(
          ctx,
          user.id,
          body.token,
        );
        return c.json({ ok: true, removed });
      })
  );
}
