import { messages } from "@goodstrata/db";
import { publishEvent } from "@goodstrata/events";
import { eq } from "drizzle-orm";
import { causationFields, type ServiceContext } from "../context.js";

export interface SendEmailInput {
  schemeId: string;
  personId?: string;
  to: string;
  subject: string;
  /** Plain-text body — stored in the correspondence log and always sent. */
  body: string;
  /** Optional branded HTML body (SES sends both text and html). */
  html?: string;
  template?: string;
  related?: { type: string; id: string };
}

/**
 * Send an email through the correspondence log: every outbound message is a
 * `messages` row plus a `message.sent` event — the log IS the audit trail.
 */
export async function sendEmail(ctx: ServiceContext, input: SendEmailInput) {
  const message = await ctx.db.transaction(async (tx) => {
    const rows = await tx
      .insert(messages)
      .values({
        schemeId: input.schemeId,
        channel: "email",
        direction: "outbound",
        personId: input.personId ?? null,
        toAddress: input.to,
        subject: input.subject,
        body: input.body,
        template: input.template ?? null,
        related: input.related ?? null,
        status: "queued",
      })
      .returning();
    const msg = rows[0]!;

    await publishEvent(tx, {
      schemeId: input.schemeId,
      stream: `message:${msg.id}`,
      type: "message.sent",
      payload: {
        messageId: msg.id,
        channel: "email",
        to: input.to,
        subject: input.subject,
        template: input.template ?? null,
      },
      actor: ctx.actor,
      ...causationFields(ctx),
    });

    return msg;
  });

  try {
    const { providerMessageId } = await ctx.integrations.email.send({
      to: input.to,
      subject: input.subject,
      text: input.body,
      ...(input.html ? { html: input.html } : {}),
    });
    await ctx.db
      .update(messages)
      .set({ status: "sent", providerMessageId, sentAt: ctx.clock.now() })
      .where(eq(messages.id, message.id));
  } catch (err) {
    await ctx.db.update(messages).set({ status: "failed" }).where(eq(messages.id, message.id));
    throw err;
  }

  return message;
}
