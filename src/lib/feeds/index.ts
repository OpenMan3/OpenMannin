/**
 * One entry point the map polls, so the map does not care where a feed runs.
 *
 * Both live feeds run in the browser because their upstreams send
 * `Access-Control-Allow-Origin: *`, need no credential, and are published
 * under an open licence (Cc-BY / public domain): weather (Open-Meteo) and
 * satellite passes (CelesTrak TLEs + SGP4 in a worker).
 *
 * Everything else on a static host has nowhere to go: there is no server to
 * hold a credential or to hold open a socket. The failure shape is
 * deliberately typed (`not-enabled`/`no-server`) rather than silence, so the
 * layer panel badges the feed and the map starts no poller for it.
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
 * Kept as an explicit allowlist so that adding a server-backed feed here
 * fails loudly at the point of the mistake rather than becoming a 404 nobody
 * can see.
 */
const CLIENT_FEEDS: Record<
  string,
  () => Promise<{
    fc?: unknown;
    failure?: { error: string; reason: string };
    stale?: boolean;
  }>
> = {
  weather: fetchWeather,
  "satellite-passes": () => fetchPasses("spaceman"),
};

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

  return err(
    501,
    "no-server",
    `"${layerId}" is not a client-side feed and this deployment has no server for it.`,
  );
}
