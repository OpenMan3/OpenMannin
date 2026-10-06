/**
 * Response-type validation on the protobuf tile endpoints.
 *
 * WHY THIS EXISTS. MapLibre decodes two kinds of protobuf in the browser:
 * glyph PBFs (`/fonts/{fontstack}/{range}.pbf`) and vector tile PBFs
 * (`*.mvt` / `*.pbf`). Both are parsed with the `pbf` package, and `pbf`
 * throws "Given varint doesn't fit into 10 bytes" when the body is not
 * protobuf at all - e.g. an endpoint that returned a text error string, an
 * HTML error page, or a JSON error body. That exception is raised inside
 * the decoder loop, once per tile, and floods the console.
 *
 * The guard wraps `window.fetch`: for URLs that carry protobuf bodies it
 * checks the response's content type AND sniffs the first bytes. Anything
 * that looks like text is swapped for an empty, well-formed payload - which
 * parses as "no glyphs"/"no tile layers" - and one `console.warn` names the
 * offending URL. The decoder never sees the error text, so it has nothing
 * to crash on.
 *
 * Idempotent: call it as many times as you like. It replaces
 * `window.fetch` once and passes every non-protobuf URL straight through.
 */

let installed = false;

/** URLs whose responses are protobuf and therefore feed the decoder loop. */
export function isProtobufUrl(url: string): boolean {
  return /\.(pbf|mvt)(\?|#|$)/i.test(url) || /\/fonts\//i.test(url);
}

/**
 * True when the body cannot be protobuf: a text-like content type or an
 * HTML/JSON/XML-flavoured start to the payload. An empty body is valid -
 * an empty protobuf message parses to zero fields, which is exactly the
 * graceful case.
 */
export function bodyLooksLikeErrorText(contentType: string | null, head: Uint8Array): boolean {
  if (contentType) {
    const ct = contentType.toLowerCase();
    if (
      ct.includes("text/") ||
      ct.includes("json") ||
      ct.includes("xml") ||
      ct.includes("html")
    ) {
      return true;
    }
  }
  if (head.length >= 3) {
    // '<', '{', '[' - HTML, JSON, XML payloads almost never start with
    // anything else, and a protobuf tag byte is never one of these.
    if (head[0] === 0x3c || head[0] === 0x7b || head[0] === 0x5b) return true;
    // "Not Found", "Error ...", "Bad ..." style error strings.
    if (head[0] === 0x4e && head[1] === 0x6f && head[2] === 0x74) return true;
    if (head[0] === 0x45 && head[1] === 0x72 && head[2] === 0x72) return true;
    if (head[0] === 0x42 && head[1] === 0x61 && head[2] === 0x64) return true;
  }
  return false;
}

/** Decide whether a fetch response should be replaced before decoding. */
export function shouldReject(contentType: string | null, head: Uint8Array): boolean {
  return bodyLooksLikeErrorText(contentType, head);
}

export function installPbfGuard(): void {
  if (installed) return;
  if (typeof window === "undefined" || typeof window.fetch !== "function") return;
  installed = true;

  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!isProtobufUrl(url)) {
      return original(input as RequestInfo | URL, init);
    }

    const response = await original(input as RequestInfo | URL, init);
    const contentType = response.headers.get("content-type");

    let head = new Uint8Array(0);
    try {
      const buf = await response.clone().arrayBuffer();
      head = new Uint8Array(buf, 0, Math.min(8, buf.byteLength));
    } catch {
      // If the clone cannot be read, fall through and let the decoder try.
      return response;
    }

    if (!shouldReject(contentType, head)) {
      return response;
    }

    console.warn(
      `[pbf-guard] ${url} returned a non-protobuf body (content-type: ${contentType ?? "none"}); ` +
        "substituting an empty payload instead of feeding it to the tile decoder.",
    );
    return new Response(new Uint8Array(0), {
      status: 200,
      statusText: "OK",
      headers: { "Content-Type": "application/octet-stream" },
    });
  };
}
