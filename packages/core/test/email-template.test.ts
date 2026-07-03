import { describe, expect, it } from "vitest";
import {
  amountPanel,
  type EmailInput,
  emailBrand,
  infoNote,
  keyValueTable,
  paragraph,
  renderEmail,
} from "../src/email/layout.js";

const SAMPLE: EmailInput = {
  preheader: "Levy notice L-2026-014 — $8,400.00 due 14 July 2026 for lot 12.",
  heading: "Levy notice L-2026-014 issued",
  intro: "Your quarterly administrative and capital works levies have been issued.",
  blocks: [
    amountPanel("Total due", "$8,400.00", { sublabel: "Due 14 July 2026" }),
    keyValueTable(
      [
        { label: "Notice number", value: "L-2026-014" },
        { label: "Lot", value: "12 — 4/220 Rundle St" },
        { label: "Due date", value: "14 July 2026" },
      ],
      "Notice details",
    ),
    paragraph("You can pay online or set up a direct debit from your dashboard."),
    infoNote("Interest accrues on overdue levies under the scheme by-laws."),
  ],
  cta: { label: "View & pay levy", url: "https://my.goodstrata.com.au/levies/L-2026-014" },
  secondaryLinks: [
    { label: "Download PDF", url: "https://my.goodstrata.com.au/levies/L-2026-014.pdf" },
  ],
  footerNote: "You receive this because you are the levy recipient for lot 12.",
};

describe("renderEmail", () => {
  const { html, text } = renderEmail(SAMPLE);

  it("produces a full HTML document with masthead + card", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("</html>");
    expect(html).toContain(emailBrand.urls.logo);
    expect(html).toContain('alt="GoodStrata"');
    // Table-based, inline-styled layout (no external stylesheet links).
    expect(html).toContain('role="presentation"');
    expect(html).not.toContain("<link");
  });

  it("balances every HTML tag it opens", () => {
    const opens = (html.match(/<(table|tr|td|div|a|h1)\b/g) ?? []).length;
    const closes = (html.match(/<\/(table|tr|td|div|a|h1)>/g) ?? []).length;
    expect(opens).toBe(closes);
  });

  it("renders the heading, preheader, CTA and every block", () => {
    expect(html).toContain("Levy notice L-2026-014 issued");
    expect(html).toContain("Levy notice L-2026-014 —"); // preheader
    expect(html).toContain("$8,400.00");
    expect(html).toContain("Notice details");
    expect(html).toContain("https://my.goodstrata.com.au/levies/L-2026-014");
    expect(html).toContain("View &amp; pay levy"); // label escaped + amp
  });

  it("carries the brand footer + audit-log trust line", () => {
    expect(html).toContain(emailBrand.issuer);
    expect(html).toContain(emailBrand.acn);
    expect(html).toContain(emailBrand.trustLine);
    expect(html).toContain(emailBrand.urls.terms);
    expect(html).toContain(emailBrand.urls.privacy);
    expect(html).toContain("Manage notifications");
  });

  it("escapes HTML-significant characters in content", () => {
    const out = renderEmail({
      preheader: "p",
      heading: "A & B <script>alert(1)</script>",
    }).html;
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
    expect(out).toContain("A &amp; B");
  });

  it("produces an accessible plaintext body mirroring the content", () => {
    expect(text).toContain("Levy notice L-2026-014 issued");
    expect(text).toContain("$8,400.00");
    expect(text).toContain("Notice number: L-2026-014");
    expect(text).toContain("View & pay levy: https://my.goodstrata.com.au/levies/L-2026-014");
    expect(text).toContain(emailBrand.trustLine);
    expect(text).toContain(emailBrand.acn);
    expect(text).toContain(`Terms: ${emailBrand.urls.terms}`);
    // Plaintext must never contain markup.
    expect(text).not.toContain("<");
    expect(text.endsWith("\n")).toBe(true);
  });

  it("honours a per-recipient preferences URL override", () => {
    const prefs = "https://my.goodstrata.com.au/u/abc/notifications";
    const out = renderEmail({ preheader: "p", heading: "h", preferencesUrl: prefs });
    expect(out.html).toContain(prefs);
    expect(out.text).toContain(prefs);
  });

  it("works with only the required fields", () => {
    const out = renderEmail({ preheader: "Quick heads up", heading: "All done" });
    expect(out.html).toContain("All done");
    expect(out.text).toContain("All done");
    expect(out.html.startsWith("<!doctype html>")).toBe(true);
  });
});
