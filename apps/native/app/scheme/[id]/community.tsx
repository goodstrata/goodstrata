import { Ionicons } from "@expo/vector-icons";
import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Image, Modal, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  FormField,
  formatRelativeTime,
  ListRow,
  PressableScale,
  plate,
  radius,
  Screen,
  SectionHeader,
  Skeleton,
  StatusPill,
  space,
  type as t,
  useTheme,
} from "../../../src/components";
import { api, apiDelete, apiPost } from "../../../src/lib/api";
import { authClient } from "../../../src/lib/auth";
import { API_ORIGIN } from "../../../src/lib/config";
import { conversationRecipientFor } from "../../../src/lib/conversationRecipient";
import { schemeQueryOptions } from "../../../src/lib/roles";

type CommunityVisibility = "scheme" | "committee";

interface PostAuthor {
  userId: string;
  name: string;
  image: string | null;
}

interface PostImage {
  id: string;
  mime: string;
}

interface PostSummary {
  id: string;
  body: string;
  status: "visible" | "hidden" | "removed";
  visibility: CommunityVisibility;
  author: PostAuthor;
  images: PostImage[];
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

interface AnnouncementView {
  id: string;
  title: string;
  body: string;
  audience: "all" | "owners" | "committee";
  publishedAt: string | null;
  createdAt: string;
}

interface ConversationSummary {
  id: string;
  subject: string | null;
  otherParticipants: { userId: string; name: string; image: string | null }[];
  lastMessage: { body: string; senderUserId: string | null; createdAt: string } | null;
  unreadCount: number;
  createdAt: string;
  lastMessageAt: string;
}

interface ConversationMessage {
  id: string;
  conversationId: string;
  body: string;
  sender: { userId: string; name: string; image: string | null } | null;
  createdAt: string;
}

interface MemberSummary {
  userId: string;
  name: string;
  email: string;
}

const MAX_BODY_CHARS = 5000;
const MAX_IMAGES = 8;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const COMMUNITY_OFFICER_ROLES = new Set([
  "chair",
  "secretary",
  "treasurer",
  "committee_member",
  "manager_admin",
]);
const feedKey = (schemeId: string) => ["scheme", schemeId, "community"] as const;
const threadKey = (schemeId: string, postId: string) =>
  ["scheme", schemeId, "community", postId] as const;

function cookieHeaders(): Record<string, string> {
  try {
    const cookie = authClient.getCookie();
    return cookie ? { Cookie: cookie } : {};
  } catch {
    return {};
  }
}

function imageMime(asset: ImagePicker.ImagePickerAsset): string {
  const declared = asset.mimeType?.split(";")[0]?.trim().toLowerCase();
  if (declared === "image/jpg") return "image/jpeg";
  if (declared) return declared;
  const filename = (asset.fileName ?? asset.uri).toLowerCase();
  if (/\.png(?:$|\?)/.test(filename)) return "image/png";
  if (/\.jpe?g(?:$|\?)/.test(filename)) return "image/jpeg";
  if (/\.webp(?:$|\?)/.test(filename)) return "image/webp";
  if (/\.gif(?:$|\?)/.test(filename)) return "image/gif";
  return "";
}

function imageFilename(asset: ImagePicker.ImagePickerAsset, index: number): string {
  if (asset.fileName) return asset.fileName;
  const extension: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
  };
  return `community-photo-${index + 1}.${extension[imageMime(asset)] ?? "jpg"}`;
}

async function postWithImages(
  schemeId: string,
  body: string,
  visibility: CommunityVisibility,
  images: ImagePicker.ImagePickerAsset[],
): Promise<{ post: PostSummary }> {
  const form = new FormData();
  form.append("body", body);
  form.append("visibility", visibility);
  images.forEach((asset, index) => {
    form.append("images", {
      uri: asset.uri,
      name: imageFilename(asset, index),
      type: imageMime(asset),
    } as unknown as Blob);
  });

  const path = `/api/schemes/${schemeId}/community/posts`;
  const response = await fetch(`${API_ORIGIN}${path}`, {
    method: "POST",
    headers: { ...cookieHeaders(), Accept: "application/json" },
    body: form,
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(payload?.error?.message ?? `Couldn't share that post (${response.status}).`);
  }
  return response.json() as Promise<{ post: PostSummary }>;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (
    parts
      .slice(0, 2)
      .map((part) => part[0])
      .join("") || "?"
  ).toUpperCase();
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function Avatar({ name }: { name: string }) {
  const theme = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: 36,
        height: 36,
        borderRadius: radius.pill,
        backgroundColor: theme.accentSoft,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ ...t.label, color: theme.accent }}>{initials(name)}</Text>
    </View>
  );
}

