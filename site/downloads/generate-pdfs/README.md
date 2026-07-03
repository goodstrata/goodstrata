# GoodStrata marketing PDFs — generator

Reproducible, committed generator for the three shareable PDFs linked from the
site (`/downloads/*.pdf`). Branded HTML templates rendered to A4 PDF with real
Chromium via Playwright, so the output matches "The Registry" look of the live
site: **bold Public Sans headings** (never serif), eucalypt accents on
ink/paper, **IBM Plex Mono** for figures, the ink wordmark, and a running footer
with the issuer and page numbers.

## Output (written to the parent `site/downloads/`, filenames kept stable)

| File | Pages | What it is |
| --- | --- | --- |
| `goodstrata-one-pager.pdf` | 1 | Shareable overview: what GoodStrata is, the fee-check hook ($8,400 → $0), the Fitzroy proof numbers, a QR + URL to goodstrata.com.au. |
| `goodstrata-committee-decision-pack.pdf` | 5 | The pack a committee member hands around: the problem, how it works, the money model, objections & answers, how to switch in Victoria + motion wording. |
| `goodstrata-how-we-make-money.pdf` | 3 | The transparency explainer: free for the OC, how we earn, what we refuse, the difference line by line, how to check. |

## Reproduce

```sh
cd site/downloads/generate-pdfs
npm install      # installs playwright + qrcode; Chromium is downloaded on first install
npm run build    # === node generate.js — regenerates all three PDFs in ../
```

If Chromium isn't present yet: `npx playwright install chromium`.

## How it works

- `generate.js` reads each template in `templates/`, inlines `brand.css`, embeds
  the self-hosted fonts from `site/fonts/` as base64 `@font-face` data URIs,
  inlines the wordmark SVG (`site/logo-on-light.svg`) and an offline-generated QR
  code, then renders with `page.pdf({ format: "A4", printBackground: true })` and
  a `displayHeaderFooter` footer (`Good Strata Pty Ltd · ACN 684 135 760 ·
  goodstrata.com.au · Page X / Y`).
- The built page is **fully self-contained** — no network or external file
  requests at render time (fonts, logo and QR are all inlined).

## Files

- `generate.js` — the renderer (the only script).
- `templates/brand.css` — shared print design system (the site's oklch tokens as
  sRGB hex; fonts injected by `generate.js`).
- `templates/one-pager.html`, `templates/committee-decision-pack.html`,
  `templates/how-we-make-money.html` — the document templates. Placeholders:
  `{{LOGO}}` (wordmark SVG) and `{{QR}}` (QR SVG).

## Editing

Edit copy/layout in the templates (and shared styling in `brand.css`), then
re-run `npm run build`. Keep the output filenames unchanged so the site's
download links keep working. The one-pager and the how-we-make-money explainer
carry small per-document `<style>` overrides in their `<head>` to hold them to 1
and 3 pages respectively — adjust those if you change their content length.
