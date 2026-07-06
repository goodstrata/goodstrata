import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { File, Paths } from "expo-file-system";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Share, View } from "react-native";
import Animated from "react-native-reanimated";
import {
  Card,
  EmptyState,
  ErrorState,
  ListRow,
  Screen,
  SectionHeader,
  Skeleton,
  formatDate,
  plate,
  space,
  useListEntering,
  useTheme,
} from "../../../src/components";
import { api } from "../../../src/lib/api";
import { authClient } from "../../../src/lib/auth";
import { schemeQueryOptions } from "../../../src/lib/roles";

const BASE = "https://my.goodstrata.com.au";

interface SchemeDocument {
  id: string;
  title: string;
  category: string;
  mime: string;
  sizeBytes: number | null;
  accessLevel: string;
  retentionUntil: string | null;
  createdAt: string;
}

interface DocumentsResponse {
  documents: SchemeDocument[];
}

/** Register order for the grouped list; unknown categories append after. */
const CATEGORY_ORDER = [
  "plan_of_subdivision",
  "rules",
  "insurance",
  "financial",
  "minutes",
  "contract",
  "certificate",
  "levy_notice",
  "correspondence",
  "other",
] as const;

const CATEGORY_LABELS: Record<string, string> = {
  plan_of_subdivision: "Plan of subdivision",
  rules: "Rules",
  insurance: "Insurance",
  financial: "Financial",
  minutes: "Minutes",
  contract: "Contracts",
  certificate: "Certificates",
  levy_notice: "Levy notices",
  correspondence: "Correspondence",
  other: "Other documents",
};

const CATEGORY_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  plan_of_subdivision: "map-outline",
  rules: "book-outline",
  insurance: "shield-checkmark-outline",
  financial: "cash-outline",
  minutes: "reader-outline",
  contract: "briefcase-outline",
  certificate: "ribbon-outline",
  levy_notice: "receipt-outline",
  correspondence: "mail-outline",
  other: "document-text-outline",
};

function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category.replace(/_/g, " ");
}

function categoryIcon(category: string): keyof typeof Ionicons.glyphMap {
  return CATEGORY_ICONS[category] ?? "document-text-outline";
}

/** "1.2 MB" / "340 KB"; empty when the size is unknown. */
function formatSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Extensions QuickLook/share targets recognise, keyed by declared mime. */
const EXTENSION_BY_MIME: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "text/plain": ".txt",
  "text/csv": ".csv",
};

/** Cache filename for a document: sanitised title plus a mime-derived extension. */
function localName(doc: SchemeDocument): string {
  const base = doc.title.replace(/[^\w.\- ]/g, "_").trim() || "document";
  const mime = doc.mime.split(";")[0]?.trim().toLowerCase() ?? "";
  const ext = EXTENSION_BY_MIME[mime] ?? "";
  return ext && !base.toLowerCase().endsWith(ext) ? `${base}${ext}` : base;
}

/** One section skeleton: eyebrow line, then a card of `rows` document rows. */
function SkeletonGroup({ rows }: { rows: number }) {
  return (
    <View>
      <View style={{ marginTop: space(6), marginBottom: space(2) }}>
        <Skeleton width={132} height={11} />
      </View>
      <Card padded={false} style={{ paddingHorizontal: space(4) }}>
        {Array.from({ length: rows }, (_, i) => (
          <View
            key={i}
            style={{
              flexDirection: "row",
              alignItems: "center",
              minHeight: 56,
              paddingVertical: space(3),
            }}
          >
            <Skeleton width={36} height={36} radius={18} />
            <View style={{ flex: 1, marginLeft: space(3), gap: space(2) }}>
              <Skeleton width="62%" height={14} />
              <Skeleton width="38%" height={10} />
            </View>
          </View>
        ))}
      </Card>
    </View>
  );
}

