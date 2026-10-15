/**
 * Minimal PMTiles v3 writer.
 *
 * The JS tooling ships a reader and protocol but no writer, and tippecanoe is
 * not available in this environment. This writes PMTiles with:
 *   - a root directory containing one entry per leaf directory (runLength 0), so
 *     the root stays small enough for the reader's 16 KiB header fetch; and
 *   - one leaf directory per chunk of tiles. The 16 KiB limit is what breaks a
 *     single large root directory, so chunking is required for wide layers.
 * gzip internal + tile compression, MVT payloads. Read back by the `pmtiles`
 * package's own PMTiles/Protocol classes.
 */

import { gzipSync } from "node:zlib";

export const TILE_TYPE_MVT = 1;
export const COMPRESSION_GZIP = 2;

function writeVarint(value) {
  const bytes = [];
  let v = value;
  while (v >= 0x80) {
    bytes.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  bytes.push(v);
  return Buffer.from(bytes);
}

function writeUInt64(buf, offset, value) {
  buf.writeBigUInt64LE(BigInt(value), offset);
}

function writeInt32(buf, offset, value) {
  buf.writeInt32LE(value, offset);
}

/**
 * Serialise a directory. Entries must be sorted by tileId. Offsets are
 * absolute within the relevant section; the spec stores offset+1 so 0 can
 * mean "contiguous with the previous entry".
 */
function serializeDirectory(entries) {
  const parts = [];
  parts.push(writeVarint(entries.length));
  let lastTileId = 0;
  for (const entry of entries) {
    parts.push(writeVarint(entry.tileId - lastTileId));
    lastTileId = entry.tileId;
  }
  for (const entry of entries) parts.push(writeVarint(entry.runLength));
  for (const entry of entries) parts.push(writeVarint(entry.length));
  for (const entry of entries) parts.push(writeVarint(entry.offset + 1));
  return gzipSync(Buffer.concat(parts));
}

function makeLeafEntries(tiles) {
  return tiles.map((t) => ({
    tileId: t.tileId,
    offset: t.offset,
    length: t.length,
    runLength: 1,
  }));
}

/**
 * @param {object} opts
 * @param {Array<{tileId:number, z:number, x:number, y:number, data:Uint8Array}>} opts.tiles
 * @param {object} opts.metadata JSON metadata, including vector_layers
 * @param {number} opts.minZoom
 * @param {number} opts.maxZoom
 * @param {[number,number,number,number]} opts.bounds [minLon,minLat,maxLon,maxLat]
 * @param {[number,number,number]} opts.center [lon,lat,zoom]
 */
export function buildPmtiles({ tiles, metadata, minZoom, maxZoom, bounds, center }) {
  const sorted = [...tiles].sort((a, b) => a.tileId - b.tileId);

  const tileParts = [];
  let cursor = 0;
  for (const tile of sorted) {
    const gz = gzipSync(Buffer.from(tile.data));
    tile.offset = cursor;
    tile.length = gz.length;
    tileParts.push(gz);
    cursor += gz.length;
  }
  const tileData = Buffer.concat(tileParts);

  const CHUNK = 1024;
  const leafDirs = [];
  for (let i = 0; i < sorted.length; i += CHUNK) {
    const chunk = sorted.slice(i, i + CHUNK);
    const leafEntries = makeLeafEntries(chunk);
    const leafData = serializeDirectory(leafEntries);
    leafDirs.push({ firstTileId: chunk[0].tileId, data: leafData });
  }

  let leafCursor = 0;
  const rootEntries = leafDirs.map((d) => {
    const entry = {
      tileId: d.firstTileId,
      runLength: 0,
      length: d.data.length,
      offset: leafCursor,
    };
    leafCursor += d.data.length;
    return entry;
  });
  const leafBytes = Buffer.concat(leafDirs.map((d) => d.data));

  const rootDirectory = serializeDirectory(rootEntries);
  const jsonMetadata = gzipSync(Buffer.from(JSON.stringify(metadata), "utf8"));

  const header = Buffer.alloc(127);
  header.write("PMTiles", 0, "latin1");
  header.writeUInt8(3, 7);

  // Layout: header | root | leaf directories | json metadata | tile data.
  const rootDirectoryOffset = 127;
  const rootDirectoryLength = rootDirectory.length;
  const leafDirectoryOffset = rootDirectoryOffset + rootDirectoryLength;
  const leafDirectoryLength = leafBytes.length;
  const jsonMetadataOffset = leafDirectoryOffset + leafDirectoryLength;
  const jsonMetadataLength = jsonMetadata.length;
  const tileDataOffset = jsonMetadataOffset + jsonMetadataLength;

  writeUInt64(header, 8, rootDirectoryOffset);
  writeUInt64(header, 16, rootDirectoryLength);
  writeUInt64(header, 24, jsonMetadataOffset);
  writeUInt64(header, 32, jsonMetadataLength);
  writeUInt64(header, 40, leafDirectoryOffset);
  writeUInt64(header, 48, leafDirectoryLength);
  writeUInt64(header, 56, tileDataOffset);
  writeUInt64(header, 64, tileData.length);
  writeUInt64(header, 72, sorted.length);
  writeUInt64(header, 80, sorted.length);
  writeUInt64(header, 88, sorted.length);
  header.writeUInt8(1, 96); // clustered
  header.writeUInt8(COMPRESSION_GZIP, 97);
  header.writeUInt8(COMPRESSION_GZIP, 98);
  header.writeUInt8(TILE_TYPE_MVT, 99);
  header.writeUInt8(minZoom, 100);
  header.writeUInt8(maxZoom, 101);
  writeInt32(header, 102, Math.round(bounds[0] * 1e7));
  writeInt32(header, 106, Math.round(bounds[1] * 1e7));
  writeInt32(header, 110, Math.round(bounds[2] * 1e7));
  writeInt32(header, 114, Math.round(bounds[3] * 1e7));
  header.writeUInt8(Math.round(center[2]), 118);
  writeInt32(header, 119, Math.round(center[0] * 1e7));
  writeInt32(header, 123, Math.round(center[1] * 1e7));

  return Buffer.concat([header, rootDirectory, leafBytes, jsonMetadata, tileData]);
}
