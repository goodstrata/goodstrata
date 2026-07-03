/* goodstrata-www — static assets, plus real HTTP Range support for /clips/*.
   Workers static assets answer a Range request with a full-body 200 and no
   Accept-Ranges header; Safari/iOS treat that as a broken media server (WebKit
   demands 206s for <video>), so clips flickered then died with a MediaError.
   Only /clips/* is routed through this script (assets.run_worker_first);
   every other path is served straight from the asset store as before. */

const MEDIA_PREFIX = "/clips/";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (
      !url.pathname.startsWith(MEDIA_PREFIX) ||
      (request.method !== "GET" && request.method !== "HEAD")
    ) {
      return env.ASSETS.fetch(request);
    }

    // Fetch the underlying asset without the Range header (the asset store
    // ignores it anyway); slicing is done here.
    const res = await env.ASSETS.fetch(new Request(url, { method: "GET" }));
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
