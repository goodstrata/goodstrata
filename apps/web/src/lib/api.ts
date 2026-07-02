import type { Api } from "@goodstrata/api";
import { hc } from "hono/client";

/** Typed RPC client for the GoodStrata API (same-origin via /api). */
export const api = hc<Api>("/api", {
  init: { credentials: "include" },
});

export interface ApiErrorEnvelope {
  error: { code: string; message: string; details?: unknown };
}

export async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as ApiErrorEnvelope;
      message = body.error?.message ?? message;
    } catch {
      // fall through with the generic message
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}
