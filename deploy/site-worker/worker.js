/* goodstrata-www — canonical host redirects, static assets, and real HTTP
   Range support for /clips/*. Every request reaches this script so alternate
   hosts and plaintext URLs consolidate in one hop before asset handling.
   Workers static assets answer a Range request with a full-body 200 and no
   Accept-Ranges header; Safari/iOS treat that as a broken media server (WebKit
   demands 206s for <video>), so clips still need the dedicated slicing path. */

const MEDIA_PREFIX = "/clips/";

// `wrangler dev` serves over plaintext http on loopback, so an unconditional
// https upgrade turns every local request into a redirect to itself — the dev
// proxy rewrites a Location pointing back at the dev server to http, and the
// loop never terminates. Production traffic never has these hostnames.
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function makeAssetRedirectPermanent(response) {
  if (response.status !== 307 && response.status !== 308) return response;

  // The asset store must remain authoritative about which HTML paths need
  // normalising, but temporary redirects leave both URL shapes crawlable.
  return new Response(response.body, {
    status: 301,
    statusText: "Moved Permanently",
    headers: response.headers,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Consolidate scheme and hostname together so plaintext www requests do
    // not burn crawl budget on a two-hop path to the only canonical origin.
    let mustRedirect = false;
    if (url.hostname === "www.goodstrata.com.au") {
      url.hostname = "goodstrata.com.au";
      mustRedirect = true;
    }
    if (url.protocol === "http:" && !LOOPBACK_HOSTS.has(url.hostname)) {
      url.protocol = "https:";
      mustRedirect = true;
    }
    if (mustRedirect) return Response.redirect(url.toString(), 301);

    // The /tools page was retired. It was indexed on www, so send its old URL
    // to the homepage with a 301 rather than leaving a 404 in the index.
    if (url.pathname === "/tools" || url.pathname === "/tools/") {
      url.pathname = "/";
      return Response.redirect(url.toString(), 301);
    }

    if (
      !url.pathname.startsWith(MEDIA_PREFIX) ||
      (request.method !== "GET" && request.method !== "HEAD")
    ) {
      const response = await env.ASSETS.fetch(request);
      return makeAssetRedirectPermanent(response);
    }

    // Fetch the underlying asset without the Range header (the asset store
    // ignores it anyway); slicing is done here.
    const res = makeAssetRedirectPermanent(
      await env.ASSETS.fetch(new Request(url, { method: "GET" })),
    );
    if (!res.ok) return res;

    const passthrough = () => {
      const headers = new Headers(res.headers);
      headers.set("Accept-Ranges", "bytes");
      return headers;
    };

    if (request.method === "HEAD") {
      return new Response(null, { status: 200, headers: passthrough() });
    }

    const range = request.headers.get("Range");
    if (!range) {
      // Full response, but advertise range support so WebKit trusts the host.
      return new Response(res.body, { status: 200, headers: passthrough() });
    }

    const buf = await res.arrayBuffer();
    const total = buf.byteLength;

    // bytes=a-b | bytes=a- | bytes=-n  (multi-range is never sent by <video>)
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    let start;
    let end;
    if (m && (m[1] !== "" || m[2] !== "")) {
      if (m[1] === "") {
        start = Math.max(0, total - Number(m[2])); // suffix: last n bytes
        end = total - 1;
      } else {
        start = Number(m[1]);
        end = m[2] === "" ? total - 1 : Math.min(Number(m[2]), total - 1);
      }
    }

    const baseHeaders = () => {
      const h = passthrough();
      h.delete("Content-Length");
      return h;
    };

    if (
      start === undefined ||
      Number.isNaN(start) ||
      Number.isNaN(end) ||
      start > end ||
      start >= total
    ) {
      const h = baseHeaders();
      h.set("Content-Range", `bytes */${total}`);
      return new Response(null, { status: 416, headers: h });
    }

    const body = buf.slice(start, end + 1);
    const h = baseHeaders();
    h.set("Content-Range", `bytes ${start}-${end}/${total}`);
    h.set("Content-Length", String(body.byteLength));
    return new Response(body, { status: 206, headers: h });
  },
};
