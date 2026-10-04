import { NextResponse } from "next/server";

/**
 * Satellite pass predictions for a ground station on the Isle of Man.
 *
 * WHY THIS ONE IS NOT GATED. Every other live feed in this project is switched
 * off because its provider's terms forbid or restrict the use. This one needs
 * nobody's permission:
 *
 *   - TLEs are published by the US Space Force and are public domain.
 *   - CelesTrak distributes them without a key or a login.
 *   - SGP4, the propagator that turns a TLE into a position, is a published
 *     algorithm (Vallado). satellite.js implements it under MIT.
 *
 * The arithmetic is ours to do, so this is the one genuinely dynamic layer that
 * can ship enabled.
 *
 * WHAT THIS IS NOT. These are predicted pass WINDOWS from a two-line element
 * set, not acquired telemetry, and nothing here has been correlated against a
 * real observation. SGP4 is good to a few km and a few seconds in LEO, which is
 * plenty to answer "roughly when could a receiver here see it" and nowhere near
 * enough for anything operational.
 *
 * ELEVATION MASK. A pass below the horizon is not a pass. 5 degrees is used
 * because it is about a realistic small dish's practical floor once the radio
 * horizon is allowed for. Terrain obstruction on top of that - Snaefell is
 * 620 m and would genuinely shadow passes to the south-east - is NOT modelled.
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
} from "satellite.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** CelesTrak: the ISS plus the crewed craft that actually overfly the IoM. */
const TLE_URL = "https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle";

/** Ground stations, from the satellite-stations layer. Positions are graded there. */
const STATIONS: Record<string, { name: string; lat: number; lon: number; altM: number }> = {
  spaceman: { name: "Spaceman teleport (aql)", lat: 54.139, lon: -4.4951, altM: 60 },
  ioms: { name: "IOMS GNSS reference station", lat: 54.083081, lon: -4.623871, altM: 20 },
};

const MIN_ELEV_DEG = 5;
const WINDOW_HOURS = 48;
/** 30 s resolves a pass's peak elevation well enough to publish. */
const STEP_S = 30;

type Pass = { rise: string; peak: string; set: string; maxElev: number; durationS: number };

/** Two-line element sets, grouped per satellite. */
async function fetchTles(): Promise<{ name: string; line1: string; line2: string }[]> {
  const res = await fetch(TLE_URL, {
    next: { revalidate: 60 * 60 * 6 },
    headers: { "User-Agent": "OpenMannin/0.1 (open-source Isle of Man map)" },
  });
  if (!res.ok) throw new Error(`CelesTrak returned ${res.status}`);

  const out: { name: string; line1: string; line2: string }[] = [];
  for (const chunk of (await res.text()).trim().split(/\r?\n\r?\n/)) {
    const lines = chunk.split(/\r?\n/).filter((l) => l.trim().length);
    if (lines.length < 3) continue;
    const [name, line1, line2] = lines;
    if (!line1.startsWith("1 ") || !line2.startsWith("2 ")) continue;
    out.push({ name: name.trim(), line1, line2 });
  }
  return out;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const key = url.searchParams.get("station") ?? "spaceman";
  const station = STATIONS[key];
  if (!station) {
    return NextResponse.json(
      { error: "unknown station", known: Object.keys(STATIONS) },
      { status: 400 },
    );
  }

  let tles: { name: string; line1: string; line2: string }[];
  try {
    tles = await fetchTles();
  } catch (e) {
    return NextResponse.json(
      { error: "tle-fetch-failed", reason: (e as Error).message },
      { status: 502 },
    );
  }

  // satellite.js v7 works in radians and kilometres throughout, so the station
  // is converted once here rather than at every call site.
  const observerGd = {
    latitude: radiansLat(station.lat),
    longitude: radiansLong(station.lon),
    height: station.altM / 1000,
  };

  const now = new Date();
  const results: { satellite: string; noradId: string; passes: Pass[] }[] = [];

  for (const tle of tles) {
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

    for (let t = 0; t <= WINDOW_HOURS * 3600; t += STEP_S) {
      const when = new Date(now.getTime() + t * 1000);
      const pv = propagate(sat, when);
      if (!pv?.position) continue;

      const gmst = gstime(when);
      const satGd = eciToGeodetic(pv.position, gmst);
      // Nothing below ~90 km is usable from the ground: either decayed, or a
      // modelling artefact well outside the useful band.
      if (!satGd || satGd.height < 90) continue;

      const look = ecfToLookAngles(observerGd, geodeticToEcf(satGd));
      const elevation = radiansToDegrees(look.elevation);
      const above = elevation >= MIN_ELEV_DEG;

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

    if (passes.length) {
      results.push({ satellite: tle.name, noradId: String(sat.satnum), passes: passes.slice(0, 5) });
    }
  }

  results.sort(
    (a, b) => Date.parse(a.passes[0].rise) - Date.parse(b.passes[0].rise),
  );

  const fc = {
    type: "FeatureCollection",
    properties: {
      source: "CelesTrak TLEs (public domain), SGP4 via satellite.js (MIT)",
      licence: "PUBLIC-DOMAIN",
      station: station.name,
      stationLat: station.lat,
      stationLon: station.lon,
      generated: now.toISOString(),
      windowHours: WINDOW_HOURS,
      minElevDeg: MIN_ELEV_DEG,
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
        passes: r.passes,
        coordGrade: "C",
        coordSource:
          "Pass windows predicted by SGP4 propagation of a public-domain TLE, for the stated ground station.",
      },
    })),
  };

  return NextResponse.json(fc, { headers: { "Cache-Control": "public, max-age=900" } });
}