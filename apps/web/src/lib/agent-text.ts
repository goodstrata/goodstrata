/**
 * Agent/LLM output sometimes arrives wrapped in pseudo-XML scaffolding
 * (<summary>…</summary>, <thinking>…</thinking>). Strip it before display:
 * reasoning blocks are dropped entirely, wrapper tags are unwrapped.
 */

/** Tags whose entire content is internal reasoning — never show it. */
const REASONING_TAGS = ["thinking", "think", "scratchpad"];
/** Tags that merely wrap the displayable answer — keep the content. */
const WRAPPER_TAGS = ["summary", "answer", "response", "output", "result"];

export function stripAgentTags(text: string): string {
  let out = text;
  for (const tag of REASONING_TAGS) {
    // Well-formed reasoning block: drop tag + content.
    out = out.replace(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, "gi"), "");
  }
  // Any leftover (unmatched) tags from either list: drop just the tag,
  // keeping the text visible — the safe failure mode.
  for (const tag of [...REASONING_TAGS, ...WRAPPER_TAGS]) {
    out = out.replace(new RegExp(`</?${tag}>`, "gi"), "");
  }
  return out.trim();
}
