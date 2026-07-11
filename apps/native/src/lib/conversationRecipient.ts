export type ConversationRecipient = { kind: "committee" } | { kind: "user"; userId: string };

/**
 * Translate the native recipient picker into the messaging API contract.
 * Plain members are always constrained to the committee even if stale UI
 * state says "user"; only officer-tier callers may address one member.
 */
export function conversationRecipientFor(input: {
  isOfficer: boolean;
  mode: "committee" | "user";
  userId: string;
}): ConversationRecipient | null {
  if (!input.isOfficer || input.mode === "committee") return { kind: "committee" };
  const userId = input.userId.trim();
  return userId ? { kind: "user", userId } : null;
}
