/**
 * Dependency-free GPX parser for the OpenMannin map app.
 *
 * WHY NO DOMParser
 * ---------------
 * Tests run in Node without a DOM. A hand-rolled parser is ~1KB and
 * handles the subset of GPX 1.0/1.1 we need: wpts, trks, rtes, names,
 * elevations, timestamps, and the gpx root namespace.
 *
 * PARSING STRATEGY
 * ----------------
 * Regex-based block extraction, attribute-order-independent and
 * namespace-tolerant. We locate each container element (gpx, trk, trkseg,
 * rte, wpt, rtept, trkpt) and its body, then read coordinates from the
 * opening tag's attributes and text children from the body.
 *
 * HANDLED ELEMENTS
 * ----------------
 * <gpx> (root, may have namespace prefix)
 * <wpt lat="..." lon="..."> waypoint with optional name, ele, time
 * <rte> <rtept> route point (same structure as wpt)
 * <trk> <trkseg> <trkpt> track point (same structure)
 * <name>, <desc>, <cmt>, <sym>, <type> text content
 * <ele>, <time> numeric/ISO date text content
 */

const CDATA_RE = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
const ATTR_RE = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;

export interface GpxPoint {
  lat: number;
  lon: number;
  ele?: number | null;
  time?: string | null;
  name?: string | null;
}

export interface GpxTrackSegment {
  points: GpxPoint[];
}

export interface GpxTrack {
  name?: string | null;
  segments: GpxTrackSegment[];
}

export interface GpxRoute {
  name?: string | null;
  points: GpxPoint[];
}

export interface GpxData {
  version: string | null;
  creator?: string | null;
  tracks: GpxTrack[];
  routes: GpxRoute[];
  waypoints: GpxPoint[];
}

interface GpxBlock {
  /** The opening tag, including any attributes. */
  tag: string;
  /** Everything between the opening and closing tags (empty when self-closing). */
  body: string;
}

/** Read every attribute on an opening tag into a plain object. */
function parseAttrs(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of tag.matchAll(ATTR_RE)) {
    attrs[m[1]] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return attrs;
}

/** Unwrap CDATA sections and trim surrounding whitespace. */
function decodeText(raw: string): string {
  return raw.replace(CDATA_RE, "$1").trim();
}

/** First non-empty text child with any of the given names. */
function findText(block: string, names: string[]): string | null {
  for (const name of names) {
    const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}\\s*>`, "i"));
    if (m) return decodeText(m[1]);
  }
  return null;
}

/** Every `<name ...>` element (self-closing or paired), in document order. */
function findBlocks(xml: string, name: string): GpxBlock[] {
  const blocks: GpxBlock[] = [];
  const re = new RegExp(`<${name}(\\s[^>]*?)?(?:/>|>([\\s\\S]*?)</${name}\\s*>)`, "gi");
  for (const m of xml.matchAll(re)) {
    blocks.push({ tag: `<${name}${m[1] ?? ""}>`, body: m[2] ?? "" });
  }
  return blocks;
}

/** Build a point from a `<...pt>`/`<wpt>` opening tag and its body. */
function toPoint(block: GpxBlock): GpxPoint | null {
  const attrs = parseAttrs(block.tag);
  const lat = Number.parseFloat(attrs.lat ?? "");
  const lon = Number.parseFloat(attrs.lon ?? "");
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const point: GpxPoint = { lat, lon };
  const ele = findText(block.body, ["ele"]);
  if (ele !== null && ele !== "") {
    const n = Number.parseFloat(ele);
    if (Number.isFinite(n)) point.ele = n;
  }
  point.time = findText(block.body, ["time"]);
  point.name = findText(block.body, ["name"]);
  return point;
}

/** Parse GPX XML string. Returns null for non-gpx/empty/garbage input. */
export function parseGpx(xml: string): GpxData | null {
  if (!xml || xml.length < 3) return null;
  const trimmed = xml.trim();
  const lower = trimmed.toLowerCase();
  if (!lower.startsWith("<gpx") && !lower.startsWith("<gpx:")) return null;

  const rootTag = rootTagOf(trimmed);
  const rootAttrs = parseAttrs(rootTag);

  const data: GpxData = {
    version: rootAttrs.version ?? null,
    creator: rootAttrs.creator ?? null,
    tracks: [],
    routes: [],
    waypoints: [],
  };

  for (const block of findBlocks(trimmed, "wpt")) {
    const point = toPoint(block);
    if (point) data.waypoints.push(point);
  }

  for (const { body } of findBlocks(trimmed, "rte")) {
    const route: GpxRoute = { name: findText(body, ["name"]), points: [] };
    for (const pt of findBlocks(body, "rtept")) {
      const point = toPoint(pt);
      if (point) route.points.push(point);
    }
    data.routes.push(route);
  }

  for (const { body } of findBlocks(trimmed, "trk")) {
    const track: GpxTrack = { name: findText(body, ["name"]), segments: [] };
    for (const seg of findBlocks(body, "trkseg")) {
      const segment: GpxTrackSegment = { points: [] };
      for (const pt of findBlocks(seg.body, "trkpt")) {
        const point = toPoint(pt);
        if (point) segment.points.push(point);
      }
      track.segments.push(segment);
    }
    data.tracks.push(track);
  }

  return data;
}

/** The `<gpx ...>` opening tag's markup, with namespace prefixes tolerated. */
function rootTagOf(xml: string): string {
  const m = xml.match(/<gpx(?::[\w-]+)?\b[^>]*>/i);
  return m ? m[0] : "";
}
