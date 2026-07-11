import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Mail, MailOpen, SquarePen, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api, unwrap } from "@/lib/api";
import { useSession } from "@/lib/auth";
import { FormError, fieldError, SubmitButton, useAppForm } from "@/lib/form";
import { formatDate, formatDateTime } from "@/lib/format";
import {
  CONVERSATION_MESSAGES_KEY,
  CONVERSATIONS_KEY,
  type ConversationMessageView,
  type ConversationSummary,
  type ConversationsPage,
  MESSAGES_UNREAD_KEY,
  MESSAGING_POLL_INTERVAL,
  type MessagesPage,
} from "@/lib/messaging";
import { useIsCommittee } from "@/lib/roles";
import { useIsMobile } from "@/lib/use-mobile";
import { useSheetSide } from "@/lib/use-sheet-side";
import { cn } from "@/lib/utils";

/**
 * Private messages (DMs): a member writes to the committee as a group or to a
 * specific officer/manager; officers can write to any member. The server
 * enforces the officer-on-one-side rule and participant-only reads — this UI
 * only shapes the choices. Polling v1: inbox, thread and badge all refetch on
 * the shared interval.
 */

const MAX_BODY_CHARS = 5000; // mirrors sendMessageInput / startConversationInput
const MAX_SUBJECT_CHARS = 200;

/** Officer-tier roles a plain member may address directly (mirrors core's OFFICER_ROLES). */
const OFFICER_TIER = new Set([
  "chair",
  "secretary",
  "treasurer",
  "committee_member",
  "manager_admin",
]);

/** Initials for an avatar fallback (mirrors routes/__root.tsx). */
function initials(name: string): string {
  const source = name.trim() || "?";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

/** Feed-friendly relative time, with the absolute available as a tooltip. */
function relativeTime(iso: string): string {
  const secs = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 45) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(iso);
}

/** Show remaining characters only once the writer is close to the limit. */
function charactersLeftHint(value: string): string | undefined {
  const left = MAX_BODY_CHARS - value.length;
  if (left > 500) return undefined;
  return left >= 0
    ? `${left.toLocaleString()} characters left`
    : `${(-left).toLocaleString()} characters over the limit`;
}

