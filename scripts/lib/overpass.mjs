/**
 * Shared Overpass helper for the OpenMannin OSM ingest scripts.
 *
 * OpenMannin does not consume any non-open IoM Government map service. All
 * island-wide vector coverage is built from OpenStreetMap under the ODbL, so
 * this helper exists to query Overpass politely and fail loudly:
 *
 *   - it tries several public mirrors in turn, because overpass-api.de is
 *     routinely overloaded and the mail.ru mirror has historically been the
 *     only continuously reachable one from some networks;
 *   - an empty answer is treated as a failure, not as "the island has none",
 *     because a dataset that legitimately returns zero features is a registry
 *     error we want to see, not an empty layer shipped silently;
 *   - it sends a plain identifying User-Agent, since Overpass answers HTTP 406
 *     to the browser-shaped UA the shared get() helper sends to get past the
 *     gov.im F5 WAF.
 */

import { UA, get, sleep } from "./fetch.mjs";

const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

/** The Isle of Man bounding box: south, west, north, east. */
export const IOM_BBOX = "54.02,-4.85,54.45,-4.30";

export async function overpass(query, label, { allowEmpty = false } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const ep of OVERPASS) {
      try {
        const res = await get(ep, {
          method: "POST",
          headers: {
            "User-Agent": UA,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ data: query }).toString(),
          timeoutMs: 180_000,
          retries: 0,
        });
        const json = await res.json();
        if ((json.elements ?? []).length > 0 || allowEmpty) return json;
        lastErr = new Error(`empty response for ${label} from ${ep}`);
        console.log(`  ${label}: empty response from ${ep}, trying next mirror`);
      } catch (err) {
        lastErr = err;
        console.log(`  ${label}: ${ep} failed (${err.message.slice(0, 80)}), trying next mirror`);
      }
    }
    console.log(`  ${label}: attempt ${attempt + 1} exhausted all mirrors, retrying`);
    await sleep(5000 * (attempt + 1));
  }
  throw lastErr;
}
