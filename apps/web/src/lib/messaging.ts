import { api, unwrap } from "@/lib/api";

/**
 * Shared read models + query plumbing for private messaging (DMs). Shapes
 * mirror the API's messaging read models (packages/core messaging.ts). Kept in
 * its own module so the top-bar unread badge can poll without importing the
 * whole Messages section.
 *
 * Delivery is POLLING v1 (no SSE for private payloads) — every messaging query
 * refetches on the same interval the notifications bell uses.
 */

export interface ParticipantSummary {
  userId: string;
  name: string;
  image: string | null;
}

export interface ConversationSummary {
  id: string;
  subject: string | null;
  /** Everyone in the thread except the caller. */
  otherParticipants: ParticipantSummary[];
  lastMessage: { body: string; senderUserId: string | null; createdAt: string } | null;
  unreadCount: number;
  createdAt: string;
  lastMessageAt: string;
}

export interface ConversationMessageView {
  id: string;
  conversationId: string;
  body: string;
  /** Null when the sender's account has since been deleted. */
  sender: ParticipantSummary | null;
  createdAt: string;
}

export interface ConversationsPage {
  conversations: ConversationSummary[];
  nextCursor?: string;
}

export interface MessagesPage {
  messages: ConversationMessageView[];
  nextCursor?: string;
}

/** Same cadence as NotificationsBell's refetchInterval. */
export const MESSAGING_POLL_INTERVAL = 30_000;

export const CONVERSATIONS_KEY = (schemeId: string) => ["conversations", schemeId] as const;
export const CONVERSATION_MESSAGES_KEY = (schemeId: string, conversationId: string) =>
  ["conversation-messages", schemeId, conversationId] as const;
export const MESSAGES_UNREAD_KEY = (schemeId: string) => ["messages-unread", schemeId] as const;

/** Total-unread badge query (polled) — shared by the bell and the section. */
export function messagesUnreadQueryOptions(schemeId: string) {
  return {
    queryKey: MESSAGES_UNREAD_KEY(schemeId),
    queryFn: async () =>
      unwrap<{ unread: number }>(
        await api.schemes[":schemeId"].messages["unread-count"].$get({ param: { schemeId } }),
      ),
    refetchInterval: MESSAGING_POLL_INTERVAL,
  };
}