/** The inbox row's "who": other participants' names, joined. */
function participantNames(c: ConversationSummary): string {
  if (c.otherParticipants.length === 0) return "Conversation";
  return c.otherParticipants.map((p) => p.name).join(", ");
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

export function MessagesSection({ schemeId }: { schemeId: string }) {
  const isMobile = useIsMobile(768);
  const isCommittee = useIsCommittee(schemeId);
  const [openId, setOpenId] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);

  const inbox = useInfiniteQuery({
    queryKey: CONVERSATIONS_KEY(schemeId),
    queryFn: async ({ pageParam }) =>
      unwrap<ConversationsPage>(
        await api.schemes[":schemeId"].messages.conversations.$get({
          param: { schemeId },
          query: { cursor: pageParam },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor,
    refetchInterval: MESSAGING_POLL_INTERVAL,
  });

  const conversations = inbox.data?.pages.flatMap((page) => page.conversations) ?? [];
  const open = conversations.find((c) => c.id === openId) ?? null;

  const newMessageButton = (
    <Button onClick={() => setComposeOpen(true)}>
      <SquarePen aria-hidden="true" className="size-4" />
      New message
    </Button>
  );

  const empty = !inbox.isPending && !inbox.isError && conversations.length === 0;

  let body: React.ReactNode;
  if (inbox.isError) {
    body = (
      <ErrorState
        message={
          inbox.error instanceof Error ? inbox.error.message : "Couldn't load your messages."
        }
        onRetry={() => void inbox.refetch()}
      />
    );
  } else if (inbox.isPending) {
    body = (
      <div className="space-y-2">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
    );
  } else if (empty) {
    body = (
      <EmptyState
        icon={Mail}
        title="No messages yet"
        description="Start a private conversation — a question for the committee, or a note to your manager."
        action={newMessageButton}
      />
    );
  } else {
    const list = (
      <InboxList
        inbox={inbox}
        conversations={conversations}
        openId={open?.id ?? null}
        onOpen={setOpenId}
      />
    );
    body = isMobile ? (
      open ? (
        <ConversationView schemeId={schemeId} conversation={open} onBack={() => setOpenId(null)} />
      ) : (
        list
      )
    ) : (
      <div className="grid grid-cols-[minmax(0,18rem)_minmax(0,1fr)] items-start gap-4">
        {list}
        {open ? (
          <ConversationView schemeId={schemeId} conversation={open} />
        ) : (
          <EmptyState
            icon={MailOpen}
            title="Select a conversation"
            description="Choose a conversation from the list, or start a new one."
            className="min-h-64"
          />
        )}
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 space-y-1">
          <h2 className="font-display text-2xl font-semibold tracking-tight">Messages</h2>
          <p className="text-sm text-muted-foreground">
            {isCommittee
              ? "Private messages with owners and residents of this scheme."
              : "Message your committee or strata manager privately."}
          </p>
        </div>
        {/* The empty state carries the action; on a mobile thread the back
            control leads — either way the button renders exactly once. */}
        {!empty && (!isMobile || open === null) && (
          <div className="flex shrink-0 items-center gap-2">{newMessageButton}</div>
        )}
      </div>

      {body}

      <NewMessageSheet
        schemeId={schemeId}
        open={composeOpen}
        onOpenChange={setComposeOpen}
        onStarted={(conversationId) => {
          setComposeOpen(false);
          setOpenId(conversationId);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------

function InboxList({
  inbox,
  conversations,
  openId,
  onOpen,
}: {
  inbox: {
    hasNextPage: boolean;
    isFetchingNextPage: boolean;
    fetchNextPage: () => unknown;
  };
  conversations: ConversationSummary[];
  openId: string | null;
  onOpen: (id: string) => void;
}) {
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <ul aria-label="Conversations" className="divide-y">
        {conversations.map((c) => {
          const active = c.id === openId;
          const soleParticipant = c.otherParticipants.length === 1 ? c.otherParticipants[0]! : null;
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onOpen(c.id)}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "flex w-full items-start gap-2.5 px-3 py-3 text-left transition-colors hover:bg-muted/60",
                  active && "bg-accent hover:bg-accent",
                )}
              >
                {soleParticipant ? (
                  <Avatar size="sm" className="mt-0.5">
                    {soleParticipant.image && <AvatarImage src={soleParticipant.image} alt="" />}
                    <AvatarFallback>{initials(soleParticipant.name)}</AvatarFallback>
                  </Avatar>
                ) : (
                  <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
                    <Users aria-hidden="true" className="size-4 text-muted-foreground" />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span
                      className={cn(
                        "truncate text-sm",
                        c.unreadCount > 0 ? "font-semibold" : "font-medium",
                      )}
                    >
                      {participantNames(c)}
                    </span>
                    <time
                      dateTime={c.lastMessageAt}
                      title={formatDateTime(c.lastMessageAt)}
                      className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums"
                    >
                      {relativeTime(c.lastMessageAt)}
                    </time>
                  </span>
                  {c.subject && (
                    <span className="block truncate text-sm text-foreground/90">{c.subject}</span>
                  )}
                  <span className="flex items-center justify-between gap-2">
                    <span
                      className={cn(
                        "truncate text-xs",
                        c.unreadCount > 0 ? "font-medium text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {c.lastMessage?.body ?? "No messages"}
                    </span>
                    {c.unreadCount > 0 && (
                      <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-primary px-1 font-mono text-[10px] font-semibold text-primary-foreground tabular-nums">
                        {c.unreadCount > 99 ? "99+" : c.unreadCount}
                        <span className="sr-only"> unread</span>
                      </span>
                    )}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {inbox.hasNextPage && (
        <div className="flex justify-center border-t p-2">
          <Button
            variant="ghost"
            size="sm"
            pending={inbox.isFetchingNextPage}
            onClick={() => void inbox.fetchNextPage()}
          >
            Load older conversations
          </Button>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Conversation thread
// ---------------------------------------------------------------------------

const replySchema = z.object({
  body: z
    .string()
    .min(1, "Write a message to send.")
    .max(MAX_BODY_CHARS, `Messages can be up to ${MAX_BODY_CHARS.toLocaleString()} characters.`),
});
type ReplyValues = z.infer<typeof replySchema>;

function ConversationView({
  schemeId,
  conversation,
  onBack,
}: {
  schemeId: string;
  conversation: ConversationSummary;
  /** Present on mobile, where the thread replaces the list. */
  onBack?: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const currentUserId = session?.user?.id;
  const conversationId = conversation.id;
  const scrollRef = useRef<HTMLDivElement>(null);

  const thread = useInfiniteQuery({
    queryKey: CONVERSATION_MESSAGES_KEY(schemeId, conversationId),
    queryFn: async ({ pageParam }) =>
      unwrap<MessagesPage>(
        await api.schemes[":schemeId"].messages.conversations[":conversationId"].messages.$get({
          param: { schemeId, conversationId },
          query: { cursor: pageParam },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor,
    refetchInterval: MESSAGING_POLL_INTERVAL,
  });

  // API pages are newest-first; render oldest→newest, newest at the bottom.
  const newestFirst = thread.data?.pages.flatMap((page) => page.messages) ?? [];
  const messages = [...newestFirst].reverse();
  const newestId = newestFirst[0]?.id;

  const markRead = useMutation({
    mutationFn: async () =>
      unwrap<{ conversationId: string }>(
        await api.schemes[":schemeId"].messages.conversations[":conversationId"].read.$post({
          param: { schemeId, conversationId },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY(schemeId) });
      void queryClient.invalidateQueries({ queryKey: MESSAGES_UNREAD_KEY(schemeId) });
    },
  });

  // Reading the thread IS the read receipt: whenever a newer message shows up
  // on screen (including on open), move the watermark and refresh the badges.
  const markReadRef = useRef(markRead.mutate);
  markReadRef.current = markRead.mutate;
  useEffect(() => {
    if (newestId) markReadRef.current();
  }, [newestId]);

  // Keep the newest message in view when it changes (and on first load).
  useEffect(() => {
    if (!newestId) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [newestId]);

  const formRef = useRef<{ reset: () => void } | null>(null);
  const form = useAppForm<ReplyValues>({
    schema: replySchema,
    defaultValues: { body: "" },
    onSubmit: async ({ body }) => {
      await unwrap(
        await api.schemes[":schemeId"].messages.conversations[":conversationId"].messages.$post({
          param: { schemeId, conversationId },
          json: { body },
        }),
      );
      formRef.current?.reset();
      await queryClient.invalidateQueries({
        queryKey: CONVERSATION_MESSAGES_KEY(schemeId, conversationId),
      });
      void queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY(schemeId) });
    },
  });
  formRef.current = form;

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex items-center gap-2 border-b px-3 py-2.5">
        {onBack && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onBack}
            aria-label="Back to conversations"
            className="shrink-0"
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
          </Button>
        )}
        <div className="min-w-0 leading-tight">
          <p className="truncate text-sm font-medium">{participantNames(conversation)}</p>
          {conversation.subject && (
            <p className="truncate text-xs text-muted-foreground">{conversation.subject}</p>
          )}
        </div>
      </div>

      <div ref={scrollRef} className="max-h-[55dvh] min-h-48 overflow-y-auto px-3 py-3">
        {thread.isError ? (
          <ErrorState
            message={
              thread.error instanceof Error ? thread.error.message : "Couldn't load the messages."
            }
            onRetry={() => void thread.refetch()}
          />
        ) : thread.isPending ? (
          <div className="space-y-3">
            <Skeleton className="h-12 w-3/4" />
            <Skeleton className="ml-auto h-12 w-3/4" />
            <Skeleton className="h-12 w-2/3" />
          </div>
        ) : (
          <>
            {thread.hasNextPage && (
              <div className="mb-3 flex justify-center">
                <Button
                  variant="outline"
                  size="sm"
                  pending={thread.isFetchingNextPage}
                  onClick={() => void thread.fetchNextPage()}
                >
                  Load earlier messages
                </Button>
              </div>
            )}
            <ol aria-live="polite" className="space-y-3">
              {messages.map((m) => (
                <MessageBubble key={m.id} message={m} mine={m.sender?.userId === currentUserId} />
              ))}
            </ol>
          </>
        )}
      </div>

      <form
        className="border-t px-3 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void form.handleSubmit();
        }}
      >
        <form.Field name="body">
          {(field) => (
            <Field
              label="Reply"
              error={fieldError(field.state.meta.errors)}
              hint={charactersLeftHint(field.state.value)}
            >
              {(control) => (
                <Textarea
                  id={control.id}
                  aria-invalid={control["aria-invalid"]}
                  aria-describedby={control["aria-describedby"]}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="Write a message…"
                  rows={2}
                  enterKeyHint="send"
                />
              )}
            </Field>
          )}
        </form.Field>
        <FormError form={form} className="mt-2" />
        <div className="mt-2 flex justify-end">
          <SubmitButton form={form} size="sm">
            Send
          </SubmitButton>
        </div>
      </form>
    </Card>
  );
}

function MessageBubble({ message, mine }: { message: ConversationMessageView; mine: boolean }) {
  return (
    <li className={cn("flex", mine && "justify-end")}>
      <div className={cn("max-w-[85%] min-w-0", mine && "text-right")}>
        <p className="mb-0.5 flex items-baseline gap-2 text-xs text-muted-foreground">
          {!mine && (
            <span className="truncate font-medium text-foreground">
              {message.sender?.name ?? "Former member"}
            </span>
          )}
          <time
            dateTime={message.createdAt}
            title={formatDateTime(message.createdAt)}
            className={cn("shrink-0 font-mono tabular-nums", mine && "ml-auto")}
          >
            {relativeTime(message.createdAt)}
          </time>
        </p>
        <div
          className={cn(
            "inline-block rounded-lg px-3 py-2 text-left text-sm leading-relaxed break-words whitespace-pre-wrap",
            mine ? "bg-accent text-accent-foreground" : "border bg-card",
          )}
        >
          {message.body}
        </div>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// New message
// ---------------------------------------------------------------------------

const COMMITTEE_RECIPIENT = "committee";

const newMessageSchema = z.object({
  to: z.string().min(1, "Choose who to message."),
  subject: z
    .string()
    .max(MAX_SUBJECT_CHARS, `Subjects can be up to ${MAX_SUBJECT_CHARS} characters.`),
  body: z
    .string()
    .min(1, "Write a message to send.")
    .max(MAX_BODY_CHARS, `Messages can be up to ${MAX_BODY_CHARS.toLocaleString()} characters.`),
});
type NewMessageValues = z.infer<typeof newMessageSchema>;

function NewMessageSheet({
  schemeId,
  open,
  onOpenChange,
  onStarted,
}: {
  schemeId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStarted: (conversationId: string) => void;
}) {
  const queryClient = useQueryClient();
  const sheetSide = useSheetSide();
  const { data: session } = useSession();
  const currentUserId = session?.user?.id;
  const isCommittee = useIsCommittee(schemeId);

  // Same query keys as CommitteeSection, so the caches are shared.
  const { data: members } = useQuery({
    queryKey: ["members", schemeId],
    queryFn: async () =>
      unwrap<{ members: { userId: string; name: string; email: string }[] }>(
        await api.schemes[":schemeId"].members.$get({ param: { schemeId } }),
      ),
    enabled: open,
  });
  const { data: committee } = useQuery({
    queryKey: ["committee", schemeId],
    queryFn: async () =>
      unwrap<{ committee: { userId: string | null; role: string }[] }>(
        await api.schemes[":schemeId"].committee.$get({ param: { schemeId } }),
      ),
    enabled: open,
  });

  // Roles per officer-tier user, for labelling and (for plain members) the
  // allowed recipient set. The server enforces the officer-on-one-side rule
  // regardless of what is offered here.
  const officerRoles = new Map<string, string[]>();
  for (const row of committee?.committee ?? []) {
    if (!row.userId || !OFFICER_TIER.has(row.role)) continue;
    officerRoles.set(row.userId, [...(officerRoles.get(row.userId) ?? []), row.role]);
  }

  const people = (members?.members ?? [])
    .filter((m) => m.userId !== currentUserId)
    .filter((m) => (isCommittee ? true : officerRoles.has(m.userId)))
    .map((m) => ({
      userId: m.userId,
      name: m.name,
      detail: officerRoles.get(m.userId)?.join(", ").replace(/_/g, " ") ?? m.email,
    }));

  const formRef = useRef<{ reset: () => void } | null>(null);
  const form = useAppForm<NewMessageValues>({
    schema: newMessageSchema,
    defaultValues: { to: COMMITTEE_RECIPIENT, subject: "", body: "" },
    onSubmit: async ({ to, subject, body }) => {
      const { conversation } = await unwrap<{ conversation: ConversationSummary }>(
        await api.schemes[":schemeId"].messages.conversations.$post({
          param: { schemeId },
          json: {
            subject: subject.trim() === "" ? undefined : subject.trim(),
            body,
            to:
              to === COMMITTEE_RECIPIENT
                ? { kind: "committee" as const }
                : { kind: "user" as const, userId: to },
          },
        }),
      );
      toast.success("Message sent");
      formRef.current?.reset();
      await queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY(schemeId) });
      onStarted(conversation.id);
    },
  });
  formRef.current = form;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={sheetSide.side} className={sheetSide.className}>
        <SheetHeader>
          <SheetTitle>New message</SheetTitle>
          <SheetDescription>
            {isCommittee
              ? "Write privately to any member of this scheme, or to the committee as a group."
              : "Write privately to your committee, or to a specific office holder or manager."}
          </SheetDescription>
        </SheetHeader>
        <form
          className="space-y-4 px-4 pb-8"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <form.Field name="to">
            {(field) => (
              <Field label="To" error={fieldError(field.state.meta.errors)}>
                {(control) => (
                  <Select value={field.state.value} onValueChange={(v) => field.handleChange(v)}>
                    <SelectTrigger
                      id={control.id}
                      aria-invalid={control["aria-invalid"]}
                      aria-describedby={control["aria-describedby"]}
                      className="w-full"
                    >
                      <SelectValue placeholder="Choose a recipient…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={COMMITTEE_RECIPIENT}>The committee</SelectItem>
                      {people.map((p) => (
                        <SelectItem key={p.userId} value={p.userId}>
                          {p.name} ({p.detail})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </Field>
            )}
          </form.Field>

          <form.Field name="subject">
            {(field) => (
              <Field
                label="Subject"
                hint="Optional — what the conversation is about."
                error={fieldError(field.state.meta.errors)}
              >
                {(control) => (
                  <Input
                    id={control.id}
                    aria-invalid={control["aria-invalid"]}
                    aria-describedby={control["aria-describedby"]}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="e.g. Bin room door"
                  />
                )}
              </Field>
            )}
          </form.Field>

          <form.Field name="body">
            {(field) => (
              <Field
                label="Message"
                error={fieldError(field.state.meta.errors)}
                hint={charactersLeftHint(field.state.value)}
              >
                {(control) => (
                  <Textarea
                    id={control.id}
                    aria-invalid={control["aria-invalid"]}
                    aria-describedby={control["aria-describedby"]}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="Write your message…"
                    rows={4}
                  />
                )}
              </Field>
            )}
          </form.Field>

          <FormError form={form} />
          <SubmitButton form={form} className="w-full sm:w-auto">
            Send message
          </SubmitButton>
        </form>
      </SheetContent>
    </Sheet>
  );
}
