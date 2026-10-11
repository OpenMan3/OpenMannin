/**
 * Tests for the protobuf response guard.
 *
 * The guard exists because MapLibre's decoder loop parses protobuf with the
 * `pbf` package, which throws "Given varint doesn't fit into 10 bytes" when
 * an endpoint hands it an error string, an HTML page, or a JSON body. The
 * warning path in MapView feeds the classifier in src/lib/pbf-guard.ts; if a
 * text body ever gets THROUGH that check, the decoder floods again.
 *
 * Convention: each test FAILS when the guard is removed or weakened.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  isProtobufUrl,
  bodyLooksLikeErrorText,
  shouldReject,
} from "../../src/lib/pbf-guard.ts";

const enc = (s) => new TextEncoder().encode(s);

test("glyph, vector-tile and font URLs are classified as protobuf", () => {
  assert.ok(isProtobufUrl("https://tiles.basemaps.cartocdn.com/fonts/Noto%20Sans%20Regular/0-255.pbf"));
  assert.ok(isProtobufUrl("https://example.com/tiles/{z}/{x}/{y}.mvt"));
  assert.ok(isProtobufUrl("https://example.com/fonts/Open%20Sans%20Bold/0-255.pbf?x=1"));
  assert.ok(isProtobufUrl("https://example.com/v1/fonts/X/0-255.pbf"));
});

test("non-protobuf URLs are passed through untouched", () => {
  assert.ok(!isProtobufUrl("https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle"));
  assert.ok(!isProtobufUrl("https://a.tile.opentopomap.org/12/2000/1300.png"));
  assert.ok(!isProtobufUrl("/data/manifest.json"));
});

test("an HTML error page is recognised as an error text", () => {
  assert.ok(bodyLooksLikeErrorText("text/html; charset=utf-8", enc("<!DOCTYPE html>")));
  assert.ok(bodyLooksLikeErrorText(null, enc("<html>")));
});

test("JSON and XML error bodies are recognised", () => {
  assert.ok(bodyLooksLikeErrorText("application/json", enc('{"error":"quota"}')));
  assert.ok(bodyLooksLikeErrorText(null, enc("{\"error\":")));
  assert.ok(bodyLooksLikeErrorText("application/xml", enc("<?xml version=\"1.0\"?>")));
  assert.ok(bodyLooksLikeErrorText(null, enc("[{\"x\":1}]")));
});

test("common upstream error strings are recognised even without a content type", () => {
  assert.ok(bodyLooksLikeErrorText(null, enc("Not Found")));
  assert.ok(bodyLooksLikeErrorText(null, enc("Error: upstream unavailable")));
  assert.ok(bodyLooksLikeErrorText(null, enc("Bad Gateway")));
});

test("a protobuf content type is trusted", () => {
  assert.ok(!shouldReject("application/x-protobuf-gzipped", new Uint8Array([0x1f, 0x8b, 0x08])));
  assert.ok(!shouldReject("application/octet-stream", new Uint8Array([0x0a, 0x12, 0x99])));
});

test("an empty body is allowed through, because an empty message is valid protobuf", () => {
  assert.ok(!shouldReject("application/x-protobuf-gzipped", new Uint8Array(0)));
  assert.ok(!shouldReject(null, new Uint8Array(0)));
});

test("a glyph PBF body sniff is not mistaken for error text", () => {
  // Fontstacks PBF starts with a field tag (0x0A = field 1, LEN), then the
  // UTF-8 name. It must NOT be rejected, or every label silently disappears.
  const sample = new Uint8Array([0x0a, 0x10, ...enc("Noto Sans Regular")]);
  assert.ok(!shouldReject("application/x-protobuf-gzipped", sample));
});
