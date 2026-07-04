import { secureHeaders } from "hono/secure-headers";

/**
 * Baseline security response headers for every route this app serves — the
 * JSON API, the MCP endpoints (mcp.goodstrata.com.au), and the built React SPA
 * + static assets (served by serveStatic in index.ts). One Hono app fronts
 * my.* / demo.* / mcp.*, so registering this first in createApp covers them all.
 *
 * Built on Hono's `secureHeaders`. We keep its safe defaults (X-Content-Type-
 * Options: nosniff, X-DNS-Prefetch-Control: off, Cross-Origin-Opener-Policy:
 * same-origin, Origin-Agent-Cluster, removePoweredBy, X-XSS-Protection: 0) and
 * override the few we want stricter/looser than the defaults.
 *
 * CSP is shipped **report-only** on purpose. The SPA pulls everything from its
 * own origin (self-hosted @fontsource fonts, same-origin /api + SSE, no external
 * scripts/images), and video opens Daily in a new tab rather than an iframe, so
 * the policy below is what we expect to enforce. But next-themes injects a tiny
 * pre-hydration inline <script> (harmless if blocked) and we can't observe the
 * production bundle under this policy from here — so we stage it as report-only
 * to guarantee zero go-live breakage. Promote to enforcing by renaming
 * `contentSecurityPolicyReportOnly` → `contentSecurityPolicy` once the browser
 * console shows no violations against a real session. Clickjacking is already
 * enforced today via X-Frame-Options: DENY (below), independent of CSP.
 */
export function securityHeaders() {
  return secureHeaders({
    // 1 year + includeSubDomains + preload. `preload` is a hard-to-reverse
    // commitment that every *.goodstrata.com.au host stays HTTPS-only — that is
    // already true here (all hosts are Cloudflare-fronted HTTPS). Submit the
    // apex to hstspreload.org to complete enrolment. Browsers ignore HSTS over
    // plain http, so local dev is unaffected.
    strictTransportSecurity: "max-age=31536000; includeSubDomains; preload",
    // The app never legitimately renders inside a frame. DENY beats the
    // SAMEORIGIN default; CSP frame-ancestors 'none' below mirrors it.
    xFrameOptions: "DENY",
    // Send origin (not full path/query) cross-origin; full URL same-origin.
    referrerPolicy: "strict-origin-when-cross-origin",
    // Same-site (not same-origin) so the marketing site's cross-subdomain
    // estimator call and any future goodstrata.com.au ↔ my.goodstrata.com.au
    // subresource sharing keep working; still blocks cross-*site* embedding.
    crossOriginResourcePolicy: "same-site",
    // Deny powerful features the first-party page never uses. (Committee video
    // runs on daily.co in a separate tab, so the app origin needs no camera/mic.)
    permissionsPolicy: {
      accelerometer: [],
      autoplay: [],
      camera: [],
      geolocation: [],
      gyroscope: [],
      magnetometer: [],
      microphone: [],
      payment: [],
      usb: [],
      bluetooth: [],
      midi: [],
      serial: [],
    },
    contentSecurityPolicyReportOnly: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      // Bundled JS only. No 'unsafe-inline'/'unsafe-eval' — the Vite prod build
      // emits external module scripts; the sole inline script (next-themes) is
      // redundant client-side and safe to have blocked.
      scriptSrc: ["'self'"],
      // Radix UI and next-themes' transition guard set inline style attributes,
      // and Tailwind's stylesheet is same-origin. Inline styles are low-risk.
      styleSrc: ["'self'", "'unsafe-inline'"],
      // Self-hosted @fontsource woff2 (bundled to /assets); data: for any inlined.
      fontSrc: ["'self'", "data:"],
      // blob: for the document viewer (PDF iframe / <img>) and avatar previews;
      // data: for inline icons.
      imgSrc: ["'self'", "data:", "blob:"],
      // Same-origin /api, /webhooks and the SSE stream. No cross-origin XHR.
      connectSrc: ["'self'"],
      // PDF previews render a blob: URL in an <iframe>.
      frameSrc: ["'self'", "blob:"],
      workerSrc: ["'self'", "blob:"],
      manifestSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: [],
    },
  });
}
