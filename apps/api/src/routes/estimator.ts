// MOUNT: add .route('/api', ...) OUTSIDE requireAuth in app.ts — orchestrator wires this
//
// Public, no-auth lead-gen endpoint. It must NOT sit behind requireAuth: any
// owner can drop in a document without an account. Wire it on the outer app
// (alongside /api/health, /api/demo-info), e.g.:
//
//   .route("/api", estimatorRoutes(deps))
//
// Nothing here is persisted: the uploaded file is read into memory, passed to
// the vision model, and discarded when the request ends.
import { EstimatorError, estimateStrataFees } from "@goodstrata/agents";
import { Hono } from "hono";
import type { AppDeps } from "../deps.js";

/** ~12 MB cap — comfortably covers a photographed page or a multi-page budget PDF. */
const MAX_BYTES = 12 * 1024 * 1024;

/** Per-IP rate limit: protect the LLM from a public, unauthenticated surface. */
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

// In-memory sliding window. Fine for a single instance lead-gen tool; resets on
// deploy. Keyed by client IP.
const hits = new Map<string, number[]>();

function rateLimited(ip: string, now: number): boolean {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  // Opportunistic cleanup so the map can't grow unbounded.
  if (hits.size > 5000) {
    for (const [key, times] of hits) {
      if (times.every((t) => now - t >= RATE_WINDOW_MS)) hits.delete(key);
    }
  }
  return false;
}

function clientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  const fwd = c.req.header("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return c.req.header("x-real-ip") ?? "unknown";
}

export function estimatorRoutes(deps: AppDeps) {
  return new Hono().post("/tools/strata-estimate", async (c) => {
    const now = Date.now();
    const ip = clientIp(c);
    if (rateLimited(ip, now)) {
      return c.json(
        {
          error: {
            code: "RATE_LIMITED",
            message: "You've hit the limit for now. Try again in an hour, or start your building.",
          },
        },
        429,
      );
    }

    let file: unknown;
    try {
      const body = await c.req.parseBody();
      file = body.file;
    } catch {
      return c.json(
        { error: { code: "BAD_REQUEST", message: "Expected a multipart upload." } },
        400,
      );
    }

    if (!(file instanceof File)) {
      return c.json(
        {
          error: {
            code: "BAD_REQUEST",
            message: "Attach a file in the 'file' field (PDF or image).",
          },
        },
        400,
      );
    }

    if (file.size === 0) {
      return c.json({ error: { code: "BAD_REQUEST", message: "That file is empty." } }, 400);
    }

    if (file.size > MAX_BYTES) {
      return c.json(
        {
          error: {
            code: "FILE_TOO_LARGE",
            message: "That file is over 12 MB. Upload a smaller PDF or photo.",
          },
        },
        413,
      );
    }

    const mime = file.type || "application/octet-stream";
    const bytes = new Uint8Array(await file.arrayBuffer());

    try {
      // Reuse the app's configured resolver (env-driven provider); the estimator
      // picks the vision model key. File is discarded when this handler returns.
      const result = await estimateStrataFees(
        { bytes, mime, filename: file.name },
        { resolveModel: deps.resolveModel },
      );
      return c.json(result);
    } catch (err) {
      if (err instanceof EstimatorError) {
        if (err.code === "UNSUPPORTED_MEDIA") {
          return c.json({ error: { code: "UNSUPPORTED_MEDIA", message: err.message } }, 415);
        }
        return c.json(
          {
            error: {
              code: "ESTIMATE_FAILED",
              message: "We couldn't read that document. Try a clearer scan or a different page.",
            },
          },
          502,
        );
      }
      console.error("[estimator] unhandled", err);
      return c.json(
        { error: { code: "INTERNAL", message: "Something went wrong reading your document." } },
        500,
      );
    }
  });
}
