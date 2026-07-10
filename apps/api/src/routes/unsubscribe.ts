import { unsubscribeService } from "@goodstrata/core";
import { userActor } from "@goodstrata/shared";
import { Hono } from "hono";
import type { AppDeps } from "../deps.js";

/**
 * Unauthenticated one-click unsubscribe — the target of the email footer link
 * and of the RFC 8058 `List-Unsubscribe` / `List-Unsubscribe-Post` headers.
 * The HMAC-signed token IS the credential: it names one (user, notification
 * type) pair and authorises exactly one narrow write — flip that user's EMAIL
 * preference off for that type. Nothing is readable, nothing widens.
 *
 *  - GET  /api/unsubscribe?token=…  human click → flip + tiny confirmation page
 *  - POST /api/unsubscribe?token=…  mailbox-provider one-click → flip + 200
 */
export function unsubscribeRoutes(deps: AppDeps) {
  const secret = deps.env.UNSUBSCRIBE_SECRET ?? deps.env.BETTER_AUTH_SECRET;

  const apply = async (token: string | undefined) => {
    if (!token) return null;
    // Verify first so the write runs as the token's own user — the signed
    // token is that user's standing instruction, so the audit actor is them.
    const claims = unsubscribeService.verifyUnsubscribeToken(secret, token);
    if (!claims) return null;
    const ctx = deps.serviceContext(userActor(claims.userId));
    return await unsubscribeService.applyUnsubscribe(ctx, secret, token);
  };

  const page = (title: string, detail: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#faf9f7;color:#0f1828;margin:0;padding:48px 20px;">
<div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #dce0e5;border-radius:16px;padding:32px;">
<h1 style="font-size:22px;margin:0 0 12px 0;">${title}</h1>
<p style="font-size:15px;line-height:1.6;color:#4a5360;margin:0;">${detail}</p>
</div></body></html>`;

  return (
    new Hono()
      .get("/", async (c) => {
        const result = await apply(c.req.query("token"));
        if (!result) {
          return c.html(
            page(
              "That link didn't work",
              "The unsubscribe link is invalid or has been superseded. You can manage all your notifications from Settings in the app.",
            ),
            400,
          );
        }
        return c.html(
          page(
            "You're unsubscribed",
            `You won't receive "${result.label}" emails any more. The in-app bell keeps working, and you can turn email back on any time from Settings → Notifications.`,
          ),
        );
      })
      // RFC 8058 one-click: mailbox providers POST the List-Unsubscribe URL
      // as-is (body "List-Unsubscribe=One-Click") — the token rides the query.
      .post("/", async (c) => {
        const result = await apply(c.req.query("token"));
        if (!result) return c.json({ ok: false }, 400);
        return c.json({ ok: true });
      })
  );
}
