import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef } from "react";
import { Markdown } from "tiptap-markdown";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

type MarkdownEditorProps = {
  value: string;
  onValueChange: (value: string) => void;
  /** Wrapper classes (the bordered frame). */
  className?: string;
  /** Generating overlay — e.g. while an agent drafts the content. */
  loading?: boolean;
  loadingLabel?: string;
  id?: string;
  "data-testid"?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  "aria-required"?: boolean;
};

/** tiptap-markdown augments editor.storage at runtime, but not in the types. */
const getMarkdown = (editor: { storage: unknown }): string =>
  (editor.storage as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown();

// The editable surface is rendered through prose so it's WYSIWYG — headings,
// lists and bold show formatted as you type — mapped onto Registry ink tokens.
const EDITOR_CLASS = cn(
  "prose prose-sm max-w-none min-h-40 px-3 py-2 outline-none dark:prose-invert",
  "[--tw-prose-body:var(--color-foreground)] [--tw-prose-headings:var(--color-foreground)] [--tw-prose-bold:var(--color-foreground)] [--tw-prose-bullets:var(--color-muted-foreground)]",
  "[--tw-prose-invert-body:var(--color-foreground)] [--tw-prose-invert-headings:var(--color-foreground)] [--tw-prose-invert-bold:var(--color-foreground)]",
  "prose-headings:font-semibold prose-headings:tracking-tight prose-headings:mt-3 prose-headings:mb-1 prose-p:my-2 prose-li:my-0.5",
);

/**
 * A WYSIWYG markdown editor: content is always shown rendered (headings, lists,
 * bold) while you edit, and is read/written as markdown. Built on TipTap +
 * tiptap-markdown. Pass `loading` to overlay a generating state while an agent
 * streams the content in — the editor is read-only and covered until it lands.
 */
export function MarkdownEditor({
  value,
  onValueChange,
  className,
  loading = false,
  loadingLabel = "Generating…",
  id,
  ...rest
}: MarkdownEditorProps) {
  // True immediately after an onUpdate, so the value-sync effect below skips the
  // echo (which would reset the caret on every keystroke) and only re-syncs when
  // `value` changes from OUTSIDE the editor (e.g. the agent's drafted scope).
  const fromEditor = useRef(false);

  const editor = useEditor({
    immediatelyRender: false,
    editable: !loading,
    extensions: [StarterKit, Markdown.configure({ bulletListMarker: "-", transformPastedText: true })],
    content: value,
    onUpdate: ({ editor }) => {
      fromEditor.current = true;
      onValueChange(getMarkdown(editor));
    },
    editorProps: {
      attributes: {
        class: EDITOR_CLASS,
        role: "textbox",
        "aria-multiline": "true",
        ...(id ? { id } : {}),
        ...(rest["aria-invalid"] ? { "aria-invalid": "true" } : {}),
        ...(rest["aria-describedby"] ? { "aria-describedby": rest["aria-describedby"] } : {}),
        ...(rest["aria-required"] ? { "aria-required": "true" } : {}),
      },
    },
  });

  useEffect(() => {
    editor?.setEditable(!loading);
  }, [editor, loading]);

  useEffect(() => {
    if (!editor) return;
    if (fromEditor.current) {
      fromEditor.current = false;
      return;
    }
    if (value !== getMarkdown(editor)) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
  }, [editor, value]);

  return (
    <div
      data-testid={rest["data-testid"]}
      className={cn(
        "rounded-md border border-input bg-transparent shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30",
        className,
      )}
    >
      <div className="relative">
        <EditorContent editor={editor} />
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
    </div>
  );
}
