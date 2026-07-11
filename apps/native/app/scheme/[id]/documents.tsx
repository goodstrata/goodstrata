import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import { useLocalSearchParams } from "expo-router";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  formatDate,
  humanise,
  ListRow,
  PressableScale,
  plate,
  radius,
  Screen,
  SectionHeader,
  Sheet,
  Skeleton,
  space,
  type as t,
  useListEntering,
  useTheme,
} from "../../../src/components";
import { api, apiDelete } from "../../../src/lib/api";
import { authClient } from "../../../src/lib/auth";
import { API_ORIGIN } from "../../../src/lib/config";
import { schemeQueryOptions, useIsOfficer } from "../../../src/lib/roles";

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

type DocumentCategory = (typeof CATEGORY_ORDER)[number];
type DocumentAccessLevel = "owners" | "committee" | "admin";
type ActiveSheet =
  | { kind: "category" }
  | { kind: "access" }
  | { kind: "document"; document: SchemeDocument }
  | null;

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

const ACCESS_LEVELS: DocumentAccessLevel[] = ["owners", "committee", "admin"];
const ACCESS_LABELS: Record<DocumentAccessLevel, string> = {
  owners: "All owners",
  committee: "Committee only",
  admin: "Manager and officers",
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
  return CATEGORY_LABELS[category] ?? humanise(category);
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

function cookieHeaders(): Record<string, string> {
  try {
    const cookie = authClient.getCookie();
    return cookie ? { Cookie: cookie } : {};
  } catch {
    return {};
  }
}

async function uploadMultipart(
  path: string,
  asset: DocumentPicker.DocumentPickerAsset,
  fields: Record<string, string | undefined>,
): Promise<void> {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value) form.append(key, value);
  }
  form.append("file", {
    uri: asset.uri,
    name: asset.name,
    type: asset.mimeType ?? "application/octet-stream",
  } as unknown as Blob);
  const response = await fetch(`${API_ORIGIN}${path}`, {
    method: "POST",
    headers: { ...cookieHeaders(), Accept: "application/json" },
    body: form,
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(payload?.error?.message ?? `Couldn't file that document (${response.status}).`);
  }
}

