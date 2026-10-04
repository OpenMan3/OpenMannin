/**
 * Minimal PNG decoder, enough to answer "is this screenshot blank?".
 *
 * Chromium's WebGL canvas cannot be verified with gl.readPixels() once the
 * frame has been composited (preserveDrawingBuffer defaults to false, so the
 * back buffer is undefined at that point). The screenshot is the only
 * trustworthy record of what was actually painted, so this decodes it.
 *
 * Supports the 8-bit RGB/RGBA non-interlaced output Chromium produces.
 */

import zlib from "node:zlib";

export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");

  let pos = 8;
  let width = 0, height = 0, bitDepth = 0, colourType = 0, interlace = 0;
  const idat = [];

  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);

    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      bitDepth = body[8];
      colourType = body[9];
      interlace = body[12];
    } else if (type === "IDAT") {
      idat.push(body);
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + len;
  }

  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
  if (interlace !== 0) throw new Error("interlaced PNG unsupported");
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colourType];
  if (!channels) throw new Error(`unsupported colour type ${colourType}`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);

  // Undo the per-scanline filters (PNG spec 9.2).
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = out.subarray(y * stride, y * stride + stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;

    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      switch (filter) {
        case 0: break;
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
        default: throw new Error(`bad filter ${filter} on row ${y}`);
      }
      cur[x] = v & 0xff;
    }
  }

  return { width, height, channels, data: out };
}

/** Summarise an image: unique colour count and how much is not the backdrop. */
export function analyse(img, { sample = 3 } = {}) {
  const { width, height, channels, data } = img;
  const colours = new Set();
  let lit = 0, total = 0;
  // The page backdrop is #0b0f14. Count anything meaningfully brighter.
  for (let y = 0; y < height; y += sample) {
    for (let x = 0; x < width; x += sample) {
      const i = (y * width + x) * channels;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      colours.add(((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3));
      total++;
      if (r + g + b > 90) lit++;
    }
  }
  return { width, height, distinctColours: colours.size, litFraction: lit / total, samples: total };
}