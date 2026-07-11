/**
 * One native backend origin for auth, JSON, binary downloads and multipart
 * uploads. Preview/dev builds can set EXPO_PUBLIC_API_URL; production keeps
 * the canonical origin. Paths passed to api helpers still begin with /api.
 */
export const API_ORIGIN = (
  process.env.EXPO_PUBLIC_API_URL ?? "https://my.goodstrata.com.au"
).replace(/\/$/, "");
