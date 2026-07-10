import { messagingService, sendMessageInput, startConversationInput } from "@goodstrata/core";
import { userActor } from "@goodstrata/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { type AppEnv, requireSchemeMember } from "../middleware.js";
import { zv } from "../validate.js";

const cursorQuery = z.object({ cursor: z.string().optional() });

/**
 * Private messaging (DMs). Every route sits behind requireSchemeMember (404,
 * not 403, for non-members); within the scheme, the service only ever answers
 * for conversations the caller participates in — a non-participant gets 404,
 * so no route here leaks that a conversation exists.
 *
 * Delivery model is POLLING v1: clients poll the inbox / unread badge. No SSE —
 * the hub broadcasts scheme-wide, which would leak private payloads.
 */
export function messagingRoutes(deps: AppDeps) {
  return (
    new Hono<AppEnv>()
      // The caller's inbox: their conversations, newest activity first.
      .get(
        "/:schemeId/messages/conversations",
        requireSchemeMember(deps),
        zv("query", cursorQuery),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const result = await messagingService.listConversations(
            ctx,
            c.get("schemeId"),
            c.get("user").id,
            c.req.valid("query").cursor,
          );
          return c.json(result);
        },
      )
      // Start a conversation (to the committee as a group, or a specific
      // officer/manager — the service enforces the officer-on-one-side rule)
      // with its first message, atomically.
      .post(
        "/:schemeId/messages/conversations",
        requireSchemeMember(deps),
        zv("json", startConversationInput),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const result = await messagingService.startConversation(
            ctx,
            c.get("schemeId"),
            c.req.valid("json"),
          );
          return c.json(result, 201);
        },
      )
      // Cheap total-unread count for the nav badge (polled).
      .get("/:schemeId/messages/unread-count", requireSchemeMember(deps), async (c) => {
        const ctx = deps.serviceContext(userActor(c.get("user").id));
        const result = await messagingService.totalUnread(ctx, c.get("schemeId"), c.get("user").id);
        return c.json(result);
      })
      // A conversation's messages, newest first (participant-only).
      .get(
        "/:schemeId/messages/conversations/:conversationId/messages",
        requireSchemeMember(deps),
        zv("query", cursorQuery),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const result = await messagingService.listMessages(
            ctx,
            c.get("schemeId"),
            c.req.param("conversationId"),
            c.get("user").id,
            c.req.valid("query").cursor,
          );
          return c.json(result);
        },
      )
      // Reply into a conversation the caller participates in.
      .post(
        "/:schemeId/messages/conversations/:conversationId/messages",
        requireSchemeMember(deps),
        zv("json", sendMessageInput),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const result = await messagingService.sendMessage(
            ctx,
            c.get("schemeId"),
            c.req.param("conversationId"),
            c.req.valid("json"),
          );
          return c.json(result, 201);
        },
      )
      // Mark the whole conversation read for the caller.
      .post(
        "/:schemeId/messages/conversations/:conversationId/read",
        requireSchemeMember(deps),
        async (c) => {
          const ctx = deps.serviceContext(userActor(c.get("user").id));
          const result = await messagingService.markRead(
            ctx,
            c.get("schemeId"),
            c.req.param("conversationId"),
            c.get("user").id,
          );
          return c.json(result);
        },
      )
  );
}
