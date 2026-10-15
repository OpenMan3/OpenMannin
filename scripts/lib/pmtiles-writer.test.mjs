/**
 * PMTiles writer regression tests.
 *
 * Run with: node --test scripts/lib/pmtiles-writer.test.mjs
 *
 * The bug this pins down: a root directory is fetched by the JS reader in a
 * single 16 KiB request, so a layer with enough tiles to push the root over
 * that limit fails to load at all ("Failed to fetch" from MapLibre, with no
 * clue that the archive is the problem). The writer splits tiles into leaf
 * directories to keep the root tiny. The first cut of that split assigned
 * every leaf the same offset, so only the first leaf was ever reachable and
 * every tile in a later leaf decompressed garbage. These tests exercise the
 * multi-leaf path directly, because a two-tile archive only ever has one leaf
 * and passes either way.
 */

import test from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { PMTiles, zxyToTileId } from "pmtiles";
import { buildPmtiles } from "./pmtiles-writer.mjs";

function readVarint(buf, state) {
  let value = 0;
  let shift = 0;
  let p = state.p;
  for (;;) {
    const byte = buf[p++];
    value += (byte & 0x7f) * 2 ** shift;
    if (byte < 0x80) break;
    shift += 7;
  }
  state.p = p;
  return value;
}

function parseDirectory(buf) {
  const state = { p: 0 };
  const count = readVarint(buf, state);
  const entries = [];
  let lastTileId = 0;
  for (let i = 0; i < count; i++) {
    lastTileId += readVarint(buf, state);
    entries.push({ tileId: lastTileId, offset: 0, length: 0, runLength: 1 });
  }
  for (let i = 0; i < count; i++) entries[i].runLength = readVarint(buf, state);
  for (let i = 0; i < count; i++) entries[i].length = readVarint(buf, state);
  for (let i = 0; i < count; i++) {
    const stored = readVarint(buf, state);
    entries[i].offset = stored === 0 && i > 0 ? entries[i - 1].offset + entries[i - 1].length : stored - 1;
  }
  return entries;
}

function toArrayBufferSource(bytes) {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return {
    getKey: () => "test",
    getBytes: async (offset, length) => ({ data: buffer.slice(offset, offset + length) }),
  };
}

function makeTiles(count) {
  const tiles = [];
  const zoom = 6;
  const rc = 2 ** zoom;
  let id = 0;
  for (let y = 0; y < rc && tiles.length < count; y++) {
    for (let x = 0; x < rc && tiles.length < count; x++) {
      tiles.push({
        tileId: zxyToTileId(zoom, x, y),
        z: zoom,
        x,
        y,
        data: new Uint8Array([id & 0xff, (id >> 8) & 0xff, 1, 2, 3, 4]),
      });
      id++;
    }
  }
  return { tiles, zoom };
}

test("multi-leaf archives give every leaf a distinct root offset", () => {
  const { tiles, zoom } = makeTiles(2500);
  const archive = buildPmtiles({
    tiles,
    metadata: { vector_layers: [{ id: "test", fields: {} }] },
    minZoom: zoom,
    maxZoom: zoom,
    bounds: [-180, -85, 180, 85],
    center: [0, 0, zoom],
  });
  const readU64 = (o) => Number(archive.readBigUInt64LE(o));
  const root = parseDirectory(zlib.gunzipSync(archive.subarray(readU64(8), readU64(8) + readU64(16))));

  assert.ok(root.length > 1, "2500 tiles should span multiple leaves");
  assert.equal(root[0].offset, 0);
  const offsets = root.map((e) => e.offset);
  assert.equal(new Set(offsets).size, offsets.length, "leaf offsets must be unique");
  for (let i = 1; i < root.length; i++) {
    assert.ok(root[i].offset > root[i - 1].offset, "leaf offsets must increase");
  }
});

test("every tile in a multi-leaf archive round-trips through the reader", async () => {
  const { tiles, zoom } = makeTiles(2500);
  const archive = buildPmtiles({
    tiles,
    metadata: { vector_layers: [{ id: "test", fields: {} }] },
    minZoom: zoom,
    maxZoom: zoom,
    bounds: [-180, -85, 180, 85],
    center: [0, 0, zoom],
  });
  const reader = new PMTiles(toArrayBufferSource(archive));

  for (const tile of tiles) {
    const got = await reader.getZxy(tile.z, tile.x, tile.y);
    assert.ok(got, `tile ${tile.z}/${tile.x}/${tile.y} missing`);
    assert.deepEqual(
      Array.from(new Uint8Array(got.data)),
      Array.from(tile.data),
      `tile ${tile.z}/${tile.x}/${tile.y} payload mismatch`,
    );
  }

  const meta = await reader.getMetadata();
  assert.equal(meta.vector_layers[0].id, "test");
});

test("small archives still round-trip through the reader", async () => {
  const tiles = [{ tileId: zxyToTileId(4, 3, 5), z: 4, x: 3, y: 5, data: new Uint8Array([9, 8, 7]) }];
  const archive = buildPmtiles({
    tiles,
    metadata: { vector_layers: [{ id: "small", fields: {} }] },
    minZoom: 4,
    maxZoom: 4,
    bounds: [-180, -85, 180, 85],
    center: [0, 0, 4],
  });
  const reader = new PMTiles(toArrayBufferSource(archive));
  const got = await reader.getZxy(4, 3, 5);
  assert.ok(got);
  assert.equal(new Uint8Array(got.data).length, 3);
});
