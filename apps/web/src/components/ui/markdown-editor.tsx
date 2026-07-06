import type * as React from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

type MarkdownEditorProps = Omit<
  React.ComponentProps<"textarea">,
  "value" | "onChange" | "className"
> & {
  value: string;
  onValueChange: (value: string) => void;
  /** Wrapper classes. */
  className?: string;
  /** Classes for the textarea itself (min height, mono, etc.). */
  textareaClassName?: string;
  /**
   * Show a generating overlay over the editor — e.g. while an agent drafts the
   * content. The textarea is disabled and covered.
   */
  loading?: boolean;
  loadingLabel?: string;
};

/**
 * A plain markdown text field (authors edit the raw markdown directly) with an
 * optional generating overlay used while an agent streams content in.
 */
export function MarkdownEditor({
  value,
  onValueChange,
  className,
  textareaClassName,
  loading = false,
  loadingLabel = "Generating…",
  id,
  disabled,
  ...textareaProps
}: MarkdownEditorProps) {
  return (
    <div className={cn("relative", className)}>
      <textarea
        {...textareaProps}
        id={id}
        value={value}
        disabled={loading || disabled}
        onChange={(e) => onValueChange(e.target.value)}
        className={cn(
          "field-sizing-content flex min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30",
          textareaClassName,
        )}
      />
      {loading && (
        <div className="absolute inset-0 flex flex-col rounded-md bg-background/85 backdrop-blur-[1px]">
          <div className="flex-1 space-y-2 p-3" aria-hidden="true">
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="h-3 w-11/12" />
            <Skeleton className="h-3 w-10/12" />
            <Skeleton className="h-3 w-3/5" />
          </div>
          <div className="flex items-center justify-center gap-2 pb-3" aria-live="polite">
            <Spinner size="sm" className="text-primary motion-reduce:animate-none" />
            <span className="text-13 text-muted-foreground">{loadingLabel}</span>
          </div>
        </div>
      )}
    </div>
  );
}
