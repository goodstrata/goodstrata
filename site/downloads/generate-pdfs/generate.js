#!/usr/bin/env node
/* =====================================================================
   GoodStrata marketing PDF generator.

   Renders the branded HTML templates in ./templates to A4 PDFs in the
   parent downloads/ directory, keeping the filenames the site links to.

   High fidelity: real Chromium via Playwright, self-hosted Public Sans +
   IBM Plex Mono, the wordmark SVG inlined, eucalypt brand tokens, and a
   running footer (issuer + page numbers) drawn by Chromium's print path.

   Reproduce:  npm install && npm run build
   ===================================================================== */

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const QRCode = require("qrcode");

const HERE = __dirname;
const TEMPLATES = path.join(HERE, "templates");
const OUT_DIR = path.resolve(HERE, ".."); // site/downloads
const SITE = path.resolve(HERE, "..", ".."); // site/
const FONTS = path.join(SITE, "fonts");

// Self-hosted brand fonts, embedded as base64 data URIs so the built page is
// fully self-contained (no path/network dependence at render time).
const FONT_FILES = [
  { family: "Public Sans", weight: "100 900", variations: true, file: "public-sans-latin-wght-normal.woff2" },
  { family: "Public Sans", weight: "100 900", variations: true, file: "public-sans-latin-ext-wght-normal.woff2" },
  { family: "IBM Plex Mono", weight: "400", variations: false, file: "ibm-plex-mono-latin-400-normal.woff2" },
  { family: "IBM Plex Mono", weight: "500", variations: false, file: "ibm-plex-mono-latin-500-normal.woff2" },
  { family: "IBM Plex Mono", weight: "600", variations: false, file: "ibm-plex-mono-latin-600-normal.woff2" },
];

function fontFaceCss() {
  return FONT_FILES.map(({ family, weight, variations, file }) => {
    const b64 = fs.readFileSync(path.join(FONTS, file)).toString("base64");
    const fmt = variations ? "woff2-variations" : "woff2";
    return `@font-face{font-family:"${family}";font-style:normal;font-weight:${weight};` +
      `src:url(data:font/woff2;base64,${b64}) format("${fmt}");}`;
  }).join("\n");
}

// Wordmark: slate-ink logo on our paper background. Strip the XML prolog so
// it inlines cleanly, and force a print-friendly height.
function loadLogo() {
  let svg = fs.readFileSync(path.join(SITE, "logo-on-light.svg"), "utf8");
  svg = svg.replace(/<\?xml[^>]*\?>\s*/i, "");
  svg = svg.replace(/<svg /, '<svg preserveAspectRatio="xMinYMid meet" ');
  return svg.trim();
}

async function makeQR(url) {
  // Offline QR as inline SVG — no network, fully reproducible. Eucalypt on paper.
  return QRCode.toString(url, {
    type: "svg",
    margin: 0,
    color: { dark: "#095b41", light: "#00000000" },
    errorCorrectionLevel: "M",
  });
}

const FOOTER = `
  <div style="width:100%;font-family:Arial,Helvetica,sans-serif;font-size:7px;color:#6b727c;
              padding:0 15mm;box-sizing:border-box;">
    <div style="border-top:1px solid #dce0e5;padding-top:4px;display:flex;
                justify-content:space-between;align-items:center;">
      <span>Good Strata Pty Ltd &middot; ACN 684 135 760 &middot; goodstrata.com.au</span>
      <span>Page <span class="pageNumber"></span> / <span class="totalPages"></span></span>
    </div>
  </div>`;

const DOCS = [
  { template: "one-pager.html", out: "goodstrata-one-pager.pdf", qr: "https://goodstrata.com.au/what-am-i-paying/" },
  { template: "committee-decision-pack.html", out: "goodstrata-committee-decision-pack.pdf", qr: "https://goodstrata.com.au/for-owners/" },
  { template: "how-we-make-money.html", out: "goodstrata-how-we-make-money.pdf", qr: "https://goodstrata.com.au/how-we-make-money/" },
];

async function build() {
  const logo = loadLogo();
  const brandCss = fs.readFileSync(path.join(TEMPLATES, "brand.css"), "utf8");
  const styleBlock = `<style>\n${fontFaceCss()}\n${brandCss}\n</style>`;
  const browser = await chromium.launch();
  const page = await browser.newPage();

  for (const doc of DOCS) {
    const src = fs.readFileSync(path.join(TEMPLATES, doc.template), "utf8");
    const qr = await makeQR(doc.qr);
    // Inline the stylesheet + embedded fonts so the page is self-contained;
    // drop any site-injected <script> (e.g. nav.js) — irrelevant to print.
    // The link match is tolerant of attribute reordering / self-close style.
    let html = src
      .replace(/<link[^>]*href=["']brand\.css["'][^>]*>/i, styleBlock)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
      .replaceAll("{{LOGO}}", logo)
      .replaceAll("{{QR}}", qr);
    // Fallback: if the template lost its brand.css link, inject before </head>.
    if (!html.includes("<style>")) html = html.replace("</head>", styleBlock + "\n</head>");

    await page.setContent(html, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);

    const outPath = path.join(OUT_DIR, doc.out);
    await page.pdf({
      path: outPath,
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<div></div>",
      footerTemplate: FOOTER,
      margin: { top: "14mm", bottom: "18mm", left: "15mm", right: "15mm" },
    });

    const bytes = fs.statSync(outPath).size;
    console.log(`✓ ${doc.out}  (${(bytes / 1024).toFixed(0)} KB)`);
  }

  await browser.close();
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
