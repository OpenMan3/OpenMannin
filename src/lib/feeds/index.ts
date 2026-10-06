/**
 * One entry point the map polls, so the map does not care where a feed runs.
 *
 * Two feeds work from the browser, because their upstreams send
 * `Access-Control-Allow-Origin: *` and need no credential: weather (Open-Meteo)
 * and satellite passes (CelesTrak TLEs + SGP4 in a worker).
 *
 * Three cannot, and this deployment has no server to help: OpenSky pins CORS to
 * its own origin, AISStream needs a key that must not be published, and
 * FindMyBus sends no CORS header at all. They are blocked on their terms as much
 * as on the missing server - see SERVER_SIDE_FEEDS below - so the map asks for a
 * FeatureCollection by layer id and gets either one or a typed failure saying
 * exactly why not.
 *
 * THE SHAPE OF A FAILURE IS DELIBERATE. `not-enabled` is a CONFIGURATION state,
 * not a fault: a feed whose permission has not been granted is refusing to run
 * in exactly the way it is designed to. The layer panel badges it, and the map
 * deliberately does not console-warn about it, because warning on a deploy that
 * is working as designed drowns the warnings that matter.
 */

import { fetchPasses } from "./passes-client.ts";
import { fetchWeather } from "./weather-client.ts";

export interface FeedOk {
  ok: true;
  fc: unknown;
  /** Served from a cache because the network call failed. */
  stale?: boolean;
}

export interface FeedErr {
  ok: false;
  status: number;
  error: string;
  reason: string;
}

export type FeedResult = FeedOk | FeedErr;

function err(status: number, error: string, reason: string): FeedErr {
  return { ok: false, status, error, reason };
}

/**
 * Which feeds run in the browser.
 *
 * This host is static. There is no server at all - Cloudflare Pages serves the
 * export directly - so a feed either works from the browser or is not shown. Kept
 * as an explicit allowlist so that adding a server-backed feed here fails loudly
 * at the point of the mistake rather than becoming a 404 nobody can see.
 */
const CLIENT_FEEDS: Record<string, () => Promise<{ fc?: unknown; failure?: { error: string; reason: string }; stale?: boolean }>> = {
  weather: fetchWeather,
  "satellite-passes": () => fetchPasses("spaceman"),
};

/** One line saying which, so the reason is legible where it is displayed. */
const NEEDS_A_SERVER =
  "This layer needs a server that this deployment does not have. Cloudflare Pages " +
  "serves a static export only, so there is nowhere for the request to go. The data " +
  "is available from a static build (see scripts/ingest-*.mjs) if you would rather " +
  "bake it than fetch it live.";

/**
 * Feeds that need a server, and therefore cannot work here.
 *
 * Cloudflare Pages serves a static export. There is no runtime to proxy these
 * requests to, and three of them have no licence permitting redistribution in
 * any case, so they are not being quietly broken by a missing deployment - they
 * are unavailable on purpose. As of 2026-10-06 they are ALSO on hold: a data
 * agreement has not been secured, so the fetchers are stubbed out and no
 * polling runs even if someone grants a permission flag.
 *
 * The layer panel reads this to explain that, which is far more useful than the
 * bare 404 a static host would otherwise produce.
 */
export const SERVER_SIDE_FEEDS: Record<string, string> = {
  "live-flights": "OpenSky requires a registered account and a written data-use agreement. It cannot be called from a browser, and it is not licensed for redistribution. Nothing here needs a server to work.",
  "live-vessels": "AISStream requires an API key and publishes no licence granting redistribution. A short-lived WebSocket cannot be held open from a static page either.",
  "live-transit": "The Isle of Man's FindMyBus API carries no stated terms and cannot be called cross-origin, so there is no permission to rely on and no way to reach it from a browser.",
};

/** The three server feeds are cleanly on hold, with polling fully disabled. */
export const FEEDS_ON_HOLD: ReadonlySet<string> = new Set(Object.keys(SERVER_SIDE_FEEDS));

/** One constant reason, so the badge text and the typed failure agree. */
export const ON_HOLD_REASON =
  "On hold pending a secured data-use agreement. No requests are made and no polling runs until then.";

export async function fetchFeed(layerId: string): Promise<FeedResult> {
  const client = CLIENT_FEEDS[layerId];
  if (client) {
    const r = await client();
    if (r.failure) {
      // 502, not 503: the feed is enabled and permitted, and upstream let us down.
      return err(502, r.failure.error, r.failure.reason);
    }
    if (!r.fc) return err(502, "empty-response", "the feed returned no collection");
    return { ok: true, fc: r.fc, stale: r.stale };
  }

  // On-hold feeds are stubbed out, not merely missing: they return the
  // configuration-state failure (so no console warning fires anywhere) and the
  // map never starts a poller for them. `not-enabled` marks "refusing to run
  // by design", which is exactly what on hold means.
  if (FEEDS_ON_HOLD.has(layerId)) {
    return err(503, "not-enabled", `${ON_HOLD_REASON} ${SERVER_SIDE_FEEDS[layerId]}`);
  }

  // Not a client feed, so it needs a server. This deployment has none.
  return err(
    501,
    "no-server",
    SERVER_SIDE_FEEDS[layerId] ?? NEEDS_A_SERVER,
  );
}

