import { authClient } from "./auth";

const BASE = "https://my.goodstrata.com.au";

/** The shape the backend wraps every error in: { error: { code, message, details? } }. */
export interface ApiErrorEnvelope {
  error: { code: string; message: string; details?: unknown };
}

/**
 * A failed API response, preserving the envelope's code/status/details so
 * callers can branch (403 vs 422 field errors, "not a member" vs "closed").
 * Mirrors apps/web/src/lib/api.ts. Extends Error, so existing screens that only
 * read `.message` in a catch keep working unchanged.
 */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(message: string, options: { code: string; status: number; details?: unknown }) {
    super(message);
    this.name = "ApiError";
    this.code = options.code;
    this.status = options.status;
    this.details = options.details;
  }
}

/** Session cookie header, only when one actually exists — a null/undefined
 * header value makes RN's fetch throw before the request even leaves. */
function cookieHeader(): Record<string, string> {
  try {
    const cookies = authClient.getCookie();
    return cookies ? { Cookie: cookies } : {};
  } catch {
    return {};
  }
}

/**
 * Turn a non-ok Response into an ApiError, reading the {error:{...}} envelope
 * when the body is JSON. Falls back to a "<status> <path>" message otherwise,
 * matching the pre-envelope behaviour existing copy relied on.
 */
async function toApiError(res: Response, path: string): Promise<ApiError> {
  let message = `${res.status} ${path}`;
  let code = "UNKNOWN";
  let details: unknown;
  try {
    const body = (await res.json()) as ApiErrorEnvelope;
    if (body?.error?.message) message = body.error.message;
    if (body?.error?.code) code = body.error.code;
    details = body?.error?.details;
  } catch {
    // non-JSON (or empty) body — keep the status-line message
  }
  return new ApiError(message, { code, status: res.status, details });
}

/** Fetch wrapper that carries the better-auth session cookie from SecureStore. */
export async function api<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { ...cookieHeader(), Accept: "application/json" },
  });
  if (!res.ok) throw await toApiError(res, path);
  return res.json() as Promise<T>;
}

/**
 * The ONE write path — POST/PATCH/PUT/DELETE all funnel through here so cookie,
 * JSON encoding, and error-envelope parsing stay uniform. Screens never
 * hand-roll a write helper; failure copy is the server's message when it sends
 * one, the status line otherwise.
 */
async function write<T>(
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...cookieHeader(),
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw await toApiError(res, path);
  return res.json() as Promise<T>;
}

/** POST wrapper, same session cookie + envelope parsing. */
export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return write<T>("POST", path, body);
}

/** PATCH wrapper (partial updates), mirroring apiPost. */
export function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return write<T>("PATCH", path, body);
}

/** PUT wrapper (full replace), mirroring apiPost. */
export function apiPut<T>(path: string, body?: unknown): Promise<T> {
  return write<T>("PUT", path, body);
}

/** DELETE wrapper, mirroring apiPost. Body is optional (most deletes send none). */
export function apiDelete<T>(path: string, body?: unknown): Promise<T> {
  return write<T>("DELETE", path, body);
}
