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
  createdAt: string;
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
 * Probe for document content: a dedicated content endpoint first, then an
 * inline-content detail route. Returns what we can actually show.
 */
async function fetchDocumentContent(
  schemeId: string,
  doc: DocumentRow,
): Promise<
  | { kind: "text"; text: string }
  | { kind: "blob"; url: string; mime: string }
  | { kind: "unavailable" }
> {
  const contentRes = await fetch(`/api/schemes/${schemeId}/documents/${doc.id}/content`, {
    credentials: "include",
  });
  if (contentRes.ok) {
    const mime = contentRes.headers.get("content-type") ?? doc.mime;
    if (/^text\/|markdown|json/.test(mime)) {
      return { kind: "text", text: await contentRes.text() };
    }
    return { kind: "blob", url: URL.createObjectURL(await contentRes.blob()), mime };
  }
  const docRes = await fetch(`/api/schemes/${schemeId}/documents/${doc.id}`, {
    credentials: "include",
  });
  if (docRes.ok) {
    const body = (await docRes.json()) as {
      document?: { content?: string; contentMd?: string };
    };
    const text = body.document?.contentMd ?? body.document?.content;
    if (text) return { kind: "text", text };
  }
  return { kind: "unavailable" };
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
  const { data } = useQuery({
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
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate">{doc.title}</span>
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Badge tone="neutral">{doc.category.replace(/_/g, " ")}</Badge>
            <span className="font-mono text-xs tabular-nums">{formatBytes(doc.sizeBytes)}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono text-xs tabular-nums">{formatDate(doc.createdAt)}</span>
          </DialogDescription>
        </DialogHeader>
        {!data && <Skeleton className="h-24" />}
        {data?.kind === "text" && (
          <div className="overflow-x-auto rounded-lg border bg-muted/30 p-4">
            <Markdown>{data.text}</Markdown>
          </div>
        )}
        {data?.kind === "blob" && (
          <Button asChild className="w-fit">
            <a href={data.url} download={doc.title}>
              Download {doc.title}
            </a>
          </Button>
        )}
        {data?.kind === "unavailable" && (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            Preview and download aren't available for this document yet — the file is stored safely
            and downloads are coming soon.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function DocumentsSection({ schemeId }: { schemeId: string }) {
  const queryClient = useQueryClient();
  const isOfficer = useIsOfficer(schemeId);
  const [viewing, setViewing] = useState<DocumentRow | null>(null);
  const { data, isError, error, refetch } = useQuery({
    queryKey: ["documents", schemeId],
    queryFn: async () =>
      unwrap<{ documents: DocumentRow[] }>(
        await api.schemes[":schemeId"].documents.$get({ param: { schemeId }, query: {} }),
      ),
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState("insurance");
  const upload = useMutation({
    mutationFn: async () => {
      const file = fileRef.current?.files?.[0];
      if (!file) throw new Error("Choose a file first");
      const form = new FormData();
      form.set("file", file);
      form.set("category", category);
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
              <Field className="sm:w-52" label="Category">
                {(control) => (
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger
                      id={control.id}
                      aria-describedby={control["aria-describedby"]}
                      className="w-full"
                      data-testid="doc-category"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="insurance">Insurance</SelectItem>
                      <SelectItem value="plan_of_subdivision">Plan of subdivision</SelectItem>
                      <SelectItem value="rules">Rules</SelectItem>
                      <SelectItem value="financial">Financial</SelectItem>
                      <SelectItem value="minutes">Minutes</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
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

      {isError ? (
        <ErrorState
          message={error instanceof Error ? error.message : "Couldn't load the document register."}
          onRetry={() => void refetch()}
        />
      ) : !data ? (
        <Skeleton className="h-24" />
      ) : data.documents.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="No documents yet"
          description="Insurance certificates, plans, rules and minutes will appear here."
        />
      ) : (
        <div className="space-y-2">
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
                    <Badge tone="neutral">{d.category.replace(/_/g, " ")}</Badge>
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
