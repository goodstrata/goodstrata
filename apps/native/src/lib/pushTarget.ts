import { type NotificationTarget, resolveNotificationTarget } from "./notificationTarget";

/**
 * Parse the `data` payload the API's notifier attaches to a push message —
 * `{ schemeId, category, related }`, the same deep-link anchor an in-app bell
 * row carries — and resolve it through the shared notification-target
 * resolver. A push payload crosses a trust boundary (APNs/FCM hand it back as
 * loose JSON), so every field is checked; anything malformed or missing a
 * scheme returns null and the caller falls back to the notifications tab.
 */
export function pushDataToTarget(data: unknown): NotificationTarget | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  if (typeof d.schemeId !== "string" || d.schemeId.length === 0) return null;

  const rawRelated = d.related;
  const related =
    typeof rawRelated === "object" &&
    rawRelated !== null &&
    typeof (rawRelated as Record<string, unknown>).type === "string" &&
    typeof (rawRelated as Record<string, unknown>).id === "string"
      ? (rawRelated as { type: string; id: string })
      : null;

  return resolveNotificationTarget({
    schemeId: d.schemeId,
    related,
    category: typeof d.category === "string" ? d.category : null,
  });
}