export default function DocumentsScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ id: string }>();
  const schemeId = typeof params.id === "string" ? params.id : (params.id?.[0] ?? "");

  const schemeQuery = useQuery({ ...schemeQueryOptions(schemeId), enabled: !!schemeId });

  const documentsQuery = useQuery({
    queryKey: ["scheme", schemeId, "documents"],
    queryFn: () => api<DocumentsResponse>(`/api/schemes/${schemeId}/documents`),
    enabled: !!schemeId,
  });

  const documents = documentsQuery.data?.documents;

  // Entrance runs on the first successful load only; refetches change in place.
  const firstLoad = useRef(true);
  useEffect(() => {
    if (documents) firstLoad.current = false;
  }, [documents]);
  const entering = useListEntering(firstLoad.current);

  // One document opens at a time; re-taps are ignored until it settles.
  const [openingId, setOpeningId] = useState<string | null>(null);

  // Owners never bounce out to Safari (which has no session cookie and would
  // 401): the record is fetched with the app's cookie into cache, then
  // presented in-app via the share sheet — preview, save, or send on.
  const openDocument = async (doc: SchemeDocument) => {
    if (openingId) return;
    setOpeningId(doc.id);
    try {
      const file = await File.downloadFileAsync(
        `${BASE}/api/schemes/${schemeId}/documents/${doc.id}/content`,
        new File(Paths.cache, localName(doc)),
        { headers: { Cookie: authClient.getCookie() }, idempotent: true },
      );
      await Share.share({ url: file.uri, title: doc.title });
    } catch {
      // Fetch or share declined; the row simply settles back.
    } finally {
      setOpeningId(null);
    }
  };

  const groups = useMemo(() => {
    if (!documents) return [];
    const byCategory = new Map<string, SchemeDocument[]>();
    for (const doc of documents) {
      const list = byCategory.get(doc.category) ?? [];
      list.push(doc);
      byCategory.set(doc.category, list);
    }
    const known = CATEGORY_ORDER.filter((c) => byCategory.has(c)) as string[];
    const unknown = [...byCategory.keys()].filter(
      (c) => !(CATEGORY_ORDER as readonly string[]).includes(c),
    );
    return [...known, ...unknown].map((category) => ({
      category,
      label: categoryLabel(category),
      docs: byCategory
        .get(category)!
        .slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    }));
  }, [documents]);

  const eyebrow = plate(schemeQuery.data?.scheme);

  let content;
  if (documentsQuery.isPending) {
    content = (
      <View>
        <SkeletonGroup rows={3} />
        <SkeletonGroup rows={3} />
      </View>
    );
  } else if (documentsQuery.isError && !documents) {
    content = <ErrorState onRetry={() => documentsQuery.refetch()} />;
  } else if (!documents || documents.length === 0) {
    content = (
      <View style={{ marginTop: space(6) }}>
        <EmptyState
          icon="document-text-outline"
          title="No documents yet"
          body="The committee's records will appear here."
        />
      </View>
    );
  } else {
    content = (
      <View>
        {groups.map((group, sectionIndex) => (
          <Animated.View key={group.category} entering={entering(sectionIndex)}>
            <SectionHeader label={group.label} />
            <Card padded={false} style={{ paddingHorizontal: space(4) }}>
              {group.docs.map((doc, i) => {
                const opening = openingId === doc.id;
                const size = formatSize(doc.sizeBytes);
                const issued = formatDate(doc.createdAt);
                return (
                  <ListRow
                    key={doc.id}
                    title={doc.title}
                    subtitle={size ? `${issued} · ${size}` : issued}
                    leading={
                      <Ionicons name={categoryIcon(doc.category)} size={18} color={theme.accent} />
                    }
                    chevron={!opening}
                    right={
                      opening ? <ActivityIndicator size="small" color={theme.muted} /> : undefined
                    }
                    onPress={() => openDocument(doc)}
                    divider={i < group.docs.length - 1}
                  />
                );
              })}
            </Card>
          </Animated.View>
        ))}
      </View>
    );
  }

  return (
    <Screen
      title="Documents"
      eyebrow={eyebrow}
      reserveEyebrow
      refreshing={documentsQuery.isRefetching}
      onRefresh={() => {
        documentsQuery.refetch();
        schemeQuery.refetch();
      }}
    >
      {content}
    </Screen>
  );
}
