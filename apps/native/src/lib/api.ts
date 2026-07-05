import { authClient } from "./auth";

const BASE = "https://my.goodstrata.com.au";

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

/** Fetch wrapper that carries the better-auth session cookie from SecureStore. */
export async function api<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { ...cookieHeader(), Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json() as Promise<T>;
}

/**
 * POST wrapper, same session cookie. The ONE write path — screens never
 * hand-roll their own POST helper, so failure copy is uniform: the server's
 * error message when it sends one, the status line otherwise.
 */
export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      ...cookieHeader(),
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let message = `${res.status} ${path}`;
    try {
      const data = (await res.json()) as { error?: { message?: string } };
      if (data?.error?.message) message = data.error.message;
    } catch {
      // keep the status-line message
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}
