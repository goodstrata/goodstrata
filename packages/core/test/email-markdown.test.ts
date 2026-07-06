import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/email/markdown.js";

describe("renderMarkdown — safe, whitelisted", () => {
  it("renders headings, lists, bold and paragraphs", () => {
    const html = renderMarkdown(
      [
        "# Scope of works",
        "",
        "Replace the **failed** valve.",
        "",
        "- item one",
        "- item two",
      ].join("\n"),
    );
    expect(html).toContain("<h2>Scope of works</h2>");
    expect(html).toContain("<strong>failed</strong>");
    expect(html).toContain("<p>Replace the <strong>failed</strong> valve.</p>");
    expect(html).toContain("<ul><li>item one</li><li>item two</li></ul>");
  });

  it("maps ## to <h3> and deeper levels collapse to <h3>", () => {
    expect(renderMarkdown("## Access")).toBe("<h3>Access</h3>");
    expect(renderMarkdown("#### Deep")).toBe("<h3>Deep</h3>");
  });

  it("escapes FIRST — never injects raw user HTML", () => {
    const html = renderMarkdown("<script>alert('x')</script> & <img src=x>");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
  });

  it("does not emit links or images from markdown syntax", () => {
    const html = renderMarkdown("[click](https://evil.example) ![x](https://evil.example/i.png)");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("href");
    expect(html).not.toContain("<img");
  });

  it("bold cannot smuggle markup through the delimiters", () => {
    const html = renderMarkdown("**<b>bad</b>**");
    expect(html).toContain("<strong>&lt;b&gt;bad&lt;/b&gt;</strong>");
    expect(html).not.toContain("<b>bad</b>");
  });

  it("handles empty input", () => {
    expect(renderMarkdown("")).toBe("");
  });
});
