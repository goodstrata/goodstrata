import { FileDown } from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { ApiErrorEnvelope } from "@/lib/api";

/**
 * Fetch-and-save button for server-rendered PDFs (levy notices, receipts,
 * lot statements). Fetching client-side — rather than a bare <a href> — gives
 * a pending spinner while the PDF renders and a toast (with the API's error
 * message) on failure, instead of a dead browser tab.
 */
export function PdfDownloadButton({
  href,
  fallbackFilename,
  children,
  variant = "ghost",
  className,
  title,
  "data-testid": testId,
}: {
  /** Same-origin URL of the PDF route, e.g. /api/schemes/…/pdf */
  href: string;
  /** Used when the response carries no content-disposition filename. */
  fallbackFilename: string;
  children: ReactNode;
  variant?: "ghost" | "outline";
  className?: string;
  title?: string;
  "data-testid"?: string;
}) {
  const [pending, setPending] = useState(false);

  const download = async () => {
    setPending(true);
    try {
      const res = await fetch(href, { credentials: "include" });
      if (!res.ok) {
        let message = `Download failed (${res.status})`;
        try {
          const body = (await res.json()) as ApiErrorEnvelope;
          message = body.error?.message ?? message;
        } catch {
          // fall through with the generic message
        }
        throw new Error(message);
      }
      const blob = await res.blob();
      const disposition = res.headers.get("content-disposition") ?? "";
      const match = disposition.match(/filename="?([^"]+)"?/);
      const filename = match?.[1] ?? fallbackFilename;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    } finally {
      setPending(false);
    }
  };

  return (
    <Button
      size="sm"
      variant={variant}
      className={className}
      pending={pending}
      onClick={() => void download()}
      title={title}
      data-testid={testId}
    >
      <FileDown className="size-4" aria-hidden="true" /> {children}
    </Button>
  );
}
