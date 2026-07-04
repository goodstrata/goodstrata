import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import {
  CircleAlert,
  File as FileIcon,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Lock,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Markdown } from "@/components/Markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Skeleton } from "@/components/ui/skeleton";
import { api, unwrap } from "@/lib/api";
import { formatBytes, formatDate } from "@/lib/format";
import { useIsOfficer } from "@/lib/roles";

interface DocumentRow {
  id: string;
  title: string;
  category: string;
  mime: string;
  sizeBytes: number;
  accessLevel: string;
  retentionUntil: string | null;
  createdAt: string;
}

/** Register categories, in upload-frequency order (mirrors DOCUMENT_CATEGORIES). */
const CATEGORY_LABELS = {
  insurance: "Insurance",
  plan_of_subdivision: "Plan of subdivision",
  rules: "Rules",
  financial: "Financial",
  minutes: "Minutes",
  contract: "Contract",
  correspondence: "Correspondence",
  certificate: "Certificate",
  levy_notice: "Levy notice",
  other: "Other",
} as const;

type Category = keyof typeof CATEGORY_LABELS;

const ACCESS_LABELS: Record<string, string> = {
  owners: "All owners",
  committee: "Committee only",
  admin: "Manager & officers",
};

function categoryLabel(category: string): string {
  return (CATEGORY_LABELS as Record<string, string>)[category] ?? category.replace(/_/g, " ");
}

/** Pick a lucide file icon from a document's mime type. */
function iconForMime(mime: string): LucideIcon {
  if (mime.startsWith("image/")) return FileImage;
  if (mime === "application/pdf") return FileText;
  if (/json/.test(mime)) return FileJson;
  if (/csv|spreadsheet|excel/.test(mime)) return FileSpreadsheet;
  if (/^text\/|markdown/.test(mime)) return FileText;
  return FileIcon;
}

/**
 * Fetch document content from the access-tiered content endpoint. Text renders
 * as markdown; PDFs and images preview inline via an object URL; anything else
 * falls back to a download link.
 */
async function fetchDocumentContent(
  schemeId: string,
  doc: DocumentRow,
): Promise<{ kind: "text"; text: string } | { kind: "blob"; url: string; mime: string }> {
  const res = await fetch(`/api/schemes/${schemeId}/documents/${doc.id}/content`, {
    credentials: "include",
  });
  if (!res.ok) {
    const message = await res
      .json()
      .then((b: { error?: { message?: string } }) => b.error?.message)
      .catch(() => undefined);
    throw new Error(message ?? "Couldn't load this document.");
  }
  const mime = res.headers.get("content-type") ?? doc.mime;
  if (/^text\/|markdown|json/.test(mime)) {
    return { kind: "text", text: await res.text() };
  }
  return { kind: "blob", url: URL.createObjectURL(await res.blob()), mime };
}

