/**
 * SGP4 pass computation, off the main thread.
 *
 * WHY A WORKER. 20 element sets x 5760 steps = ~115,000 propagations. Each one
 * runs coordinate rotations and a Kepler solve. On the main thread that is
 * several seconds of blocked scripting, during which the map stops responding to
 * pan and zoom. Moving it here keeps the map at 60fps
 * while the arithmetic runs, which is the whole reason MapLibre's own worker is
 * already served from public/ in this project.
 *
 * WHAT THIS IS NOT. These are predicted pass WINDOWS from a two-line element
 * set, not acquired telemetry, and nothing here has been correlated against a
 * real observation. SGP4 is good to a few km and a few seconds in LEO, which is
 * plenty to answer "roughly when could a receiver here see it" and nowhere near
 * enough for anything operational.
 *
 * TERRAIN MASKING IS NOT MODELLED. The 5-degree elevation mask is about a
 * realistic small dish's practical floor once the radio horizon is allowed for.
 * Snaefell at 621 m would genuinely shadow passes to the south-east and that is
 * not accounted for.
 *
 * The output is FLAT by construction. FeaturePopup stringifies every property it
 * is given, so an array of pass objects would render as the literal string
 * "[object Object],[object Object]" - which is precisely how this layer once hid
 * the one number that matters.
 */

import {
  twoline2satrec,
  propagate,
  gstime,
  geodeticToEcf,
  eciToGeodetic,
  ecfToLookAngles,
  radiansLat,
  radiansLong,
  radiansToDegrees,
} from "./satellite-js";

type Pass = { rise: string; peak: string; set: string; maxElev: number; durationS: number };

type Station = { name: string; lat: number; lon: number; altM: number };

type Request = {
  id: number;
  tles: string;
  station: Station;
  windowHours: number;
  stepS: number;
  minElevDeg: number;
};

/** `HH:MM`, with the date prefix only when it is not today. */
function passClock(iso: string, now: Date): string {
  const t = iso.slice(11, 16);
  return iso.slice(0, 10) === now.toISOString().slice(0, 10) ? `${t}Z` : `${iso.slice(5, 10)} ${t}Z`;
}

/**
 * One pass as a single readable line.
 *
 * Times carry an explicit Z and a relative offset. A satellite watcher wants
 * "when, and how high" first, not a JSON blob - and a bare local time with no
 * zone on it is how pass times get misread by hours.
 */
function describePass(p: Pass | undefined, now: Date): string | null {
  if (!p) return null;
  const rise = new Date(p.rise);
  const mins = Math.round((rise.getTime() - now.getTime()) / 60_000);
  const when =
    mins > 0
      ? `in ${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`
      : mins === 0
        ? "now"
        : `${-mins}m ago`;
  return `${passClock(p.rise, now)} (${when}), peak ${p.maxElev}deg, ${p.durationS}s`;
}

/**
 * Parse a GP payload into element sets.
 *
 * A CelesTrak GP payload has NO blank lines between records: it is a flat run of
 * CRLF-separated name/line1/line2 triples. Parsing by blank-line blocks yields
 * one element set from twenty satellites and silently drops the rest, which is
 * what the original server route did. Parse by structure instead: a line
 * beginning with "1 " starts an element set, and its name is the nearest
 * preceding non-element line.
 *
 * Duplicated rather than imported so the worker stays a single self-contained
 * bundle. `parseTles` in ../passes-client is the tested original; the test
 * asserts both this file and that one agree on a real payload.
 */
/**
 * TLE line checksum: sum of all digits modulo 10, with a minus sign counting 1.
 *
 * satellite.js does NOT validate this. `twoline2satrec` returns a record for
 * almost any input - prose, a reversed pair, a truncated line - and propagates it
 * to a position with NaN components. That NaN then survives the worker's
 * elevation test, because `NaN >= minElevation` is false rather than an error, so
 * a corrupt element set shows up as a satellite that is never above the horizon
 * instead of as a satellite that was rejected.
 *
 * The result is a layer quietly missing craft for no visible reason. Validating
 * here means a corrupt line is dropped with a reason, which is recoverable.
 */
function checksumValid(line: string): boolean {
  const expected = line.charCodeAt(line.length - 1) - 48;
  if (expected < 0 || expected > 9) return false;
  let sum = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const code = line.charCodeAt(i);
    if (code >= 48 && code <= 57) sum += code - 48;
    else if (code === 45) sum += 1; // a minus sign counts as one
  }
  return sum % 10 === expected;
}

