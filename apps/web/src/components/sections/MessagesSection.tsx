import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Mail, MailOpen, Search, SquarePen, Users, X } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
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

function roleLabel(role: string): string {
  const labels: Record<string, string> = {
    chair: "Chair",
    secretary: "Secretary",
    treasurer: "Treasurer",
    committee_member: "Committee member",
    manager_admin: "Scheme manager",
  };
  return labels[role] ?? role.replaceAll("_", " ");
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

export function MessagesSection({ schemeId }: { schemeId: string }) {
  const isMobile = useIsMobile(768);
  const isCommittee = useIsCommittee(schemeId);
  const [openId, setOpenId] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [returnFocusId, setReturnFocusId] = useState<string | null>(null);

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

  const conversations = useMemo(
    () => inbox.data?.pages.flatMap((page) => page.conversations) ?? [],
    [inbox.data],
  );
  const deferredSearch = useDeferredValue(search.trim().toLocaleLowerCase());
  const visibleConversations = useMemo(
    () =>
      conversations.filter((conversation) => {
        if (unreadOnly && conversation.unreadCount === 0) return false;
        if (!deferredSearch) return true;
        return [
          participantNames(conversation),
          conversation.subject,
          conversation.lastMessage?.body,
        ]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase()
          .includes(deferredSearch);
      }),
    [conversations, deferredSearch, unreadOnly],
  );
  const open = conversations.find((c) => c.id === openId) ?? null;

  // On a phone the thread replaces the inbox. Returning restores keyboard
  // focus to the row that opened it, while search/filter state stays intact.
  useEffect(() => {
    if (!isMobile || openId !== null || !returnFocusId) return;
    const frame = requestAnimationFrame(() => {
      const row = document.getElementById(`conversation-${returnFocusId}`);
      const searchField = document.getElementById("conversation-search");
      (row ?? searchField)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [isMobile, openId, returnFocusId]);

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
        conversations={visibleConversations}
        totalCount={conversations.length}
        openId={open?.id ?? null}
        search={search}
        unreadOnly={unreadOnly}
        onSearchChange={setSearch}
        onUnreadOnlyChange={setUnreadOnly}
        onOpen={(conversationId) => {
          setReturnFocusId(conversationId);
          setOpenId(conversationId);
        }}
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
          setReturnFocusId(conversationId);
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
  totalCount,
  openId,
  search,
  unreadOnly,
  onSearchChange,
  onUnreadOnlyChange,
  onOpen,
}: {
  inbox: {
    hasNextPage: boolean;
    isFetchingNextPage: boolean;
    fetchNextPage: () => unknown;
  };
  conversations: ConversationSummary[];
  totalCount: number;
  openId: string | null;
  search: string;
  unreadOnly: boolean;
  onSearchChange: (value: string) => void;
  onUnreadOnlyChange: (value: boolean) => void;
  onOpen: (id: string) => void;
}) {
  const filtering = search.trim() !== "" || unreadOnly;
  return (
    <div className="min-w-0 space-y-2.5">
      <div className="space-y-2 rounded-lg border bg-card p-2.5">
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            id="conversation-search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search loaded conversations"
            aria-label="Search loaded conversations"
            className="h-9 pr-9 pl-8"
          />
          {search && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Clear conversation search"
              onClick={() => onSearchChange("")}
              className="absolute top-1/2 right-1.5 -translate-y-1/2"
            >
              <X aria-hidden="true" />
            </Button>
          )}
        </div>
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant={unreadOnly ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={unreadOnly}
            onClick={() => onUnreadOnlyChange(!unreadOnly)}
          >
            Unread only
          </Button>
          <span className="text-xs text-muted-foreground" role="status">
            {conversations.length} of {totalCount}
          </span>
        </div>
      </div>

      <Card className="gap-0 overflow-hidden py-0">
        {conversations.length === 0 && filtering ? (
          <div
            className="flex min-h-48 flex-col items-center justify-center gap-2 px-5 py-8 text-center"
            role="status"
          >
            <Search aria-hidden="true" className="size-5 text-muted-foreground" />
            <p className="text-sm font-medium">No conversations match</p>
            <p className="text-xs text-muted-foreground">
              Try another search or show all messages.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                onSearchChange("");
                onUnreadOnlyChange(false);
              }}
            >
              Clear filters
            </Button>
          </div>
        ) : (
          <ul aria-label="Conversations" className="divide-y">
            {conversations.map((conversation) => {
              const active = conversation.id === openId;
              const soleParticipant =
                conversation.otherParticipants.length === 1
                  ? conversation.otherParticipants[0]!
                  : null;
              return (
                <li key={conversation.id}>
                  <button
                    id={`conversation-${conversation.id}`}
                    type="button"
                    onClick={() => onOpen(conversation.id)}
                    aria-current={active ? "true" : undefined}
                    className={cn(
                      "relative flex w-full items-start gap-2.5 px-3 py-3 text-left transition-colors hover:bg-muted/60",
                      active && "bg-accent hover:bg-accent",
                      conversation.unreadCount > 0 &&
                        "before:absolute before:inset-y-3 before:left-0 before:w-0.5 before:rounded-full before:bg-primary",
                    )}
                  >
                    {soleParticipant ? (
                      <Avatar size="sm" className="mt-0.5">
                        {soleParticipant.image && (
                          <AvatarImage src={soleParticipant.image} alt="" />
                        )}
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
                            conversation.unreadCount > 0 ? "font-semibold" : "font-medium",
                          )}
                        >
                          {participantNames(conversation)}
                        </span>
                        <time
                          dateTime={conversation.lastMessageAt}
                          title={formatDateTime(conversation.lastMessageAt)}
                          className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums"
                        >
                          {relativeTime(conversation.lastMessageAt)}
                        </time>
                      </span>
                      {conversation.subject && (
                        <span className="block truncate text-sm text-foreground/90">
                          {conversation.subject}
                        </span>
                      )}
                      <span className="flex items-center justify-between gap-2">
                        <span
                          className={cn(
                            "truncate text-xs",
                            conversation.unreadCount > 0
                              ? "font-medium text-foreground"
                              : "text-muted-foreground",
                          )}
                        >
                          {conversation.lastMessage?.body ?? "No messages"}
                        </span>
                        {conversation.unreadCount > 0 && (
                          <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-primary px-1 font-mono text-[10px] font-semibold text-primary-foreground tabular-nums">
                            {conversation.unreadCount > 99 ? "99+" : conversation.unreadCount}
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
        )}
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
    </div>
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
  const headingId = `conversation-thread-${conversationId}`;
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
  const newestFirst = useMemo(
    () => thread.data?.pages.flatMap((page) => page.messages) ?? [],
    [thread.data],
  );
  const messages = useMemo(() => [...newestFirst].reverse(), [newestFirst]);
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
    <section aria-labelledby={headingId}>
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
            <h3 id={headingId} className="truncate text-sm font-medium">
              {participantNames(conversation)}
            </h3>
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
          aria-label={`Reply to ${participantNames(conversation)}`}
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
    </section>
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
  const membersQuery = useQuery({
    queryKey: ["members", schemeId],
    queryFn: async () =>
      unwrap<{ members: { userId: string; name: string; email: string }[] }>(
        await api.schemes[":schemeId"].members.$get({ param: { schemeId } }),
      ),
    enabled: open,
  });
  const committeeQuery = useQuery({
    queryKey: ["committee", schemeId],
    queryFn: async () =>
      unwrap<{ committee: { userId: string | null; role: string }[] }>(
        await api.schemes[":schemeId"].committee.$get({ param: { schemeId } }),
      ),
    enabled: open,
  });
  const members = membersQuery.data;
  const committee = committeeQuery.data;
  const recipientsError = membersQuery.isError || committeeQuery.isError;

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
      detail: officerRoles.get(m.userId)?.map(roleLabel).join(", ") ?? m.email,
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
          {recipientsError && (
            <div
              role="alert"
              className="space-y-2 rounded-lg border border-caution/25 bg-caution/8 p-3 text-sm"
            >
              <p className="font-medium">Specific recipients couldn't load</p>
              <p className="text-muted-foreground">
                You can still message the committee as a group, or retry the people list.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  void membersQuery.refetch();
                  void committeeQuery.refetch();
                }}
              >
                Try again
              </Button>
            </div>
          )}
          {!recipientsError && (membersQuery.isPending || committeeQuery.isPending) && (
            <p className="text-sm text-muted-foreground" role="status">
              Loading people…
            </p>
          )}
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