function DocumentViewerDialog({
  schemeId,
  doc,
  onClose,
}: {
  schemeId: string;
  doc: DocumentRow;
  onClose: () => void;
}) {
  const { data, isError, error, refetch } = useQuery({
    queryKey: ["document-view", schemeId, doc.id],
    queryFn: () => fetchDocumentContent(schemeId, doc),
    retry: false,
    // Don't cache: a blob URL is revoked on close, so a fresh open must refetch.
    gcTime: 0,
  });

  // Release the object URL when the dialog closes (DESIGN.md §7.1 cleanup).
  useEffect(() => {
    if (data?.kind !== "blob") return;
    const { url } = data;
    return () => URL.revokeObjectURL(url);
  }, [data]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate">{doc.title}</span>
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Badge tone="neutral">{categoryLabel(doc.category)}</Badge>
            {doc.accessLevel !== "owners" && (
              <Badge tone="info">
                <Lock aria-hidden="true" className="size-3" />
                {ACCESS_LABELS[doc.accessLevel] ?? doc.accessLevel}
              </Badge>
            )}
            <span className="font-mono text-xs tabular-nums">{formatBytes(doc.sizeBytes)}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono text-xs tabular-nums">{formatDate(doc.createdAt)}</span>
            {doc.retentionUntil && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-xs">Retain until {formatDate(doc.retentionUntil)}</span>
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        {isError ? (
          <ErrorState
            message={error instanceof Error ? error.message : "Couldn't load this document."}
            onRetry={() => void refetch()}
          />
        ) : !data ? (
          <Skeleton className="h-24" />
        ) : data.kind === "text" ? (
          <div className="overflow-x-auto rounded-lg border bg-muted/30 p-4">
            <Markdown>{data.text}</Markdown>
          </div>
        ) : data.mime.startsWith("image/") ? (
          <img
            src={data.url}
            alt={doc.title}
            className="max-h-[60dvh] w-full rounded-lg border object-contain"
          />
        ) : data.mime === "application/pdf" ? (
          <div className="space-y-3">
            <iframe
              src={data.url}
              title={doc.title}
              className="h-[60dvh] w-full rounded-lg border bg-white dark:bg-muted"
            />
            <Button asChild variant="outline" size="sm" className="w-fit">
              <a href={data.url} download={doc.title}>
                Download
              </a>
            </Button>
          </div>
        ) : (
          <div className="space-y-3 rounded-lg border border-dashed p-6 text-center">
            <p className="text-sm text-muted-foreground">
              This file type can't be previewed here — download it to open it on your device.
            </p>
            <Button asChild className="w-fit">
              <a href={data.url} download={doc.title}>
                Download {doc.title}
              </a>
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function DocumentsSection({ schemeId }: { schemeId: string }) {
  const queryClient = useQueryClient();
  const isOfficer = useIsOfficer(schemeId);
  const [viewing, setViewing] = useState<DocumentRow | null>(null);
  const [filter, setFilter] = useState<"all" | Category>("all");
  const { data, isError, error, refetch, isPlaceholderData } = useQuery({
    queryKey: ["documents", schemeId, filter],
    queryFn: async () =>
      unwrap<{ documents: DocumentRow[] }>(
        await api.schemes[":schemeId"].documents.$get({
          param: { schemeId },
          query: filter === "all" ? {} : { category: filter },
        }),
      ),
    // Keep the previous register on screen while a category filter loads.
    placeholderData: (prev) => prev,
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState<Category>("insurance");
  const [accessLevel, setAccessLevel] = useState("owners");
  const upload = useMutation({
    mutationFn: async () => {
      const file = fileRef.current?.files?.[0];
      if (!file) throw new Error("Choose a file first");
      const form = new FormData();
      form.set("file", file);
      form.set("category", category);
      form.set("accessLevel", accessLevel);
      const res = await fetch(`/api/schemes/${schemeId}/documents`, {
        method: "POST",
        body: form,
        credentials: "include",
      });
      return unwrap(res);
    },
    onSuccess: () => {
      if (fileRef.current) fileRef.current.value = "";
      toast.success("Document uploaded");
      void queryClient.invalidateQueries({ queryKey: ["documents", schemeId] });
      void queryClient.invalidateQueries({ queryKey: ["onboarding", schemeId] });
      void queryClient.invalidateQueries({ queryKey: ["overview", schemeId] });
    },
  });

  return (
    <div className="max-w-2xl space-y-6">
      {isOfficer && (
        <Card>
          <CardHeader>
            <CardTitle>Upload document</CardTitle>
            <CardDescription>
              Insurance certificates, plans, rules and minutes live here.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <Field className="sm:flex-1" label="File">
                <Input ref={fileRef} type="file" data-testid="doc-file" />
              </Field>
              <Field className="sm:w-44" label="Category">
                {(control) => (
                  <Select value={category} onValueChange={(v) => setCategory(v as Category)}>
                    <SelectTrigger
                      id={control.id}
                      aria-describedby={control["aria-describedby"]}
                      className="w-full"
                      data-testid="doc-category"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </Field>
              <Field
                className="sm:w-44"
                label="Visible to"
                hint={accessLevel === "owners" ? undefined : "Hidden from ordinary owners"}
              >
                {(control) => (
                  <Select value={accessLevel} onValueChange={setAccessLevel}>
                    <SelectTrigger
                      id={control.id}
                      aria-describedby={control["aria-describedby"]}
                      className="w-full"
                      data-testid="doc-access"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(ACCESS_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </Field>
            </div>
            {upload.error && (
              <p className="mt-3 flex items-start gap-1.5 text-13 text-critical">
                <CircleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                <span>{upload.error.message}</span>
              </p>
            )}
            <div className="mt-4">
              <Button pending={upload.isPending} onClick={() => upload.mutate()}>
                Upload
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Document register</h2>
        <Select value={filter} onValueChange={(v) => setFilter(v as "all" | Category)}>
          <SelectTrigger size="sm" className="w-44" aria-label="Filter by category">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isError ? (
        <ErrorState
          message={error instanceof Error ? error.message : "Couldn't load the document register."}
          onRetry={() => void refetch()}
        />
      ) : !data ? (
        <Skeleton className="h-24" />
      ) : data.documents.length === 0 ? (
        filter === "all" ? (
          <EmptyState
            icon={FolderOpen}
            title="No documents yet"
            description="Insurance certificates, plans, rules and minutes will appear here."
          />
        ) : (
          <EmptyState
            icon={FolderOpen}
            title={`No ${categoryLabel(filter).toLowerCase()} documents`}
            description="Nothing filed under this category yet — try another category."
          />
        )
      ) : (
        <div className={isPlaceholderData ? "space-y-2 opacity-60" : "space-y-2"}>
          {data.documents.map((d) => {
            const Icon = iconForMime(d.mime);
            return (
              <Card key={d.id} className="py-3">
                <CardContent className="flex items-center justify-between gap-3 px-4">
                  <span className="flex min-w-0 items-center gap-2.5 text-sm">
                    <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{d.title}</span>
                      <span className="block font-mono text-xs text-muted-foreground tabular-nums">
                        {formatBytes(d.sizeBytes)} · {formatDate(d.createdAt)}
                      </span>
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {d.accessLevel !== "owners" && (
                      <Badge tone="info" className="max-sm:hidden">
                        <Lock aria-hidden="true" className="size-3" />
                        {ACCESS_LABELS[d.accessLevel] ?? d.accessLevel}
                      </Badge>
                    )}
                    <Badge tone="neutral" className="max-sm:hidden">
                      {categoryLabel(d.category)}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground"
                      onClick={() => setViewing(d)}
                      aria-label={`View ${d.title}`}
                    >
                      View
                    </Button>
                  </span>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      {viewing && (
        <DocumentViewerDialog schemeId={schemeId} doc={viewing} onClose={() => setViewing(null)} />
      )}
    </div>
  );
}