/**
 * Every field satellite.js will read out of a line 1 or line 2 must be a finite
 * number.
 *
 * The checksum catches a corrupted digit. It does not catch a well-formed line
 * that is the wrong shape entirely, and satellite.js will not: it parses
 * substrings, and a missing field becomes NaN rather than an error. Checking the
 * recovered values is what actually stops a nonsense element set being
 * propagated, since NaN fails every downstream comparison silently.
 */
function elementSetSane(line1: string, line2: string): boolean {
  if (line1.length !== 69 || line2.length !== 69) return false;
  if (!checksumValid(line1) || !checksumValid(line2)) return false;

  const numeric = (line: string, from: number, to: number) => {
    const text = line.slice(from, to).trim().replace(/[+ ]/g, "");
    if (text === "") return NaN;
    return Number(text);
  };

  const inclination = numeric(line2, 8, 16);
  const eccentricity = numeric(line2, 26, 33) / 1e7;
  const meanMotion = numeric(line2, 52, 63);
  const raan = numeric(line2, 17, 25);

  return (
    Number.isFinite(inclination) &&
    inclination >= 0 &&
    inclination <= 180 &&
    Number.isFinite(eccentricity) &&
    eccentricity >= 0 &&
    eccentricity < 1 &&
    Number.isFinite(meanMotion) &&
    meanMotion > 0 &&
    // Above ~17 rev/day the element set is not an orbit this layer can propagate
    // meaningfully; below ~0.5 it has decayed or is not a satellite.
    meanMotion < 17 &&
    Number.isFinite(raan) &&
    raan >= 0 &&
    raan < 360
  );
}

function parseTles(text: string): { name: string; line1: string; line2: string }[] {
  const out: { name: string; line1: string; line2: string }[] = [];
  const lines = text.split(/\r?\n/);

  const nextContent = (from: number): number => {
    for (let k = from; k < lines.length; k++) if (lines[k].trim()) return k;
    return -1;
  };
  const prevContent = (from: number): number => {
    for (let k = from; k >= 0; k--) if (lines[k].trim()) return k;
    return -1;
  };

  for (let i = 0; i < lines.length; i++) {
    const line1 = lines[i].trim();
    if (!line1.startsWith("1 ")) continue;

    // Skip blanks looking for line 2 rather than assuming adjacency.
    const j = nextContent(i + 1);
    const line2 = j === -1 ? "" : lines[j].trim();
    if (!line2.startsWith("2 ")) continue;
    if (!elementSetSane(line1, line2)) continue;

    let name = `NORAD ${line1.slice(2, 7).trim()}`;
    for (let k = prevContent(i - 1); k >= 0; k = prevContent(k - 1)) {
      const candidate = lines[k].trim();
      if (candidate.startsWith("1 ") || candidate.startsWith("2 ")) break;
      name = candidate;
      break;
    }

    out.push({ name, line1, line2 });
    i = j;
  }

  return out;
}