function CountAction({
  icon,
  active,
  count,
  label,
  onPress,
  disabled,
}: {
  icon: "heart" | "heart-outline" | "chatbubble-outline";
  active?: boolean;
  count: number;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const colour = active ? theme.accent : theme.muted;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${count}`}
      accessibilityState={{ disabled: !!disabled, selected: !!active }}
      onPress={onPress}
      disabled={disabled}
      style={{
        minWidth: 52,
        minHeight: 44,
        paddingHorizontal: space(2),
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: space(1),
      }}
    >
      <Ionicons name={icon} size={18} color={colour} />
      <Text
        style={{
          fontFamily: t.figureSmall.fontFamily,
          fontSize: 13,
          lineHeight: 18,
          color: colour,
          fontVariant: ["tabular-nums"],
        }}
      >
        {count}
      </Text>
    </PressableScale>
  );
}

function AudienceChoice({
  label,
  icon,
  selected,
  onPress,
}: {
  label: string;
  icon: "people-outline" | "lock-closed-outline";
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <PressableScale
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={{
        flex: 1,
        minHeight: 44,
        borderRadius: radius.control,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: selected ? theme.accent : theme.line,
        backgroundColor: selected ? theme.accentSoft : theme.surface,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: space(2),
      }}
    >
      <Ionicons name={icon} size={17} color={selected ? theme.accent : theme.muted} />
      <Text style={{ ...t.label, color: selected ? theme.accent : theme.muted }}>{label}</Text>
    </PressableScale>
  );
}

export default function CommunityScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ id: string; focus?: string; focusType?: string }>();
  const schemeId = typeof params.id === "string" ? params.id : "";
  const focus = typeof params.focus === "string" ? params.focus : "";
  const focusType = typeof params.focusType === "string" ? params.focusType : "";
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();
  const currentUserId = session?.user?.id;
  const schemeQuery = useQuery({
    ...schemeQueryOptions(schemeId),
    enabled: !!schemeId,
  });
  const isCommunityOfficer = (schemeQuery.data?.roles ?? []).some((role) =>
    COMMUNITY_OFFICER_ROLES.has(role),
  );

  const feed = useInfiniteQuery({
    queryKey: feedKey(schemeId),
    queryFn: ({ pageParam }) =>
      api<FeedPage>(
        `/api/schemes/${schemeId}/community/posts${
          pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ""
        }`,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: !!schemeId,
  });

  const focusedPost = useQuery({
    queryKey: threadKey(schemeId, focus),
    queryFn: () => api<{ post: ThreadView }>(`/api/schemes/${schemeId}/community/posts/${focus}`),
    enabled: !!schemeId && !!focus && focusType === "community_post",
    retry: false,
  });
  const announcements = useQuery({
    queryKey: ["scheme", schemeId, "announcements"],
    queryFn: () =>
      api<{ announcements: AnnouncementView[]; nextCursor?: string }>(
        `/api/schemes/${schemeId}/announcements`,
      ),
    enabled: !!schemeId,
  });
  const focusedAnnouncement = useQuery({
    queryKey: ["scheme", schemeId, "announcement", focus],
    queryFn: () =>
      api<{ announcement: AnnouncementView }>(`/api/schemes/${schemeId}/announcements/${focus}`),
    enabled: !!schemeId && !!focus && focusType === "announcement",
    retry: false,
  });
  const conversations = useQuery({
    queryKey: ["scheme", schemeId, "conversations"],
    queryFn: () =>
      api<{ conversations: ConversationSummary[]; nextCursor?: string }>(
        `/api/schemes/${schemeId}/messages/conversations`,
      ),
    enabled: !!schemeId,
    refetchInterval: 10_000,
  });

  const [postBody, setPostBody] = useState("");
  const [visibility, setVisibility] = useState<CommunityVisibility>("scheme");
  const [selectedImages, setSelectedImages] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [expandedPostId, setExpandedPostId] = useState<string | null>(null);
  const [expandedConversationId, setExpandedConversationId] = useState<string | null>(null);

  useEffect(() => {
    if (focusType === "community_post" && focus) setExpandedPostId(focus);
    if (focusType === "conversation" && focus) setExpandedConversationId(focus);
  }, [focus, focusType]);

  const pickImages = async () => {
    const room = MAX_IMAGES - selectedImages.length;
    if (room <= 0) return;
    setPhotoError(null);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: true,
        orderedSelection: true,
        selectionLimit: room,
        quality: 0.9,
      });
      if (result.canceled) return;

      const accepted: ImagePicker.ImagePickerAsset[] = [];
      const problems: string[] = [];
      for (const asset of result.assets.slice(0, room)) {
        const mime = imageMime(asset);
        const name = asset.fileName ?? "That photo";
        if (!ACCEPTED_IMAGE_TYPES.has(mime)) {
          problems.push(`${name} isn't PNG, JPEG, WebP or GIF.`);
        } else if (asset.fileSize && asset.fileSize > MAX_IMAGE_BYTES) {
          problems.push(`${name} is larger than 10 MB.`);
        } else {
          accepted.push(asset);
        }
      }
      if (accepted.length > 0) {
        setSelectedImages((current) => {
          const next = [...current];
          const seen = new Set(current.map((asset) => asset.assetId ?? asset.uri));
          for (const asset of accepted) {
            const key = asset.assetId ?? asset.uri;
            if (!seen.has(key)) {
              seen.add(key);
              next.push(asset);
            }
          }
          return next.slice(0, MAX_IMAGES);
        });
      }
      if (problems.length > 0) setPhotoError(problems.join(" "));
    } catch (error) {
      setPhotoError(errorMessage(error, "Couldn't open your photo library."));
    }
  };

  const patchPost = useCallback(
    (postId: string, patch: (post: PostSummary) => PostSummary) => {
      queryClient.setQueryData<InfiniteData<FeedPage>>(feedKey(schemeId), (old) =>
        old
          ? {
              ...old,
              pages: old.pages.map((page) => ({
                ...page,
                posts: page.posts.map((post) => (post.id === postId ? patch(post) : post)),
              })),
            }
          : old,
      );
    },
    [queryClient, schemeId],
  );

  const removePost = useCallback(
    (postId: string) => {
      queryClient.setQueryData<InfiniteData<FeedPage>>(feedKey(schemeId), (old) =>
        old
          ? {
              ...old,
              pages: old.pages.map((page) => ({
                ...page,
                posts: page.posts.filter((post) => post.id !== postId),
              })),
            }
          : old,
      );
      setExpandedPostId((current) => (current === postId ? null : current));
    },
    [queryClient, schemeId],
  );

  const createPost = useMutation({
    mutationFn: () => {
      const audience = isCommunityOfficer ? visibility : "scheme";
      return selectedImages.length > 0
        ? postWithImages(schemeId, postBody.trim(), audience, selectedImages)
        : apiPost<{ post: PostSummary }>(`/api/schemes/${schemeId}/community/posts`, {
            body: postBody.trim(),
            visibility: audience,
          });
    },
    onSuccess: () => {
      setPostBody("");
      setSelectedImages([]);
      setPhotoError(null);
      void queryClient.invalidateQueries({ queryKey: feedKey(schemeId) });
    },
  });

  const feedPosts = feed.data?.pages.flatMap((page) => page.posts) ?? [];
  const focusedPostView = focusedPost.data?.post;
  const posts = focusedPostView
    ? [focusedPostView, ...feedPosts.filter((post) => post.id !== focusedPostView.id)]
    : feedPosts;
  const announcementRows = announcements.data?.announcements ?? [];
  const focusedAnnouncementView = focusedAnnouncement.data?.announcement;
  const noticeboard = focusedAnnouncementView
    ? [
        focusedAnnouncementView,
        ...announcementRows.filter((notice) => notice.id !== focusedAnnouncementView.id),
      ]
    : announcementRows;
  const canPost = postBody.trim().length > 0 && !createPost.isPending;

  return (
    <Screen
      title="Community"
      topInset={false}
      eyebrow={plate(schemeQuery.data?.scheme)}
      reserveEyebrow
      onRefresh={() =>
        Promise.all([
          feed.refetch(),
          schemeQuery.refetch(),
          announcements.refetch(),
          conversations.refetch(),
          ...(focusType === "community_post" && focus ? [focusedPost.refetch()] : []),
          ...(focusType === "announcement" && focus ? [focusedAnnouncement.refetch()] : []),
        ])
      }
    >
      <AnnouncementSection
        announcements={noticeboard}
        focus={focusType === "announcement" ? focus : ""}
        loading={announcements.isPending || focusedAnnouncement.isFetching}
        error={announcements.error ?? focusedAnnouncement.error}
        onRetry={() =>
          void Promise.all([
            announcements.refetch(),
            ...(focusType === "announcement" && focus ? [focusedAnnouncement.refetch()] : []),
          ])
        }
      />

      <PrivateMessagesSection
        schemeId={schemeId}
        currentUserId={currentUserId}
        isOfficer={isCommunityOfficer}
        conversations={conversations.data?.conversations ?? []}
        loading={conversations.isPending}
        error={conversations.error}
        focus={focusType === "conversation" ? focus : ""}
        expandedId={expandedConversationId}
        onExpand={(conversationId) =>
          setExpandedConversationId((current) =>
            current === conversationId ? null : conversationId,
          )
        }
        onRetry={() => void conversations.refetch()}
      />

      <Card>
        <Text style={[t.title, { color: theme.text }]}>Share with your building</Text>
        <Text style={[t.bodySmall, { color: theme.muted, marginTop: space(1) }]}>
          {"Post an update or question for owners and residents."}
        </Text>
        <View style={{ marginTop: space(4), gap: space(3) }}>
          <FormField
            label="Post"
            value={postBody}
            onChangeText={setPostBody}
            placeholder="Share an update with your neighbours…"
            multiline
            maxLength={MAX_BODY_CHARS}
          />
          {selectedImages.length > 0 ? (
            <SelectedImages
              images={selectedImages}
              onRemove={(index) =>
                setSelectedImages((current) =>
                  current.filter((_, itemIndex) => itemIndex !== index),
                )
              }
            />
          ) : null}
          <View style={{ alignItems: "flex-start", gap: space(2) }}>
            <Button
              variant="secondary"
              label={selectedImages.length > 0 ? "Add more photos" : "Add photos"}
              icon={<Ionicons name="images-outline" size={18} color={theme.accent} />}
              onPress={() => void pickImages()}
              disabled={selectedImages.length >= MAX_IMAGES || createPost.isPending}
            />
            {selectedImages.length > 0 ? (
              <Text style={[t.caption, { color: theme.muted }]}>
                {selectedImages.length} of {MAX_IMAGES} photos attached
              </Text>
            ) : null}
          </View>
          {isCommunityOfficer ? (
            <View style={{ gap: space(2) }} accessibilityRole="radiogroup">
              <Text style={[t.label, { color: theme.muted }]}>Audience</Text>
              <View style={{ flexDirection: "row", gap: space(2) }}>
                <AudienceChoice
                  label="Everyone"
                  icon="people-outline"
                  selected={visibility === "scheme"}
                  onPress={() => setVisibility("scheme")}
                />
                <AudienceChoice
                  label="Committee"
                  icon="lock-closed-outline"
                  selected={visibility === "committee"}
                  onPress={() => setVisibility("committee")}
                />
              </View>
            </View>
          ) : null}
          {postBody.length >= MAX_BODY_CHARS - 500 ? (
            <Text style={[t.caption, { color: theme.muted, textAlign: "right" }]}>
              {MAX_BODY_CHARS - postBody.length} characters left
            </Text>
          ) : null}
          {createPost.isError ? (
            <Text style={[t.bodySmall, { color: theme.crit }]}>
              {errorMessage(createPost.error, "Couldn't share that post. Try again.")}
            </Text>
          ) : null}
          {photoError ? (
            <Text style={[t.bodySmall, { color: theme.crit }]}>{photoError}</Text>
          ) : null}
          <View style={{ alignItems: "flex-end" }}>
            <Button
              label="Post"
              onPress={() => createPost.mutate()}
              disabled={!canPost}
              pending={createPost.isPending}
            />
          </View>
        </View>
      </Card>

      <SectionHeader label={isCommunityOfficer ? "Scheme and committee feed" : "Your building"} />
      {feed.isPending ? (
        <View style={{ gap: space(3) }}>
          <PostSkeleton />
          <PostSkeleton />
        </View>
      ) : feed.isError && !feed.data ? (
        <ErrorState
          title="Couldn't load the community feed"
          detail={errorMessage(feed.error, "Check your connection and try again.")}
          onRetry={() => void feed.refetch()}
        />
      ) : posts.length === 0 ? (
        <EmptyState
          icon="chatbubbles-outline"
          title="Nothing here yet"
          body="Be the first to share an update or question with your building."
        />
      ) : (
        <View style={{ gap: space(3) }}>
          {posts.map((post) => (
            <PostCard
              key={post.id}
              schemeId={schemeId}
              post={post}
              highlighted={focusType === "community_post" && focus === post.id}
              currentUserId={currentUserId}
              isCommunityOfficer={isCommunityOfficer}
              expanded={expandedPostId === post.id}
              onToggleThread={() =>
                setExpandedPostId((current) => (current === post.id ? null : post.id))
              }
              patchPost={patchPost}
              removePost={removePost}
            />
          ))}
          {feed.hasNextPage ? (
            <View style={{ alignItems: "center", marginTop: space(1) }}>
              <Button
                variant="secondary"
                label="Load older posts"
                onPress={() => void feed.fetchNextPage()}
                pending={feed.isFetchingNextPage}
              />
            </View>
          ) : null}
          {feed.isFetchNextPageError ? (
            <View style={{ alignItems: "center", gap: space(2) }}>
              <Text style={[t.bodySmall, { color: theme.crit }]}>
                {"Couldn't load older posts."}
              </Text>
              <Button
                variant="secondary"
                label="Try again"
                onPress={() => void feed.fetchNextPage()}
              />
            </View>
          ) : null}
        </View>
      )}
    </Screen>
  );
}

