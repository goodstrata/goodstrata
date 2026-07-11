import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Ellipsis, Heart, ImagePlus, MessageSquare, MessagesSquare, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Field } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api, unwrap } from "@/lib/api";
import { useSession } from "@/lib/auth";
import { FormError, fieldError, SubmitButton, useAppForm } from "@/lib/form";
import { formatDate, formatDateTime } from "@/lib/format";
import { useIsCommittee, useIsOwnerView } from "@/lib/roles";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Read models — mirror the API's community read shapes (packages/core community.ts)
// ---------------------------------------------------------------------------

interface PostAuthor {
  userId: string;
  name: string;
  image: string | null;
}
interface PostImageView {
  id: string;
  mime: string;
}
interface PostSummary {
  id: string;
  body: string;
  status: "visible" | "hidden" | "removed";
  visibility: "scheme" | "committee";
  author: PostAuthor;
  images: PostImageView[];
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
  createdAt: string;
}
interface CommentView {
  id: string;
  body: string;
  author: PostAuthor;
  likeCount: number;
  likedByMe: boolean;
  createdAt: string;
}
interface ThreadView extends PostSummary {
  comments: CommentView[];
}
interface FeedPage {
  posts: PostSummary[];
  nextCursor?: string;
}

/**
 * The two channels of the board: the open scheme feed, and the committee's
 * private discussion (visibility "committee" — officer tier only; the server
 * scopes every read and write, this is presentation).
 */
type Channel = "scheme" | "committee";

/** Prefix for invalidations (matches both channels' feeds). */
const FEED_SCOPE = (schemeId: string) => ["community", schemeId] as const;
const FEED_KEY = (schemeId: string, channel: Channel) =>
  [...FEED_SCOPE(schemeId), channel] as const;
const THREAD_KEY = (schemeId: string, postId: string) =>
  ["community-thread", schemeId, postId] as const;

const MAX_IMAGES = 8;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // mirror the API route's per-image cap
const MAX_BODY_CHARS = 5000; // mirror createPostInput / createCommentInput

/** Image types the API accepts (mirrors ALLOWED_IMAGE_TYPES in routes/community.ts). */
const ACCEPTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

/** Initials for an avatar fallback (mirrors routes/__root.tsx:29). */
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

/**
 * Render post/comment text as safe React nodes: plain text (React escapes it,
 * so no raw HTML), line breaks preserved via whitespace-pre-wrap, and bare
 * @mentions given a subtle accent. Never dangerouslySetInnerHTML.
 */
function renderBody(text: string) {
  return text.split(/(@[\p{L}\p{N}._-]+)/gu).map((part, i) =>
    /^@[\p{L}\p{N}._-]+$/u.test(part) ? (
      <span key={`${i}-${part}`} className="font-medium text-primary">
        {part}
      </span>
    ) : (
      <span key={`${i}-plain`}>{part}</span>
    ),
  );
}

const imageSrc = (schemeId: string, imageId: string) =>
  `/api/schemes/${schemeId}/community/images/${imageId}/content`;