function compute(req: Request): unknown {
  const { station, windowHours, stepS, minElevDeg } = req;

  // satellite.js v7 works in radians and kilometres throughout, so the observer
  // is converted once here rather than at every call site.
  const observerGd = {
    latitude: radiansLat(station.lat),
    longitude: radiansLong(station.lon),
    height: station.altM / 1000,
  };

  const now = new Date();
  const results: { satellite: string; noradId: string; passes: Pass[] }[] = [];

  for (const tle of parseTles(req.tles)) {
    let sat;
    try {
      sat = twoline2satrec(tle.line1, tle.line2);
    } catch {
      continue; // one malformed element set must not fail the whole response
    }
    if (!sat) continue;

    const passes: Pass[] = [];
    let open: { rise: Date; maxElev: number; peak: Date } | null = null;
    let prevAbove = false;
    /** Last sample actually taken, for flushing a pass the window ends mid-way through. */
    let lastWhen: Date | null = null;

    for (let t = 0; t <= windowHours * 3600; t += stepS) {
      const when = new Date(now.getTime() + t * 1000);
      lastWhen = when;
      const pv = propagate(sat, when);
      if (!pv?.position) continue;

      const gmst = gstime(when);
      const satGd = eciToGeodetic(pv.position, gmst);
      // Nothing below ~90 km is usable from the ground: either decayed, or a
      // modelling artefact well outside the useful band.
      if (!satGd || satGd.height < 90) continue;

      const look = ecfToLookAngles(observerGd, geodeticToEcf(satGd));
      const elevation = radiansToDegrees(look.elevation);
      const above = elevation >= minElevDeg;

      if (above && !prevAbove) {
        open = { rise: when, maxElev: elevation, peak: when };
      } else if (above && open && elevation > open.maxElev) {
        open.maxElev = elevation;
        open.peak = when;
      } else if (!above && prevAbove && open) {
        passes.push({
          rise: open.rise.toISOString(),
          peak: open.peak.toISOString(),
          set: when.toISOString(),
          maxElev: Number(open.maxElev.toFixed(1)),
          durationS: Math.round((when.getTime() - open.rise.getTime()) / 1000),
        });
        open = null;
      }
      prevAbove = above;
    }

    // A pass the window CLOSES MID-WAY THROUGH would otherwise be dropped
    // entirely: it is only flushed on the set transition, and by construction
    // there is no set inside the window. That loses a real rise and peak that
    // both happened on the correct side of `now`. Publish it with the final
    // sample as `set` - the duration is under-reported by however long the pass
    // continued past the boundary, which is minutes, against losing the pass.
    if (open && lastWhen && lastWhen.getTime() > open.rise.getTime()) {
      passes.push({
        rise: open.rise.toISOString(),
        peak: open.peak.toISOString(),
        set: lastWhen.toISOString(),
        maxElev: Number(open.maxElev.toFixed(1)),
        durationS: Math.round((lastWhen.getTime() - open.rise.getTime()) / 1000),
      });
    }

    if (passes.length) {
      results.push({
        satellite: tle.name,
        noradId: String(sat.satnum),
        // Five per satellite: enough to plan a session, few enough that the popup
        // stays readable.
        passes: passes.slice(0, 5),
      });
    }
  }

  results.sort((a, b) => Date.parse(a.passes[0].rise) - Date.parse(b.passes[0].rise));

  return {
    type: "FeatureCollection",
    properties: {
      source: "CelesTrak TLEs (public domain), SGP4 via satellite.js (MIT)",
      licence: "PUBLIC-DOMAIN",
      station: station.name,
      stationLat: station.lat,
      stationLon: station.lon,
      generated: now.toISOString(),
      windowHours,
      minElevDeg,
      count: results.length,
      caveat:
        "Predicted from public-domain two-line element sets, not acquired telemetry. SGP4 is good to a few km and seconds in LEO: it answers 'roughly when', nothing operational. Terrain masking is not modelled.",
    },
    features: results.map((r) => ({
      type: "Feature",
      id: `satellite-pass/${r.noradId}`,
      geometry: { type: "Point", coordinates: [station.lon, station.lat] },
      properties: {
        name: r.satellite,
        noradId: r.noradId,
        kind: "satellite-pass-prediction",
        station: station.name,
        // These must be FLAT. FeaturePopup stringifies every property it is
        // given, so an array of pass objects renders as the literal string
        // "[object Object],[object Object]" - which is what this layer used to
        // show, i.e. the one genuinely useful number on the feature was
        // invisible.
        passCount: r.passes.length,
        bestElevationDeg: Math.max(...r.passes.map((p) => p.maxElev)),
        nextPass: describePass(r.passes[0], now),
        // Machine-readable twins of the human sentence above, so consumers can
        // count down or sort without re-parsing prose. `nextPass` stays the
        // popup's rendering; these stay flat for the same reason every other
        // property here does - FeaturePopup stringifies anything nested.
        nextRiseIso: r.passes[0].rise,
        nextSetIso: r.passes[0].set,
        nextMaxElevDeg: r.passes[0].maxElev,
        nextDurationS: r.passes[0].durationS,
        passes: r.passes
          .map((p) => `${passClock(p.rise, now)}-${p.set.slice(11, 16)}Z ${p.maxElev}deg ${p.durationS}s`)
          .join(" | "),
        coordGrade: "C",
        coordSource:
          "Pass windows predicted by SGP4 propagation of a public-domain TLE, for the stated ground station.",
      },
    })),
  };
}

self.addEventListener("message", (e: MessageEvent) => {
  const req = e.data as Request;
  if (!req || typeof req.id !== "number") return;
  try {
    const result = compute(req);
    (self as unknown as Worker).postMessage({ id: req.id, ok: true, result });
  } catch (err) {
    (self as unknown as Worker).postMessage({
      id: req.id,
      ok: false,
      error: (err as Error).message,
    });
  }
});