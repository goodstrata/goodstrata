import { escapeHtml } from "./layout.js";

/**
 * Minimal, safe markdown → HTML for RFQ/work-order scope prose.
 *
 * The scope (`rfqs.specMd` / `workOrders.scope`) is anonymised but still
 * UNTRUSTED prose (agent- or officer-authored). This converter is the single
 * server-side rendering path shared by the transactional emails and the public
 * contractor pages, so it must never emit unescaped user HTML.
 *
 * Method (spec §4): every text run is HTML-escaped FIRST, then a tiny fixed
 * whitelist of block/inline tags is applied. Because the whitelist emits only
 * fixed tags (`<h2>`, `<h3>`, `<ul><li>`, `<p>`, `<strong>`) with no
 * attributes and no passthrough of raw HTML, links, or images, there is no
 * injection surface: a `<script>` in the source becomes `&lt;script&gt;` text.
 *
 * Supported:
 *   - `#` / `##`  → `<h2>` / `<h3>`   (deeper levels collapse to `<h3>`)
 *   - `- ` / `* ` → `<ul><li>` items
 *   - `**bold**`  → `<strong>`        (inline, within any run)
 *   - blank line  → paragraph break
 * Everything else renders as an escaped paragraph. Pure + unit-testable.
 */
export function renderMarkdown(md: string): string {
  const lines = (md ?? "").replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    html.push(`<p>${inline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (listItems.length === 0) return;
    html.push(`<ul>${listItems.map((i) => `<li>${inline(i)}</li>`).join("")}</ul>`);
    listItems = [];
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim() === "") {
      flushAll();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushAll();
      const level = heading[1]!.length;
      const tag = level === 1 ? "h2" : "h3";
      html.push(`<${tag}>${inline(heading[2]!)}</${tag}>`);
      continue;
    }
    const listItem = /^[-*]\s+(.*)$/.exec(line.trim());
    if (listItem) {
      flushParagraph();
      listItems.push(listItem[1]!);
      continue;
    }
    // Plain prose line — accumulate into the current paragraph.
    flushList();
    paragraph.push(line.trim());
  }
  flushAll();

  return html.join("");
}

/**
 * Inline formatting for a single already-block-classified run. Escape the whole
 * run FIRST, then re-introduce the ONLY inline tag we support (`**bold**`) by
 * matching the escaped text. Escaping first means any `<`, `>`, `&`, quotes in
 * the source can never become live markup.
 */
function inline(run: string): string {
  const escaped = escapeHtml(run);
  return escaped.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}
