import type { Api } from "@goodstrata/api";
import { hc } from "hono/client";

/** Typed RPC client for the GoodStrata API (same-origin via /api). */
export const api = hc<Api>("/api", {
  init: { credentials: "include" },
});

export interface ApiErrorEnvelope {
  error: { code: string; message: string; details?: unknown };
}

/**
 * A failed API response, preserving the envelope's code and details so
 * callers (e.g. useAppForm) can map 422 zod issues onto fields.
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

export async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let code = "UNKNOWN";
    let details: unknown;
    try {
      const body = (await res.json()) as ApiErrorEnvelope;
      message = body.error?.message ?? message;
      code = body.error?.code ?? code;
      details = body.error?.details;
    } catch {
      // fall through with the generic message
    }
    throw new ApiError(message, { code, status: res.status, details });
  }
  return (await res.json()) as T;
}
