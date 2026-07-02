import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import type { z } from "zod";

/** zValidator with the project error envelope (422 + issue list). */
export function zv<T extends z.ZodType, Target extends keyof ValidationTargets>(
  target: Target,
  schema: T,
) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          error: {
            code: "VALIDATION",
            message: "Invalid request",
            details: result.error.issues,
          },
        },
        422,
      );
    }
  });
}