/** One section skeleton: eyebrow line, then a card of `rows` document rows. */
function SkeletonGroup({ rows }: { rows: number }) {
  const rowKeys = ["first", "second", "third", "fourth", "fifth"].slice(0, rows);
  return (
    <View>
      <View style={{ marginTop: space(6), marginBottom: space(2) }}>
        <Skeleton width={132} height={11} />
      </View>
      <Card padded={false} style={{ paddingHorizontal: space(4) }}>
        {rowKeys.map((rowKey) => (
          <View
            key={rowKey}
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

function ChoiceField({
  label,
  value,
  hint,
  onPress,
}: {
  label: string;
  value: string;
  hint?: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${value}`}
      accessibilityHint={`Choose ${label.toLowerCase()}`}
      onPress={onPress}
      style={{
        minHeight: 58,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.line,
        borderRadius: radius.control,
        paddingHorizontal: space(3),
        paddingVertical: space(2),
        justifyContent: "center",
      }}
    >
      <Text style={[t.caption, { color: theme.muted }]}>{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
        <Text style={[t.body, { color: theme.text, flex: 1 }]} numberOfLines={1}>
          {value}
        </Text>
        <Ionicons name="chevron-down" size={16} color={theme.muted} />
      </View>
      {hint ? <Text style={[t.caption, { color: theme.muted }]}>{hint}</Text> : null}
    </PressableScale>
  );
}

function OptionRow({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <PressableScale
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={{
        minHeight: 48,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.line,
        flexDirection: "row",
        alignItems: "center",
        gap: space(3),
        paddingHorizontal: space(1),
      }}
    >
      <Ionicons
        name={selected ? "radio-button-on" : "radio-button-off"}
        size={20}
        color={selected ? theme.accent : theme.muted}
      />
      <Text style={[t.body, { color: theme.text, flex: 1 }]}>{label}</Text>
    </PressableScale>
  );
}

export default function DocumentsScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ id: string; focus?: string }>();
  const schemeId = typeof params.id === "string" ? params.id : (params.id?.[0] ?? "");
  const focus = typeof params.focus === "string" ? params.focus : "";

  const schemeQuery = useQuery({ ...schemeQueryOptions(schemeId), enabled: !!schemeId });
  const isOfficer = useIsOfficer(schemeId);
  const queryClient = useQueryClient();

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
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [category, setCategory] = useState<DocumentCategory>("insurance");
  const [accessLevel, setAccessLevel] = useState<DocumentAccessLevel>("owners");
  const [activeSheet, setActiveSheet] = useState<ActiveSheet>(null);
  const [documentAction, setDocumentAction] = useState<{
    id: string;
    kind: "replace" | "delete";
  } | null>(null);

  const refreshDocuments = () =>
    queryClient.invalidateQueries({ queryKey: ["scheme", schemeId, "documents"] });

  const uploadDocument = async () => {
    setUploadError(null);
    let result: DocumentPicker.DocumentPickerResult;
    try {
      result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
      });
    } catch (caught) {
      setUploadError(caught instanceof Error ? caught.message : "Couldn't open the file picker.");
      return;
    }
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setUploading(true);
    try {
      await uploadMultipart(`/api/schemes/${schemeId}/documents`, asset, {
        title: asset.name,
        category,
        accessLevel,
      });
      await refreshDocuments();
    } catch (caught) {
      setUploadError(caught instanceof Error ? caught.message : "Couldn't upload that document.");
    } finally {
      setUploading(false);
    }
  };

  // Owners never bounce out to Safari (which has no session cookie and would
  // 401): the record is fetched with the app's cookie into cache, then
  // presented in-app via the share sheet — preview, save, or send on.
  const openDocument = async (doc: SchemeDocument) => {
    if (openingId || documentAction) return;
    setOpeningId(doc.id);
    try {
      const file = await File.downloadFileAsync(
        `${API_ORIGIN}/api/schemes/${schemeId}/documents/${doc.id}/content`,
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

  const replaceDocument = async (doc: SchemeDocument) => {
    setActiveSheet(null);
    let result: DocumentPicker.DocumentPickerResult;
    try {
      result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
      });
    } catch (caught) {
      Alert.alert(
        "Couldn't open the file picker",
        caught instanceof Error ? caught.message : "Try again in a moment.",
      );
      return;
    }
    if (result.canceled || !result.assets[0]) return;
    setDocumentAction({ id: doc.id, kind: "replace" });
    try {
      await uploadMultipart(
        `/api/schemes/${schemeId}/documents/${doc.id}/supersede`,
        result.assets[0],
        // Preserve the register title while the API inherits category and tier.
        { title: doc.title },
      );
      await refreshDocuments();
    } catch (caught) {
      Alert.alert(
        "Couldn't replace document",
        caught instanceof Error ? caught.message : "Try again in a moment.",
      );
    } finally {
      setDocumentAction(null);
    }
  };

  const deleteDocument = async (doc: SchemeDocument) => {
    setDocumentAction({ id: doc.id, kind: "delete" });
    try {
      await apiDelete<{ ok: true }>(`/api/schemes/${schemeId}/documents/${doc.id}`);
      await refreshDocuments();
    } catch (caught) {
      Alert.alert(
        "Couldn't delete document",
        caught instanceof Error ? caught.message : "Try again in a moment.",
      );
    } finally {
      setDocumentAction(null);
    }
  };

  const confirmDelete = (doc: SchemeDocument) => {
    setActiveSheet(null);
    const retentionCopy = doc.retentionUntil
      ? `This record is retained until ${formatDate(doc.retentionUntil)} and may not be eligible for deletion.`
      : "This removes the document from the register. Its audit record is retained.";
    Alert.alert("Delete this document?", retentionCopy, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => void deleteDocument(doc),
      },
    ]);
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

  let content: ReactNode;
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
                const acting = documentAction?.id === doc.id;
                const size = formatSize(doc.sizeBytes);
                const issued = formatDate(doc.createdAt);
                const tier =
                  doc.accessLevel === "owners"
                    ? ""
                    : (ACCESS_LABELS[doc.accessLevel as DocumentAccessLevel] ??
                      humanise(doc.accessLevel));
                const details = [issued, size, tier].filter(Boolean).join(" · ");
                return (
                  <ListRow
                    key={doc.id}
                    title={doc.title}
                    highlighted={focus === doc.id}
                    subtitle={details}
                    leading={
                      <Ionicons name={categoryIcon(doc.category)} size={18} color={theme.accent} />
                    }
                    chevron={!opening && !acting}
                    right={
                      opening || acting ? (
                        <ActivityIndicator size="small" color={theme.muted} />
                      ) : undefined
                    }
                    onPress={() => {
                      if (openingId || documentAction) return;
                      if (isOfficer) setActiveSheet({ kind: "document", document: doc });
                      else void openDocument(doc);
                    }}
                    accessibilityHint={
                      isOfficer ? "Opens document actions" : "Opens the document share sheet"
                    }
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
      topInset={false}
      eyebrow={eyebrow}
      reserveEyebrow
      refreshing={documentsQuery.isRefetching}
      onRefresh={() => Promise.all([documentsQuery.refetch(), schemeQuery.refetch()])}
    >
      {isOfficer ? (
        <View style={{ marginBottom: space(4) }}>
          <Card>
            <Text style={[t.title, { color: theme.text }]}>File a document</Text>
            <Text style={[t.bodySmall, { color: theme.muted, marginTop: space(1) }]}>
              Choose its register category and who may see it before selecting the file.
            </Text>
            <View style={{ gap: space(3), marginTop: space(4) }}>
              <ChoiceField
                label="Category"
                value={categoryLabel(category)}
                onPress={() => setActiveSheet({ kind: "category" })}
              />
              <ChoiceField
                label="Visible to"
                value={ACCESS_LABELS[accessLevel]}
                hint={accessLevel === "owners" ? undefined : "Hidden from ordinary owners"}
                onPress={() => setActiveSheet({ kind: "access" })}
              />
              {uploadError ? (
                <Text style={[t.bodySmall, { color: theme.crit }]}>{uploadError}</Text>
              ) : null}
              <Button
                full
                label="Choose file and upload"
                onPress={() => void uploadDocument()}
                pending={uploading}
              />
            </View>
          </Card>
        </View>
      ) : null}
      {content}
      <Sheet visible={activeSheet !== null} onClose={() => !documentAction && setActiveSheet(null)}>
        {activeSheet?.kind === "category" ? (
          <View style={{ gap: space(3) }}>
            <View>
              <Text style={[t.title, { color: theme.text }]}>Document category</Text>
              <Text style={[t.bodySmall, { color: theme.muted, marginTop: space(1) }]}>
                File the record where owners will expect to find it.
              </Text>
            </View>
            <ScrollView style={{ maxHeight: 430 }} showsVerticalScrollIndicator={false}>
              {CATEGORY_ORDER.map((option) => (
                <OptionRow
                  key={option}
                  label={categoryLabel(option)}
                  selected={category === option}
                  onPress={() => {
                    setCategory(option);
                    setActiveSheet(null);
                  }}
                />
              ))}
            </ScrollView>
          </View>
        ) : activeSheet?.kind === "access" ? (
          <View style={{ gap: space(3) }}>
            <View>
              <Text style={[t.title, { color: theme.text }]}>Who can see it?</Text>
              <Text style={[t.bodySmall, { color: theme.muted, marginTop: space(1) }]}>
                The API enforces this access tier when listing and opening the file.
              </Text>
            </View>
            {ACCESS_LEVELS.map((option) => (
              <OptionRow
                key={option}
                label={ACCESS_LABELS[option]}
                selected={accessLevel === option}
                onPress={() => {
                  setAccessLevel(option);
                  setActiveSheet(null);
                }}
              />
            ))}
          </View>
        ) : activeSheet?.kind === "document" ? (
          <View style={{ gap: space(3) }}>
            <View>
              <Text style={[t.title, { color: theme.text }]} numberOfLines={2}>
                {activeSheet.document.title}
              </Text>
              <Text style={[t.bodySmall, { color: theme.muted, marginTop: space(1) }]}>
                {categoryLabel(activeSheet.document.category)} ·{" "}
                {formatDate(activeSheet.document.createdAt)}
              </Text>
              {activeSheet.document.retentionUntil ? (
                <Text style={[t.caption, { color: theme.warn, marginTop: space(1) }]}>
                  Statutory retention until {formatDate(activeSheet.document.retentionUntil)}
                </Text>
              ) : null}
            </View>
            <Button
              variant="secondary"
              full
              label="Open or share"
              onPress={() => {
                const doc = activeSheet.document;
                setActiveSheet(null);
                void openDocument(doc);
              }}
            />
            <Button
              full
              label="Replace with a new version"
              onPress={() => void replaceDocument(activeSheet.document)}
            />
            <Button
              variant="destructive"
              full
              label="Delete from register"
              disabled={
                !!activeSheet.document.retentionUntil &&
                activeSheet.document.retentionUntil >= new Date().toISOString().slice(0, 10)
              }
              onPress={() => confirmDelete(activeSheet.document)}
            />
          </View>
        ) : (
          <View />
        )}
      </Sheet>
    </Screen>
  );
}