/** Show remaining characters only once the writer is close to the limit. */
function charactersLeftHint(value: string): string | undefined {
  const left = MAX_BODY_CHARS - value.length;
  if (left > 500) return undefined;
  return left >= 0
    ? `${left.toLocaleString()} characters left`
    : `${(-left).toLocaleString()} characters over the limit`;
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

export function CommunitySection({ schemeId }: { schemeId: string }) {
  const isCommittee = useIsCommittee(schemeId);
  const [channel, setChannel] = useState<Channel>("scheme");

  // Plain members see the open board only; anyone on the committee (or the
  // manager) also gets the private committee channel. The tabs are
  // presentation — the server hides committee posts from everyone else.
  if (!isCommittee) {
    return (
      <div className="max-w-2xl space-y-6">
        <ChannelFeed schemeId={schemeId} channel="scheme" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <Tabs value={channel} onValueChange={(v) => setChannel(v as Channel)}>
        <TabsList variant="line">
          <TabsTrigger value="scheme">Everyone</TabsTrigger>
          <TabsTrigger value="committee">Committee</TabsTrigger>
        </TabsList>
        <TabsContent value="scheme" className="pt-2">
          <ChannelFeed schemeId={schemeId} channel="scheme" />
        </TabsContent>
        <TabsContent value="committee" className="pt-2">
          <ChannelFeed schemeId={schemeId} channel="committee" />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ChannelFeed({ schemeId, channel }: { schemeId: string; channel: Channel }) {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const currentUserId = session?.user?.id;
  const isCommittee = useIsCommittee(schemeId);
  const isOwnerView = useIsOwnerView(schemeId);

  const feed = useInfiniteQuery({
    queryKey: FEED_KEY(schemeId, channel),
    queryFn: async ({ pageParam }) =>
      unwrap<FeedPage>(
        await api.schemes[":schemeId"].community.posts.$get({
          param: { schemeId },
          query: {
            cursor: pageParam,
            channel: channel === "committee" ? ("committee" as const) : undefined,
          },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor,
  });

  /** Surgically update one post across all loaded feed pages (no refetch). */
  const patchPost = useCallback(
    (postId: string, patch: (post: PostSummary) => PostSummary) => {
      queryClient.setQueryData<InfiniteData<FeedPage>>(FEED_KEY(schemeId, channel), (old) =>
        old
          ? {
              ...old,
              pages: old.pages.map((page) => ({
                ...page,
                posts: page.posts.map((p) => (p.id === postId ? patch(p) : p)),
              })),
            }
          : old,
      );
    },
    [queryClient, schemeId, channel],
  );

  const removePost = useCallback(
    (postId: string) => {
      queryClient.setQueryData<InfiniteData<FeedPage>>(FEED_KEY(schemeId, channel), (old) =>
        old
          ? {
              ...old,
              pages: old.pages.map((page) => ({
                ...page,
                posts: page.posts.filter((p) => p.id !== postId),
              })),
            }
          : old,
      );
    },
    [queryClient, schemeId, channel],
  );

  // A committee viewer's unfiltered feed interleaves committee posts; keep the
  // open board clean so each channel shows only its own conversation.
  const posts = (feed.data?.pages.flatMap((page) => page.posts) ?? []).filter((p) =>
    channel === "scheme" ? p.visibility === "scheme" : true,
  );

  return (
    <div className="space-y-6">
      <PostComposer schemeId={schemeId} channel={channel} isOwnerView={isOwnerView} />

      {feed.isError ? (
        <ErrorState
          message={
            feed.error instanceof Error ? feed.error.message : "Couldn't load the community feed."
          }
          onRetry={() => void feed.refetch()}
        />
      ) : feed.isPending ? (
        <div className="space-y-4">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      ) : posts.length === 0 ? (
        <EmptyState
          icon={MessagesSquare}
          title={
            channel === "committee"
              ? "No committee discussion yet"
              : isOwnerView
                ? "Nothing here yet"
                : "No posts yet"
          }
          description={
            channel === "committee"
              ? "Start the first thread — only the committee and manager will see it."
              : isOwnerView
                ? "Be the first to post — share a notice or a question with your building."
                : "Start the conversation — share the first update with your neighbours."
          }
        />
      ) : (
        <div className="space-y-4">
          {posts.map((post) => (
            <PostCard
              key={post.id}
              schemeId={schemeId}
              post={post}
              currentUserId={currentUserId}
              isModerator={isCommittee}
              patchPost={patchPost}
              removePost={removePost}
            />
          ))}
          {feed.hasNextPage && (
            <div className="flex justify-center pt-1">
              <Button
                variant="outline"
                pending={feed.isFetchingNextPage}
                onClick={() => void feed.fetchNextPage()}
              >
                Load older posts
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------

const composerSchema = z.object({
  body: z
    .string()
    .min(1, "Write something to share.")
    .max(MAX_BODY_CHARS, `Posts can be up to ${MAX_BODY_CHARS.toLocaleString()} characters.`),
});
type ComposerValues = z.infer<typeof composerSchema>;

function PostComposer({
  schemeId,
  channel,
  isOwnerView,
}: {
  schemeId: string;
  channel: Channel;
  isOwnerView: boolean;
}) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [images, setImages] = useState<{ file: File; url: string }[]>([]);
  const formRef = useRef<{ reset: () => void } | null>(null);

  // Track live preview URLs in a ref so unmount cleanup revokes the current set
  // without re-subscribing the effect on every change.
  const urlsRef = useRef<string[]>([]);
  urlsRef.current = images.map((img) => img.url);
  useEffect(() => {
    return () => {
      for (const url of urlsRef.current) URL.revokeObjectURL(url);
    };
  }, []);

  const clearImages = useCallback(() => {
    setImages((prev) => {
      for (const img of prev) URL.revokeObjectURL(img.url);
      return [];
    });
  }, []);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow re-selecting the same file
    if (picked.length === 0) return;

    // Validate up front so a bad file rejects here with a clear reason, not as
    // a whole-post failure at submit time (iPhone HEIC is the common case).
    const usable: File[] = [];
    for (const file of picked) {
      const type = (file.type || "").split(";")[0]!.trim().toLowerCase();
      if (!ACCEPTED_IMAGE_TYPES.has(type)) {
        toast.error(`${file.name} isn't a supported format — use PNG, JPEG, WebP or GIF.`);
      } else if (file.size > MAX_IMAGE_BYTES) {
        toast.error(`${file.name} is too large — photos can be up to 10 MB.`);
      } else {
        usable.push(file);
      }
    }
    if (usable.length === 0) return;

    setImages((prev) => {
      const room = MAX_IMAGES - prev.length;
      if (room <= 0) {
        toast.error(`You can attach up to ${MAX_IMAGES} photos per post.`);
        return prev;
      }
      const added = usable.slice(0, room).map((file) => ({ file, url: URL.createObjectURL(file) }));
      if (usable.length > room) toast.error(`Only the first ${MAX_IMAGES} photos were attached.`);
      return [...prev, ...added];
    });
  };

  const removeImage = (index: number) => {
    setImages((prev) => {
      const target = prev[index];
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((_, i) => i !== index);
    });
  };

  const form = useAppForm<ComposerValues>({
    schema: composerSchema,
    defaultValues: { body: "" },
    onSubmit: async ({ body }) => {
      const payload = new FormData();
      payload.set("body", body);
      // Posting in the committee tab writes to the private channel; the server
      // rejects this for anyone outside the officer tier.
      if (channel === "committee") payload.set("visibility", "committee");
      for (const img of images) payload.append("images", img.file);
      const res = await fetch(`/api/schemes/${schemeId}/community/posts`, {
        method: "POST",
        body: payload,
        credentials: "include",
      });
      await unwrap(res);
      toast.success("Post shared");
      clearImages();
      formRef.current?.reset();
      await queryClient.invalidateQueries({ queryKey: FEED_SCOPE(schemeId) });
    },
  });
  formRef.current = form;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {channel === "committee"
            ? "Committee discussion"
            : isOwnerView
              ? "Post to your building"
              : "Share with your community"}
        </CardTitle>
        <CardDescription>
          {channel === "committee"
            ? "Start a private thread — visible only to committee members and the manager."
            : isOwnerView
              ? "Share a notice, a question, or a photo with the owners and residents in your building."
              : "Post an update, a question, or a photo for owners and residents of this scheme."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <form.Field name="body">
            {(field) => (
              <Field
                label="Post"
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
                    placeholder="Share an update with your neighbours…"
                    rows={3}
                  />
                )}
              </Field>
            )}
          </form.Field>

          {images.length > 0 && (
            <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {images.map((img, i) => (
                <li key={img.url} className="relative">
                  <img
                    src={img.url}
                    alt={`Selected attachment ${i + 1}`}
                    className="aspect-square w-full rounded-md border object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removeImage(i)}
                    aria-label={`Remove attachment ${i + 1}`}
                    className="absolute top-1 right-1 flex size-6 items-center justify-center rounded-full bg-background/90 text-muted-foreground shadow-sm ring-1 ring-border transition-colors after:absolute after:-inset-2.5 hover:text-foreground"
                  >
                    <X aria-hidden="true" className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            className="hidden"
            onChange={onPick}
          />

          <FormError form={form} className="mt-3" />

          <div className="mt-4 flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
              disabled={images.length >= MAX_IMAGES}
            >
              <ImagePlus aria-hidden="true" className="size-4" />
              Add photos
            </Button>
            <SubmitButton form={form}>Post</SubmitButton>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Post card
// ---------------------------------------------------------------------------

function PostCard({
  schemeId,
  post,
  currentUserId,
  isModerator,
  patchPost,
  removePost,
}: {
  schemeId: string;
  post: PostSummary;
  currentUserId: string | undefined;
  /** Committee tier — the same set the server lets moderate the board. */
  isModerator: boolean;
  patchPost: (postId: string, patch: (post: PostSummary) => PostSummary) => void;
  removePost: (postId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const canModerate = currentUserId === post.author.userId || isModerator;

  const likeMutation = useMutation({
    mutationFn: async () =>
      unwrap<{ liked: boolean; likeCount: number }>(
        await api.schemes[":schemeId"].community.posts[":postId"].like.$post({
          param: { schemeId, postId: post.id },
        }),
      ),
    onMutate: () => {
      patchPost(post.id, (p) => ({
        ...p,
        likedByMe: !p.likedByMe,
        likeCount: p.likeCount + (p.likedByMe ? -1 : 1),
      }));
    },
    onSuccess: (res) => {
      patchPost(post.id, (p) => ({ ...p, likedByMe: res.liked, likeCount: res.likeCount }));
    },
    onError: () => {
      // Resync from the server if the optimistic toggle didn't take.
      toast.error("Couldn't update your reaction. Please try again.");
      void queryClient.invalidateQueries({ queryKey: FEED_SCOPE(schemeId) });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () =>
      unwrap<{ postId: string }>(
        await api.schemes[":schemeId"].community.posts[":postId"].$delete({
          param: { schemeId, postId: post.id },
        }),
      ),
    onSuccess: () => {
      toast.success("Post removed");
      removePost(post.id);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't remove the post."),
  });

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <AuthorLine author={post.author} createdAt={post.createdAt} />
          {canModerate && (
            <DeleteMenu
              triggerLabel="Post actions"
              title="Remove this post?"
              description="This removes the post and its comments from the community feed. This can't be undone."
              pending={deleteMutation.isPending}
              onConfirm={() => deleteMutation.mutateAsync().then(() => undefined)}
            />
          )}
        </div>

        {post.body && (
          <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
            {renderBody(post.body)}
          </p>
        )}

        <PostImages schemeId={schemeId} post={post} />
      </div>

      <div className="flex items-center gap-1 border-t px-2 py-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => likeMutation.mutate()}
          aria-pressed={post.likedByMe}
          aria-label={post.likedByMe ? "Unlike post" : "Like post"}
          className={cn(
            "gap-1.5 text-muted-foreground pointer-coarse:-my-1.5 pointer-coarse:min-h-11",
            post.likedByMe && "text-primary",
          )}
        >
          <Heart aria-hidden="true" className={cn("size-4", post.likedByMe && "fill-current")} />
          <span className="font-mono text-xs tabular-nums">{post.likeCount}</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="gap-1.5 text-muted-foreground pointer-coarse:-my-1.5 pointer-coarse:min-h-11"
        >
          <MessageSquare aria-hidden="true" className="size-4" />
          <span className="font-mono text-xs tabular-nums">{post.commentCount}</span>
          <span className="sr-only">comments</span>
        </Button>
      </div>

      {expanded && (
        <CommentThread
          schemeId={schemeId}
          postId={post.id}
          currentUserId={currentUserId}
          isModerator={isModerator}
          onCommentCountChange={(delta) =>
            patchPost(post.id, (p) => ({
              ...p,
              commentCount: Math.max(0, p.commentCount + delta),
            }))
          }
        />
      )}
    </Card>
  );
}

function AuthorLine({ author, createdAt }: { author: PostAuthor; createdAt: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Avatar size="sm">
        {author.image && <AvatarImage src={author.image} alt="" />}
        <AvatarFallback>{initials(author.name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 leading-tight">
        <span className="block truncate text-sm font-medium">{author.name}</span>
        <time
          dateTime={createdAt}
          title={formatDateTime(createdAt)}
          className="block font-mono text-xs text-muted-foreground tabular-nums"
        >
          {relativeTime(createdAt)}
        </time>
      </div>
    </div>
  );
}

function PostImages({ schemeId, post }: { schemeId: string; post: PostSummary }) {
  const imgs = post.images;
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  if (imgs.length === 0) return null;
  const alt = `Photo shared by ${post.author.name}`;
  const openImage = openIndex !== null ? imgs[openIndex] : undefined;

  const lightbox = (
    <Dialog open={openImage !== undefined} onOpenChange={(open) => !open && setOpenIndex(null)}>
      <DialogContent className="p-2 sm:max-w-3xl">
        <DialogHeader className="sr-only">
          <DialogTitle>{alt}</DialogTitle>
          <DialogDescription>Full-size view. Press Escape to close.</DialogDescription>
        </DialogHeader>
        {openImage && (
          <img
            src={imageSrc(schemeId, openImage.id)}
            alt={alt}
            className="max-h-[80vh] w-full rounded-md object-contain"
          />
        )}
      </DialogContent>
    </Dialog>
  );

  if (imgs.length === 1) {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpenIndex(0)}
          aria-label={`View ${alt} full size`}
          className="block w-full cursor-zoom-in rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <img
            src={imageSrc(schemeId, imgs[0]!.id)}
            alt={alt}
            className="max-h-[30rem] w-full rounded-lg border object-cover"
          />
        </button>
        {lightbox}
      </>
    );
  }

  return (
    <>
      <div className={cn("grid gap-1.5", imgs.length >= 5 ? "grid-cols-3" : "grid-cols-2")}>
        {imgs.map((img, i) => (
          <button
            key={img.id}
            type="button"
            onClick={() => setOpenIndex(i)}
            aria-label={`View photo ${i + 1} of ${imgs.length} full size`}
            className={cn(
              "cursor-zoom-in rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              imgs.length === 3 && i === 0 && "col-span-2",
            )}
          >
            <img
              src={imageSrc(schemeId, img.id)}
              alt={alt}
              className={cn(
                "aspect-square w-full rounded-md border object-cover",
                imgs.length === 3 && i === 0 && "aspect-[2/1]",
              )}
            />
          </button>
        ))}
      </div>
      {lightbox}
    </>
  );
}

// ---------------------------------------------------------------------------
// Comment thread
// ---------------------------------------------------------------------------

function CommentThread({
  schemeId,
  postId,
  currentUserId,
  isModerator,
  onCommentCountChange,
}: {
  schemeId: string;
  postId: string;
  currentUserId: string | undefined;
  isModerator: boolean;
  onCommentCountChange: (delta: number) => void;
}) {
  const thread = useQuery({
    queryKey: THREAD_KEY(schemeId, postId),
    queryFn: async () =>
      unwrap<{ post: ThreadView }>(
        await api.schemes[":schemeId"].community.posts[":postId"].$get({
          param: { schemeId, postId },
        }),
      ),
  });

  return (
    <div className="space-y-4 border-t bg-muted/20 px-4 py-4">
      {thread.isError ? (
        <ErrorState
          message={
            thread.error instanceof Error ? thread.error.message : "Couldn't load the comments."
          }
          onRetry={() => void thread.refetch()}
        />
      ) : thread.isPending ? (
        <Skeleton className="h-16" />
      ) : (
        <>
          {thread.data.post.comments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No comments yet — be the first to reply.
            </p>
          ) : (
            <ol className="space-y-4">
              {thread.data.post.comments.map((comment) => (
                <CommentItem
                  key={comment.id}
                  schemeId={schemeId}
                  postId={postId}
                  comment={comment}
                  currentUserId={currentUserId}
                  isModerator={isModerator}
                  onDeleted={() => onCommentCountChange(-1)}
                />
              ))}
            </ol>
          )}
          <CommentComposer
            schemeId={schemeId}
            postId={postId}
            onAdded={() => onCommentCountChange(1)}
          />
        </>
      )}
    </div>
  );
}

function CommentItem({
  schemeId,
  postId,
  comment,
  currentUserId,
  isModerator,
  onDeleted,
}: {
  schemeId: string;
  postId: string;
  comment: CommentView;
  currentUserId: string | undefined;
  isModerator: boolean;
  onDeleted: () => void;
}) {
  const queryClient = useQueryClient();
  const canModerate = currentUserId === comment.author.userId || isModerator;

  const patchComment = useCallback(
    (patch: (c: CommentView) => CommentView) => {
      queryClient.setQueryData<{ post: ThreadView }>(THREAD_KEY(schemeId, postId), (old) =>
        old
          ? {
              post: {
                ...old.post,
                comments: old.post.comments.map((c) => (c.id === comment.id ? patch(c) : c)),
              },
            }
          : old,
      );
    },
    [queryClient, schemeId, postId, comment.id],
  );

  const likeMutation = useMutation({
    mutationFn: async () =>
      unwrap<{ liked: boolean; likeCount: number }>(
        await api.schemes[":schemeId"].community.comments[":commentId"].like.$post({
          param: { schemeId, commentId: comment.id },
        }),
      ),
    onMutate: () => {
      patchComment((c) => ({
        ...c,
        likedByMe: !c.likedByMe,
        likeCount: c.likeCount + (c.likedByMe ? -1 : 1),
      }));
    },
    onSuccess: (res) => {
      patchComment((c) => ({ ...c, likedByMe: res.liked, likeCount: res.likeCount }));
    },
    onError: () => {
      toast.error("Couldn't update your reaction. Please try again.");
      void queryClient.invalidateQueries({ queryKey: THREAD_KEY(schemeId, postId) });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () =>
      unwrap<{ commentId: string }>(
        await api.schemes[":schemeId"].community.comments[":commentId"].$delete({
          param: { schemeId, commentId: comment.id },
        }),
      ),
    onSuccess: () => {
      toast.success("Comment removed");
      onDeleted();
      void queryClient.invalidateQueries({ queryKey: THREAD_KEY(schemeId, postId) });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't remove the comment."),
  });

  return (
    <li className="flex gap-2.5">
      <Avatar size="sm">
        {comment.author.image && <AvatarImage src={comment.author.image} alt="" />}
        <AvatarFallback>{initials(comment.author.name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="rounded-lg border bg-card px-3 py-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
              <span className="truncate text-sm font-medium">{comment.author.name}</span>
              <time
                dateTime={comment.createdAt}
                title={formatDateTime(comment.createdAt)}
                className="font-mono text-xs text-muted-foreground tabular-nums"
              >
                {relativeTime(comment.createdAt)}
              </time>
            </div>
            {canModerate && (
              <DeleteMenu
                triggerLabel="Comment actions"
                title="Remove this comment?"
                description="This removes your comment from the thread. This can't be undone."
                pending={deleteMutation.isPending}
                onConfirm={() => deleteMutation.mutateAsync().then(() => undefined)}
              />
            )}
          </div>
          <p className="mt-0.5 text-sm leading-relaxed whitespace-pre-wrap break-words">
            {renderBody(comment.body)}
          </p>
        </div>
        <div className="mt-1 pl-1">
          <Button
            variant="ghost"
            size="xs"
            onClick={() => likeMutation.mutate()}
            aria-pressed={comment.likedByMe}
            aria-label={comment.likedByMe ? "Unlike comment" : "Like comment"}
            className={cn(
              "gap-1.5 text-muted-foreground pointer-coarse:-my-2.5 pointer-coarse:min-h-11",
              comment.likedByMe && "text-primary",
            )}
          >
            <Heart
              aria-hidden="true"
              className={cn("size-3.5", comment.likedByMe && "fill-current")}
            />
            <span className="font-mono text-xs tabular-nums">{comment.likeCount}</span>
          </Button>
        </div>
      </div>
    </li>
  );
}

const commentSchema = z.object({
  body: z
    .string()
    .min(1, "Write a comment to reply.")
    .max(MAX_BODY_CHARS, `Comments can be up to ${MAX_BODY_CHARS.toLocaleString()} characters.`),
});
type CommentValues = z.infer<typeof commentSchema>;

function CommentComposer({
  schemeId,
  postId,
  onAdded,
}: {
  schemeId: string;
  postId: string;
  onAdded: () => void;
}) {
  const queryClient = useQueryClient();
  const formRef = useRef<{ reset: () => void } | null>(null);

  const form = useAppForm<CommentValues>({
    schema: commentSchema,
    defaultValues: { body: "" },
    onSubmit: async ({ body }) => {
      await unwrap(
        await api.schemes[":schemeId"].community.posts[":postId"].comments.$post({
          param: { schemeId, postId },
          json: { body },
        }),
      );
      onAdded();
      formRef.current?.reset();
      await queryClient.invalidateQueries({ queryKey: THREAD_KEY(schemeId, postId) });
    },
  });
  formRef.current = form;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <form.Field name="body">
        {(field) => (
          <Field
            label="Add a comment"
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
                placeholder="Write a comment…"
                rows={2}
              />
            )}
          </Field>
        )}
      </form.Field>
      <FormError form={form} className="mt-2" />
      <div className="mt-2 flex justify-end">
        <SubmitButton form={form} size="sm">
          Add comment
        </SubmitButton>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Delete menu (dropdown + destructive confirmation)
// ---------------------------------------------------------------------------

function DeleteMenu({
  triggerLabel,
  title,
  description,
  pending,
  onConfirm,
}: {
  triggerLabel: string;
  title: string;
  description: string;
  pending: boolean;
  onConfirm: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-muted-foreground"
            aria-label={triggerLabel}
          >
            <Ellipsis aria-hidden="true" className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            variant="destructive"
            onSelect={(e) => {
              e.preventDefault();
              setOpen(true);
            }}
          >
            <Trash2 aria-hidden="true" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              variant="destructive"
              pending={pending}
              onClick={() => {
                // Close only on success; a failed delete keeps the dialog open
                // (the .catch prevents an unhandled rejection).
                onConfirm().then(
                  () => setOpen(false),
                  () => undefined,
                );
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