function AnnouncementSection({
  announcements,
  focus,
  loading,
  error,
  onRetry,
}: {
  announcements: AnnouncementView[];
  focus: string;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const theme = useTheme();
  if (!loading && !error && announcements.length === 0) return null;
  return (
    <>
      <SectionHeader label="Building notices" />
      {loading && announcements.length === 0 ? (
        <Card>
          <Skeleton width="68%" height={18} />
          <View style={{ marginTop: space(2) }}>
            <Skeleton width="92%" height={14} />
          </View>
        </Card>
      ) : error && announcements.length === 0 ? (
        <ErrorState title="Couldn't load building notices" onRetry={onRetry} />
      ) : (
        <View style={{ gap: space(3) }}>
          {announcements.map((announcement) => {
            const highlighted = announcement.id === focus;
            return (
              <Card
                key={announcement.id}
                style={{ backgroundColor: highlighted ? theme.accentSoft : theme.surface }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: space(2),
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[t.title, { color: theme.text }]}>{announcement.title}</Text>
                    <Text style={[t.caption, { color: theme.muted, marginTop: space(1) }]}>
                      {formatRelativeTime(announcement.publishedAt ?? announcement.createdAt)}
                    </Text>
                  </View>
                  <StatusPill
                    tone={announcement.publishedAt ? "info" : "neutral"}
                    label={announcement.publishedAt ? "Notice" : "Draft"}
                  />
                </View>
                <Text selectable style={[t.body, { color: theme.text, marginTop: space(3) }]}>
                  {announcement.body}
                </Text>
                {announcement.audience !== "all" ? (
                  <View style={{ alignItems: "flex-start", marginTop: space(3) }}>
                    <StatusPill
                      tone={announcement.audience === "committee" ? "agent" : "neutral"}
                      label={announcement.audience === "committee" ? "Committee" : "Owners"}
                    />
                  </View>
                ) : null}
              </Card>
            );
          })}
        </View>
      )}
    </>
  );
}

function conversationTitle(conversation: ConversationSummary): string {
  if (conversation.subject?.trim()) return conversation.subject;
  const names = conversation.otherParticipants
    .map((participant) => participant.name)
    .filter(Boolean);
  return names.length > 0 ? names.join(", ") : "Committee conversation";
}

function RecipientModeChoice({
  label,
  icon,
  selected,
  onPress,
}: {
  label: string;
  icon: "people-outline" | "person-outline";
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <PressableScale
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={{
        flex: 1,
        minHeight: 44,
        borderRadius: radius.control,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: selected ? theme.accent : theme.line,
        backgroundColor: selected ? theme.accentSoft : theme.surface,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: space(2),
        paddingHorizontal: space(2),
      }}
    >
      <Ionicons name={icon} size={17} color={selected ? theme.accent : theme.muted} />
      <Text style={[t.label, { color: selected ? theme.accent : theme.muted }]}>{label}</Text>
    </PressableScale>
  );
}

function RecipientMemberRow({
  member,
  selected,
  divider,
  onPress,
}: {
  member: MemberSummary;
  selected: boolean;
  divider: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <PressableScale
      accessibilityRole="radio"
      accessibilityLabel={`${member.name}, ${member.email}`}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={{
        minHeight: 54,
        flexDirection: "row",
        alignItems: "center",
        gap: space(3),
        paddingHorizontal: space(3),
        paddingVertical: space(2),
        backgroundColor: selected ? theme.accentSoft : theme.surface,
        borderBottomWidth: divider ? StyleSheet.hairlineWidth : 0,
        borderBottomColor: theme.line,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={[t.label, { color: theme.text }]} numberOfLines={1}>
          {member.name}
        </Text>
        <Text style={[t.caption, { color: theme.muted }]} numberOfLines={1}>
          {member.email}
        </Text>
      </View>
      {selected ? <Ionicons name="checkmark-circle" size={20} color={theme.accent} /> : null}
    </PressableScale>
  );
}

function PrivateMessagesSection({
  schemeId,
  currentUserId,
  isOfficer,
  conversations,
  loading,
  error,
  focus,
  expandedId,
  onExpand,
  onRetry,
}: {
  schemeId: string;
  currentUserId: string | undefined;
  isOfficer: boolean;
  conversations: ConversationSummary[];
  loading: boolean;
  error: unknown;
  focus: string;
  expandedId: string | null;
  onExpand: (conversationId: string) => void;
  onRetry: () => void;
}) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [recipientMode, setRecipientMode] = useState<"committee" | "user">("committee");
  const [recipientUserId, setRecipientUserId] = useState("");
  const [recipientSearch, setRecipientSearch] = useState("");
  const members = useQuery({
    queryKey: ["scheme", schemeId, "members"],
    queryFn: () => api<{ members: MemberSummary[] }>(`/api/schemes/${schemeId}/members`),
    enabled: !!schemeId && isOfficer,
  });
  const recipient = conversationRecipientFor({
    isOfficer,
    mode: recipientMode,
    userId: recipientUserId,
  });
  const memberOptions = (members.data?.members ?? [])
    .filter((member) => member.userId !== currentUserId)
    .filter((member) => {
      const needle = recipientSearch.trim().toLowerCase();
      return (
        !needle ||
        member.name.toLowerCase().includes(needle) ||
        member.email.toLowerCase().includes(needle)
      );
    });
  const selectedMember = members.data?.members.find((member) => member.userId === recipientUserId);
  const startConversation = useMutation({
    mutationFn: () => {
      if (!recipient) throw new Error("Choose a recipient before sending.");
      return apiPost<{
        conversation: ConversationSummary;
        message: ConversationMessage;
      }>(`/api/schemes/${schemeId}/messages/conversations`, {
        ...(subject.trim() ? { subject: subject.trim() } : {}),
        body: message.trim(),
        to: recipient,
      });
    },
    onSuccess: async ({ conversation }) => {
      setSubject("");
      setMessage("");
      setRecipientMode("committee");
      setRecipientUserId("");
      setRecipientSearch("");
      await queryClient.invalidateQueries({
        queryKey: ["scheme", schemeId, "conversations"],
      });
      onExpand(conversation.id);
    },
  });
  const focusIsOutsidePage =
    !!focus && !conversations.some((conversation) => conversation.id === focus);
  return (
    <>
      <SectionHeader label="Private messages" />
      <Card>
        <Text style={[t.title, { color: theme.text }]}>
          {isOfficer ? "Start a private conversation" : "Message the committee"}
        </Text>
        <Text style={[t.bodySmall, { color: theme.muted, marginTop: space(1) }]}>
          {isOfficer
            ? "Write to the committee group or choose one active scheme member."
            : "This starts a private thread with the current office holders."}
        </Text>
        <View style={{ gap: space(3), marginTop: space(3) }}>
          {isOfficer ? (
            <View style={{ gap: space(2) }}>
              <Text style={[t.label, { color: theme.muted }]}>Recipient</Text>
              <View style={{ flexDirection: "row", gap: space(2) }}>
                <RecipientModeChoice
                  label="Committee"
                  icon="people-outline"
                  selected={recipientMode === "committee"}
                  onPress={() => {
                    setRecipientMode("committee");
                    setRecipientUserId("");
                  }}
                />
                <RecipientModeChoice
                  label="One member"
                  icon="person-outline"
                  selected={recipientMode === "user"}
                  onPress={() => setRecipientMode("user")}
                />
              </View>
              {recipientMode === "user" ? (
                <View style={{ gap: space(2), marginTop: space(1) }}>
                  <FormField
                    label="Find a member"
                    value={recipientSearch}
                    onChangeText={setRecipientSearch}
                    placeholder="Name or email"
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!startConversation.isPending}
                  />
                  {members.isPending ? (
                    <Skeleton width="70%" height={44} />
                  ) : members.isError ? (
                    <View style={{ alignItems: "flex-start", gap: space(2) }}>
                      <Text style={[t.caption, { color: theme.crit }]}>
                        {errorMessage(members.error, "Couldn't load scheme members.")}
                      </Text>
                      <Button
                        variant="secondary"
                        label="Try again"
                        onPress={() => void members.refetch()}
                      />
                    </View>
                  ) : memberOptions.length === 0 ? (
                    <Text style={[t.bodySmall, { color: theme.muted }]}>No members found.</Text>
                  ) : (
                    <View
                      style={{
                        borderWidth: StyleSheet.hairlineWidth,
                        borderColor: theme.line,
                        borderRadius: radius.control,
                        overflow: "hidden",
                      }}
                    >
                      {memberOptions.slice(0, 20).map((member, index, rows) => (
                        <RecipientMemberRow
                          key={member.userId}
                          member={member}
                          selected={member.userId === recipientUserId}
                          divider={index < rows.length - 1}
                          onPress={() => setRecipientUserId(member.userId)}
                        />
                      ))}
                    </View>
                  )}
                  {memberOptions.length > 20 ? (
                    <Text style={[t.caption, { color: theme.muted }]}>
                      Refine the search to see the remaining members.
                    </Text>
                  ) : null}
                  {selectedMember ? (
                    <Text style={[t.caption, { color: theme.accent }]}>
                      To {selectedMember.name} · {selectedMember.email}
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </View>
          ) : null}
          <FormField
            label="Subject (optional)"
            value={subject}
            onChangeText={setSubject}
            maxLength={200}
            editable={!startConversation.isPending}
          />
          <FormField
            label="Message"
            value={message}
            onChangeText={setMessage}
            placeholder="How can the committee help?"
            multiline
            maxLength={5000}
            editable={!startConversation.isPending}
          />
          {startConversation.isError ? (
            <Text style={[t.caption, { color: theme.crit }]}>
              {errorMessage(startConversation.error, "Couldn't start that conversation.")}
            </Text>
          ) : null}
          <View style={{ alignItems: "flex-end" }}>
            <Button
              variant="secondary"
              label="Send privately"
              onPress={() => startConversation.mutate()}
              pending={startConversation.isPending}
              disabled={!message.trim() || !recipient}
            />
          </View>
        </View>
      </Card>
      {loading ? (
        <Card>
          <Skeleton width="52%" height={18} />
          <View style={{ marginTop: space(2) }}>
            <Skeleton width="85%" height={14} />
          </View>
        </Card>
      ) : error ? (
        <ErrorState title="Couldn't load private messages" onRetry={onRetry} />
      ) : conversations.length === 0 && !focus ? (
        <EmptyState
          icon="mail-outline"
          title="No private messages yet"
          body="Replies from your committee will appear here."
        />
      ) : (
        <View style={{ gap: space(3) }}>
          {conversations.map((conversation) => {
            const expanded = expandedId === conversation.id;
            const highlighted = focus === conversation.id;
            const preview = conversation.lastMessage?.body ?? "Open the conversation";
            return (
              <Card
                key={conversation.id}
                padded={false}
                style={{ backgroundColor: highlighted ? theme.accentSoft : theme.surface }}
              >
                <View style={{ paddingHorizontal: space(4) }}>
                  <ListRow
                    title={conversationTitle(conversation)}
                    subtitle={`${preview} · ${formatRelativeTime(conversation.lastMessageAt)}`}
                    titleLines={2}
                    right={
                      conversation.unreadCount > 0 ? (
                        <StatusPill tone="info" label={String(conversation.unreadCount)} />
                      ) : undefined
                    }
                    chevron
                    onPress={() => onExpand(conversation.id)}
                    accessibilityHint={expanded ? "Collapse conversation" : "Open conversation"}
                  />
                </View>
                {expanded ? (
                  <ConversationThread
                    schemeId={schemeId}
                    conversationId={conversation.id}
                    currentUserId={currentUserId}
                  />
                ) : null}
              </Card>
            );
          })}

          {focusIsOutsidePage ? (
            <Card style={{ backgroundColor: theme.accentSoft }}>
              <Text style={[t.title, { color: theme.text }]}>Private conversation</Text>
              <ConversationThread
                schemeId={schemeId}
                conversationId={focus}
                currentUserId={currentUserId}
              />
            </Card>
          ) : null}
        </View>
      )}
    </>
  );
}

function ConversationThread({
  schemeId,
  conversationId,
  currentUserId,
}: {
  schemeId: string;
  conversationId: string;
  currentUserId: string | undefined;
}) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const threadKeyValue = ["scheme", schemeId, "conversation", conversationId] as const;
  const thread = useQuery({
    queryKey: threadKeyValue,
    queryFn: () =>
      api<{ messages: ConversationMessage[]; nextCursor?: string }>(
        `/api/schemes/${schemeId}/messages/conversations/${conversationId}/messages`,
      ),
    refetchInterval: 10_000,
  });
  const reply = useMutation({
    mutationFn: () =>
      apiPost<{ message: ConversationMessage }>(
        `/api/schemes/${schemeId}/messages/conversations/${conversationId}/messages`,
        { body: body.trim() },
      ),
    onSuccess: async () => {
      setBody("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: threadKeyValue }),
        queryClient.invalidateQueries({ queryKey: ["scheme", schemeId, "conversations"] }),
      ]);
    },
  });

  useEffect(() => {
    void apiPost(`/api/schemes/${schemeId}/messages/conversations/${conversationId}/read`, {})
      .then(() =>
        queryClient.invalidateQueries({ queryKey: ["scheme", schemeId, "conversations"] }),
      )
      .catch(() => undefined);
  }, [conversationId, queryClient, schemeId]);

  const messages = [...(thread.data?.messages ?? [])].reverse();
  return (
    <View
      style={{
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.line,
        padding: space(4),
        gap: space(3),
      }}
    >
      {thread.isPending ? (
        <Skeleton width="75%" height={16} />
      ) : thread.isError ? (
        <View style={{ alignItems: "flex-start", gap: space(2) }}>
          <Text style={[t.bodySmall, { color: theme.crit }]}>This conversation couldn't load.</Text>
          <Button variant="secondary" label="Try again" onPress={() => void thread.refetch()} />
        </View>
      ) : messages.length === 0 ? (
        <Text style={[t.bodySmall, { color: theme.muted }]}>No messages in this thread.</Text>
      ) : (
        <View style={{ gap: space(3) }}>
          {messages.map((message) => {
            const mine = !!currentUserId && message.sender?.userId === currentUserId;
            return (
              <View
                key={message.id}
                style={{
                  alignSelf: mine ? "flex-end" : "stretch",
                  maxWidth: "92%",
                  borderRadius: radius.control,
                  backgroundColor: mine ? theme.accentSoft : theme.bg,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: theme.line,
                  padding: space(3),
                }}
              >
                <Text style={[t.caption, { color: theme.muted }]}>
                  {mine ? "You" : (message.sender?.name ?? "Former member")} ·{" "}
                  {formatRelativeTime(message.createdAt)}
                </Text>
                <Text selectable style={[t.bodySmall, { color: theme.text, marginTop: space(1) }]}>
                  {message.body}
                </Text>
              </View>
            );
          })}
        </View>
      )}

      <FormField
        label="Reply"
        value={body}
        onChangeText={setBody}
        placeholder="Write a private reply…"
        multiline
        maxLength={5000}
        editable={!reply.isPending}
      />
      {reply.isError ? (
        <Text style={[t.caption, { color: theme.crit }]}>
          {errorMessage(reply.error, "Couldn't send that reply.")}
        </Text>
      ) : null}
      <View style={{ alignItems: "flex-end" }}>
        <Button
          variant="secondary"
          label="Send reply"
          onPress={() => reply.mutate()}
          pending={reply.isPending}
          disabled={!body.trim()}
        />
      </View>
    </View>
  );
}

function SelectedImages({
  images,
  onRemove,
}: {
  images: ImagePicker.ImagePickerAsset[];
  onRemove: (index: number) => void;
}) {
  const theme = useTheme();
  return (
    <View
      accessibilityLabel={`${images.length} selected photo${images.length === 1 ? "" : "s"}`}
      style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}
    >
      {images.map((asset, index) => (
        <View key={asset.assetId ?? asset.uri} style={{ width: "31%", aspectRatio: 1 }}>
          <Image
            source={{ uri: asset.uri }}
            resizeMode="cover"
            accessibilityIgnoresInvertColors
            style={{
              width: "100%",
              height: "100%",
              borderRadius: radius.control,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.line,
            }}
          />
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={`Remove photo ${index + 1}`}
            onPress={() => onRemove(index)}
            style={{
              position: "absolute",
              top: space(1),
              right: space(1),
              width: 32,
              height: 32,
              borderRadius: radius.pill,
              backgroundColor: theme.bg,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.line,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="close" size={18} color={theme.text} />
          </PressableScale>
        </View>
      ))}
    </View>
  );
}

function PostCard({
  schemeId,
  post,
  highlighted,
  currentUserId,
  isCommunityOfficer,
  expanded,
  onToggleThread,
  patchPost,
  removePost,
}: {
  schemeId: string;
  post: PostSummary;
  highlighted: boolean;
  currentUserId: string | undefined;
  isCommunityOfficer: boolean;
  expanded: boolean;
  onToggleThread: () => void;
  patchPost: (postId: string, patch: (post: PostSummary) => PostSummary) => void;
  removePost: (postId: string) => void;
}) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const canDelete = currentUserId === post.author.userId || isCommunityOfficer;

  const likePost = useMutation({
    mutationFn: () =>
      apiPost<{ liked: boolean; likeCount: number }>(
        `/api/schemes/${schemeId}/community/posts/${post.id}/like`,
      ),
    onMutate: () => {
      setActionError(null);
      patchPost(post.id, (current) => ({
        ...current,
        likedByMe: !current.likedByMe,
        likeCount: Math.max(0, current.likeCount + (current.likedByMe ? -1 : 1)),
      }));
    },
    onSuccess: (result) => {
      patchPost(post.id, (current) => ({
        ...current,
        likedByMe: result.liked,
        likeCount: result.likeCount,
      }));
    },
    onError: (error) => {
      setActionError(errorMessage(error, "Couldn't update your reaction."));
      void queryClient.invalidateQueries({ queryKey: feedKey(schemeId) });
    },
  });

  const deletePost = useMutation({
    mutationFn: () =>
      apiDelete<{ postId: string }>(`/api/schemes/${schemeId}/community/posts/${post.id}`),
    onSuccess: () => removePost(post.id),
    onError: (error) => setActionError(errorMessage(error, "Couldn't remove the post. Try again.")),
  });

  const confirmDelete = () => {
    Alert.alert(
      "Remove this post?",
      "This removes the post and its comments from the community feed. This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => deletePost.mutate(),
        },
      ],
    );
  };

  return (
    <Card
      padded={false}
      style={{ backgroundColor: highlighted ? theme.accentSoft : theme.surface }}
    >
      <View style={{ padding: space(4) }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space(3) }}>
          <Avatar name={post.author.name} />
          <View style={{ flex: 1 }}>
            <Text style={[t.label, { color: theme.text }]} numberOfLines={1}>
              {post.author.name}
            </Text>
            <Text
              style={{
                fontFamily: t.eyebrow.fontFamily,
                fontSize: 12,
                lineHeight: 16,
                color: theme.muted,
                fontVariant: ["tabular-nums"],
              }}
            >
              {formatRelativeTime(post.createdAt)}
            </Text>
          </View>
          {canDelete ? (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Remove post"
              accessibilityState={{ disabled: deletePost.isPending }}
              disabled={deletePost.isPending}
              onPress={confirmDelete}
              style={{
                width: 44,
                height: 44,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="trash-outline" size={18} color={theme.muted} />
            </PressableScale>
          ) : null}
        </View>
        {post.visibility === "committee" ? (
          <View style={{ marginTop: space(3), alignItems: "flex-start" }}>
            <StatusPill tone="info" label="Committee" />
          </View>
        ) : null}
        <Text selectable style={[t.body, { color: theme.text, marginTop: space(3) }]}>
          {post.body}
        </Text>
        <PostImages schemeId={schemeId} post={post} />
        {actionError ? (
          <Text style={[t.caption, { color: theme.crit, marginTop: space(2) }]}>{actionError}</Text>
        ) : null}
      </View>
      <View
        style={{
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: theme.line,
          flexDirection: "row",
          paddingHorizontal: space(2),
        }}
      >
        <CountAction
          icon={post.likedByMe ? "heart" : "heart-outline"}
          active={post.likedByMe}
          count={post.likeCount}
          label={post.likedByMe ? "Unlike post" : "Like post"}
          onPress={() => likePost.mutate()}
          disabled={likePost.isPending}
        />
        <CountAction
          icon="chatbubble-outline"
          active={expanded}
          count={post.commentCount}
          label={expanded ? "Hide comments" : "Show comments"}
          onPress={onToggleThread}
        />
      </View>
      {expanded ? (
        <CommentThread
          schemeId={schemeId}
          postId={post.id}
          currentUserId={currentUserId}
          isCommunityOfficer={isCommunityOfficer}
          patchPost={patchPost}
        />
      ) : null}
    </Card>
  );
}

function PostImages({ schemeId, post }: { schemeId: string; post: PostSummary }) {
  const theme = useTheme();
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  if (post.images.length === 0) return null;
  const openImage = openIndex === null ? undefined : post.images[openIndex];
  const source = (imageId: string) => ({
    uri: `${API_ORIGIN}/api/schemes/${schemeId}/community/images/${imageId}/content`,
    headers: cookieHeaders(),
  });

  return (
    <>
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: space(2),
          marginTop: space(3),
        }}
      >
        {post.images.map((image, index) => {
          const wide = post.images.length === 1 || (post.images.length === 3 && index === 0);
          return (
            <PressableScale
              key={image.id}
              accessibilityRole="button"
              accessibilityLabel={`View photo ${index + 1} of ${post.images.length} from ${post.author.name}`}
              onPress={() => setOpenIndex(index)}
              style={{ width: wide ? "100%" : "48.5%" }}
            >
              <Image
                source={source(image.id)}
                resizeMode="cover"
                accessibilityIgnoresInvertColors
                style={{
                  width: "100%",
                  aspectRatio: wide ? 16 / 9 : 1,
                  maxHeight: 320,
                  borderRadius: radius.control,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: theme.line,
                  backgroundColor: theme.accentSoft,
                }}
              />
            </PressableScale>
          );
        })}
      </View>
      <Modal
        visible={!!openImage}
        animationType="fade"
        presentationStyle="fullScreen"
        statusBarTranslucent
        onRequestClose={() => setOpenIndex(null)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: "#000000" }}>
          <View style={{ alignItems: "flex-end", paddingHorizontal: space(3) }}>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Close full-screen photo"
              onPress={() => setOpenIndex(null)}
              style={{
                width: 48,
                height: 48,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="close" size={28} color="#ffffff" />
            </PressableScale>
          </View>
          {openImage ? (
            <Image
              source={source(openImage.id)}
              resizeMode="contain"
              accessibilityLabel={`Photo shared by ${post.author.name}`}
              accessibilityIgnoresInvertColors
              style={{ flex: 1, width: "100%" }}
            />
          ) : null}
        </SafeAreaView>
      </Modal>
    </>
  );
}

function CommentThread({
  schemeId,
  postId,
  currentUserId,
  isCommunityOfficer,
  patchPost,
}: {
  schemeId: string;
  postId: string;
  currentUserId: string | undefined;
  isCommunityOfficer: boolean;
  patchPost: (postId: string, patch: (post: PostSummary) => PostSummary) => void;
}) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const thread = useQuery({
    queryKey: threadKey(schemeId, postId),
    queryFn: () => api<{ post: ThreadView }>(`/api/schemes/${schemeId}/community/posts/${postId}`),
  });

  const addComment = useMutation({
    mutationFn: () =>
      apiPost<{ comment: CommentView }>(
        `/api/schemes/${schemeId}/community/posts/${postId}/comments`,
        { body: body.trim() },
      ),
    onSuccess: ({ comment }) => {
      setBody("");
      queryClient.setQueryData<{ post: ThreadView }>(threadKey(schemeId, postId), (old) =>
        old
          ? {
              post: {
                ...old.post,
                commentCount: old.post.commentCount + 1,
                comments: [...old.post.comments, comment],
              },
            }
          : old,
      );
      patchPost(postId, (post) => ({
        ...post,
        commentCount: post.commentCount + 1,
      }));
    },
  });

  const canComment = body.trim().length > 0 && !addComment.isPending;
  return (
    <View
      style={{
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.line,
        backgroundColor: theme.accentSoft,
        padding: space(4),
        gap: space(3),
      }}
    >
      <Text style={[t.label, { color: theme.text }]}>Comments</Text>
      {thread.isPending ? (
        <View style={{ gap: space(3) }}>
          <Skeleton width="75%" height={16} />
          <Skeleton width="60%" height={16} />
        </View>
      ) : thread.isError || !thread.data ? (
        <View style={{ gap: space(2), alignItems: "flex-start" }}>
          <Text style={[t.bodySmall, { color: theme.crit }]}>
            {errorMessage(thread.error, "Couldn't load the comments.")}
          </Text>
          <Button variant="secondary" label="Try again" onPress={() => void thread.refetch()} />
        </View>
      ) : thread.data.post.comments.length === 0 ? (
        <Text style={[t.bodySmall, { color: theme.muted }]}>
          {"No comments yet — be the first to reply."}
        </Text>
      ) : (
        <View style={{ gap: space(3) }}>
          {thread.data.post.comments.map((comment) => (
            <CommentRow
              key={comment.id}
              schemeId={schemeId}
              postId={postId}
              comment={comment}
              currentUserId={currentUserId}
              isCommunityOfficer={isCommunityOfficer}
              onRemoved={() =>
                patchPost(postId, (post) => ({
                  ...post,
                  commentCount: Math.max(0, post.commentCount - 1),
                }))
              }
            />
          ))}
        </View>
      )}

      {thread.data ? (
        <View style={{ gap: space(3), marginTop: space(1) }}>
          <FormField
            label="Add a comment"
            value={body}
            onChangeText={setBody}
            placeholder="Write a comment…"
            multiline
            maxLength={MAX_BODY_CHARS}
          />
          {addComment.isError ? (
            <Text style={[t.caption, { color: theme.crit }]}>
              {errorMessage(addComment.error, "Couldn't add that comment. Try again.")}
            </Text>
          ) : null}
          <View style={{ alignItems: "flex-end" }}>
            <Button
              variant="secondary"
              label="Add comment"
              onPress={() => addComment.mutate()}
              disabled={!canComment}
              pending={addComment.isPending}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function CommentRow({
  schemeId,
  postId,
  comment,
  currentUserId,
  isCommunityOfficer,
  onRemoved,
}: {
  schemeId: string;
  postId: string;
  comment: CommentView;
  currentUserId: string | undefined;
  isCommunityOfficer: boolean;
  onRemoved: () => void;
}) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const canDelete = currentUserId === comment.author.userId || isCommunityOfficer;

  const patchComment = (patch: (current: CommentView) => CommentView) => {
    queryClient.setQueryData<{ post: ThreadView }>(threadKey(schemeId, postId), (old) =>
      old
        ? {
            post: {
              ...old.post,
              comments: old.post.comments.map((item) =>
                item.id === comment.id ? patch(item) : item,
              ),
            },
          }
        : old,
    );
  };

  const likeComment = useMutation({
    mutationFn: () =>
      apiPost<{ liked: boolean; likeCount: number }>(
        `/api/schemes/${schemeId}/community/comments/${comment.id}/like`,
      ),
    onMutate: () => {
      setActionError(null);
      patchComment((current) => ({
        ...current,
        likedByMe: !current.likedByMe,
        likeCount: Math.max(0, current.likeCount + (current.likedByMe ? -1 : 1)),
      }));
    },
    onSuccess: (result) =>
      patchComment((current) => ({
        ...current,
        likedByMe: result.liked,
        likeCount: result.likeCount,
      })),
    onError: (error) => {
      setActionError(errorMessage(error, "Couldn't update your reaction."));
      void queryClient.invalidateQueries({
        queryKey: threadKey(schemeId, postId),
      });
    },
  });

  const deleteComment = useMutation({
    mutationFn: () =>
      apiDelete<{ commentId: string }>(`/api/schemes/${schemeId}/community/comments/${comment.id}`),
    onSuccess: () => {
      queryClient.setQueryData<{ post: ThreadView }>(threadKey(schemeId, postId), (old) =>
        old
          ? {
              post: {
                ...old.post,
                commentCount: Math.max(0, old.post.commentCount - 1),
                comments: old.post.comments.filter((item) => item.id !== comment.id),
              },
            }
          : old,
      );
      onRemoved();
    },
    onError: (error) =>
      setActionError(errorMessage(error, "Couldn't remove the comment. Try again.")),
  });

  const confirmDelete = () => {
    Alert.alert(
      "Remove this comment?",
      "This removes the comment from the thread. This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => deleteComment.mutate(),
        },
      ],
    );
  };

  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space(2) }}>
      <Avatar name={comment.author.name} />
      <View style={{ flex: 1 }}>
        <View
          style={{
            borderRadius: radius.control,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.line,
            backgroundColor: theme.surface,
            padding: space(3),
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space(2),
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={[t.label, { color: theme.text }]} numberOfLines={1}>
                {comment.author.name}
              </Text>
              <Text
                style={{
                  fontFamily: t.eyebrow.fontFamily,
                  fontSize: 11,
                  lineHeight: 15,
                  color: theme.muted,
                  fontVariant: ["tabular-nums"],
                }}
              >
                {formatRelativeTime(comment.createdAt)}
              </Text>
            </View>
            {canDelete ? (
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Remove comment"
                accessibilityState={{ disabled: deleteComment.isPending }}
                disabled={deleteComment.isPending}
                onPress={confirmDelete}
                style={{
                  width: 44,
                  height: 44,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons name="trash-outline" size={17} color={theme.muted} />
              </PressableScale>
            ) : null}
          </View>
          <Text selectable style={[t.bodySmall, { color: theme.text, marginTop: space(2) }]}>
            {comment.body}
          </Text>
        </View>
        <View style={{ alignSelf: "flex-start" }}>
          <CountAction
            icon={comment.likedByMe ? "heart" : "heart-outline"}
            active={comment.likedByMe}
            count={comment.likeCount}
            label={comment.likedByMe ? "Unlike comment" : "Like comment"}
            onPress={() => likeComment.mutate()}
            disabled={likeComment.isPending}
          />
        </View>
        {actionError ? <Text style={[t.caption, { color: theme.crit }]}>{actionError}</Text> : null}
      </View>
    </View>
  );
}

function PostSkeleton() {
  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space(3) }}>
        <Skeleton width={36} height={36} radius={radius.pill} />
        <View style={{ flex: 1, gap: space(2) }}>
          <Skeleton width="45%" height={14} />
          <Skeleton width="25%" height={11} />
        </View>
      </View>
      <View style={{ marginTop: space(4), gap: space(2) }}>
        <Skeleton width="100%" height={14} />
        <Skeleton width="82%" height={14} />
      </View>
    </Card>
  );
}
