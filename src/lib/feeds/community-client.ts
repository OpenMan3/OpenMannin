/**
 * Community intelligence feed: recent OpenStreetMap edits inside the island.
 *
 * WHY OSM RATHER THAN A NEWS WIRE. Every news feed we checked is either behind
 * a WAF (gov.im, Manx Utilities — "Request Rejected") or published under NO
 * licence (Manx Radio). The only genuinely open, continuously updated,
 * island-scoped signal we could find is the crowd's own editing activity on
 * OpenStreetMap, which is public under the ODbL and CORS-free via Overpass.
 *
 * WHAT IT IS. The last N OSM edits (nodes and ways) inside the IoM bounding
 * box, newest first. Each row is the editor, the object type + id, the
 * top tags and the wall-clock time in the island's timezone, with a link onto
 * OpenStreetMap. It is claimed in the UI as "what the crowd changed recently",
 * never as news.
 *
 * WHAT IT IS NOT. A verified change set — edits can vandalise, and an edit
 * shown here is a claim about map activity, not about the ground. No official
 * "community notice board" feed exists for this island; the gap is documented.
 */

const OVERPASS_EP = "https://overpass-api.de/api/interpreter";
/** Fallback when the main mirror is overloaded. */
const OVERPASS_ALT = "https://maps.mail.ru/osm/tools/overpass/api/interpreter";

const BBOX = "54.02,-4.85,54.45,-4.30";
/** How far back to ask Overpass for fresh edits. */
const WINDOW_HOURS = 24;
/** Refresh cadence in the UI. Edits are not trading data. */
export const COMMUNITY_POLL_MS = 5 * 60_000;
const MAX_ROWS = 60;

export interface CommunityItem {
  /** "node 123456" / "way 987654" */
  ref: string;
  user: string;
  /** First useful tag pair: name, else highway/amenity/tourism, else osm_changeset short id. */
  headline: string;
  timestamp: string;
  /** Europe/London wall clock, for the terminal log. */
  stamp: string | null;
  url: string;
}

export interface CommunityResult {
  items: CommunityItem[];
  feedTitle: string | null;
  fetchedAt: string;
  failure: string | null;
}

const wallClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function stampOf(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return wallClock.format(d);
}

function headlineOf(tags: Record<string, string> | undefined): string {
  const t = tags ?? {};
  const keys = ["name", "name:en", "highway", "amenity", "tourism", "place", "shop", "landuse"];
  for (const k of keys) {
    if (t[k]) return `${k}=${t[k]}`;
  }
  return t["osm_type"] ? `osm_type=${t["osm_type"]}` : "unnamed edit";
}

export async function fetchCommunity(): Promise<CommunityResult> {
  const fetchedAt = new Date().toISOString();
  const since = new Date(Date.now() - WINDOW_HOURS * 3600_000)
    .toISOString()
    .replace(/\.\d+Z$/, "Z");
  const q = `[out:json][timeout:25];
(
  node(newer:"${since}")(${BBOX});
  way(newer:"${since}")(${BBOX});
);
out meta;`;

  const ep = `${OVERPASS_EP}?data=${encodeURIComponent(q)}`;
  try {
    let el: { elements?: unknown[] } = { elements: [] };
    for (const url of [ep, `${OVERPASS_ALT}?data=${encodeURIComponent(q)}`]) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
        if (!res.ok) continue;
        el = (await res.json()) as { elements?: unknown[] };
        break;
      } catch {
        continue;
      }
    }
    const items: CommunityItem[] = [];
    for (const elx of (el.elements as Array<Record<string, unknown>>) ?? []) {
      const tags = elx.tags as Record<string, string> | undefined;
      const ts = typeof elx.timestamp === "string" ? elx.timestamp : null;
      if (!ts) continue;
      items.push({
        ref: `${elx.type} ${elx.id}`,
        user: typeof elx.user === "string" ? elx.user : "anonymous",
        headline: headlineOf(tags),
        timestamp: ts,
        stamp: stampOf(ts),
        url: `https://www.openstreetmap.org/${elx.type}/${elx.id}`,
      });
    }
    items.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
    return {
      items: items.slice(0, MAX_ROWS),
      feedTitle: `OpenStreetMap edits · Isle of Man · last ${WINDOW_HOURS} h`,
      fetchedAt,
      failure: items.length ? null : "no edits in window (or Overpass unreachable)",
    };
  } catch (e) {
    return {
      items: [],
      feedTitle: null,
      fetchedAt,
      failure: (e as Error).message,
    };
  }
}
