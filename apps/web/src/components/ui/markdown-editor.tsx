import type * as React from "react";
import { useState } from "react";
import { Markdown } from "@/components/Markdown";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

type MarkdownEditorProps = Omit<
  React.ComponentProps<"textarea">,
  "value" | "onChange" | "className"
> & {
  value: string;
  onValueChange: (value: string) => void;
  /** Wrapper classes (the bordered frame). */
  className?: string;
  /** Classes for the textarea itself (min height, mono, etc.). */
  textareaClassName?: string;
  /**
   * Show a generating overlay over the editor — e.g. while an agent drafts the
   * content. The textarea is disabled and the "write" tab is covered.
   */
  loading?: boolean;
  loadingLabel?: string;
};

/**
 * A markdown text field with Write / Preview tabs. "Write" is a plain textarea
 * (raw markdown); "Preview" renders it through the app's safe {@link Markdown}
 * so authors see formatting before they commit it, instead of staring at `##`
 * and `**`. Pass `loading` to overlay a generating state — used while an agent
 * streams content in. The textarea stays mounted across tabs so its id/aria
 * wiring (from Field) and focus survive the switch.
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
  const [tab, setTab] = useState<"write" | "preview">("write");
  const hasContent = value.trim().length > 0;

  return (
    <div
      className={cn(
        "rounded-md border border-input bg-transparent shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30",
        className,
      )}
    >
      <div
        role="tablist"
        aria-label="Editor mode"
        className="flex items-center gap-0.5 border-b border-input px-1.5 py-1"
      >
        {(["write", "preview"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            role="tab"
            aria-selected={tab === mode}
            data-testid={`md-tab-${mode}`}
            onClick={() => setTab(mode)}
            className={cn(
              "rounded px-2 py-0.5 text-13 font-medium capitalize transition-colors",
              tab === mode
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {mode}
          </button>
        ))}
      </div>

      <div className="relative">
        <textarea
          {...textareaProps}
          id={id}
          value={value}
          disabled={loading || disabled}
          onChange={(e) => onValueChange(e.target.value)}
          className={cn(
            "field-sizing-content block w-full resize-y rounded-b-md bg-transparent px-3 py-2 text-base outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed md:text-sm",
            tab === "preview" && "hidden",
            textareaClassName,
          )}
        />
        {tab === "preview" && (
          <div className="min-h-40 px-3 py-2">
            {hasContent ? (
              <Markdown className="prose-sm">{value}</Markdown>
            ) : (
              <p className="text-sm text-muted-foreground">Nothing to preview yet.</p>
            )}
          </div>
        )}

        {loading && (
          <div className="absolute inset-0 flex flex-col rounded-b-md bg-background/85 backdrop-blur-[1px]">
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
    </div>
  );
}
