import ReactMarkdown from "react-markdown";
import { stripAgentTags } from "@/lib/agent-text";
import { cn } from "@/lib/utils";

/**
 * Renders trusted-ish markdown (agent output, decision summaries, minutes)
 * with typography defaults. Raw HTML is never rendered — react-markdown
 * escapes it by default, which is the safe behaviour we want here.
 * Pseudo-XML scaffolding that models sometimes emit (<summary>, <thinking>)
 * is stripped before rendering.
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div
      className={cn(
        "prose prose-sm prose-neutral max-w-[70ch] dark:prose-invert",
        "prose-headings:font-semibold prose-headings:tracking-tight",
        "prose-p:leading-relaxed prose-li:my-0.5",
        "prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:font-normal prose-code:before:content-none prose-code:after:content-none",
        "prose-table:text-sm",
        className,
      )}
    >
      <ReactMarkdown>{stripAgentTags(children)}</ReactMarkdown>
    </div>
  );
}
