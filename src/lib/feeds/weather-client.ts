/**
 * Weather and sea state, fetched from the browser.
 *
 * WHY THIS MOVED OUT OF A SERVER ROUTE. Open-Meteo sends
 * `Access-Control-Allow-Origin: *` on both the forecast and marine APIs and
 * needs no key, no account and no permission, so there is nothing a server
 * proxy was required to do here. With no proxy, every visitor's own request is
 * the upstream request, which is one fewer moving part and no cold start.
 *
 * WHAT THE PROXY WAS ACTUALLY FOR, AND WHAT REPLACES IT. It was there to protect
 * Open-Meteo's free-tier budget (10,000 calls/day, and no rate-limit headers
 * come back - you get a bare 429 and have to track usage yourself). A server
 * fanned one call out to every visitor. In the browser that job belongs to the
 * HTTP cache plus `localStorage`, implemented below, and it is a weaker
 * guarantee: the cache is per-browser, so N visitors behind one IP still cost N
 * calls on a cold cache. See `Budget` for what that means.
 *
 * THE LICENCE RESTRICTION IS UNCHANGED AND STILL BINDING. The free tier is
 * NON-COMMERCIAL; Open-Meteo count subscriptions OR advertising as commercial
 * use. Moving the call client-side does not alter that, and this layer is on by
 * default, so it remains the one most likely to be misused by accident. The
 * payload still carries `commercialUsePermitted: false`.
 *
 * WHAT THIS IS NOT. There is NO tide or sea-level-height product here. Wave
 * height and sea surface temperature are not tide. The Isle of Man has six
 * operating tide gauges and none publishes a machine-readable feed, so the
 * tide-stations layer carries surveyed positions and no readings.
 *
 * GRID SNAP. The positions below are the model grid cells the API actually
 * returned, not the coordinates we asked for. The API snaps a requested point
 * to the nearest cell centre and echoes the snapped value back in
 * `latitude`/`longitude`. We render THAT, because rendering the requested point
 * would put a marker on a cell the numbers do not describe.
 *
 * Formatting helpers live in ../weather and are unit-tested there.
 */

import { compass, describeCode, forecastLine, n } from "../weather.ts";

/** The cell Open-Meteo snaps an IoM-centred request to. */
const LAND_LAT = 54.1875;
const LAND_LON = -4.5;
/** A separate cell over open water, for the wave and SST products. */
const MARINE_LAT = 54.125;
const MARINE_LON = -4.4583;
/**
 * Snaefell, the island's only mountain (621 m) and its high point.
 *
 * The brief asks for high-point weather telemetry, and this is what that means
 * in practice: a second land cell at the summit, so a reader can see the
 * temperature and wind gradient between the coast and the top. The summit is
 * inside the same model grid cell as the coast at this resolution, so the two
 * markers may sit on the same cell - which is itself the honest answer: the
 * model cannot resolve a 621 m peak, and the numbers are the grid's, not the
 * summit's.
 */
const SNAEFELL_LAT = 54.2625;
const SNAEFELL_LON = -4.4736;

const CURRENT_FIELDS = [
  "temperature_2m",
  "relative_humidity_2m",
  "apparent_temperature",
  "precipitation",
  "weather_code",
  "cloud_cover",
  "pressure_msl",
  "wind_speed_10m",
  "wind_direction_10m",
  "wind_gusts_10m",
].join(",");

const MARINE_FIELDS = [
  "wave_height",
  "wave_direction",
  "wave_period",
  "sea_surface_temperature",
].join(",");

/**
 * Free-tier call budget, per browser.
 *
 * Open-Meteo publishes current conditions on a 15-minute interval, so a 10-minute
 * cache means the data is never more than one interval old and roughly a third
 * of polls are served without touching the network. Each refresh issues TWO
 * calls (forecast + marine state), but only after the cache is stale, so a tab
 * left open for a day costs a little under ~300 calls against a 10,000/day
 * ceiling — comfortably inside budget. A thousand visitors on a cold cache are
 * not, and nothing in this file can prevent that - only a server-side fan-out
 * could, which is the thing this refactor removed.
 */
const CACHE_MS = 600_000;
const CACHE_KEY = "openmannin:weather:v2";

export interface FeedFailure {
  error: string;
  reason: string;
  source: string;
  licence: string;
}

export interface WeatherResult {
  fc?: unknown;
  failure?: FeedFailure;
  /** True when this came from cache because the network call failed. */
  stale?: boolean;
}

/** `localStorage` throws in private mode on some browsers; never let that break a map. */
function storage(): Storage | null {
  try {
    const s = window.localStorage;
    const probe = "__om__";
    s.setItem(probe, "1");
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

function readCache(): { at: number; body: unknown } | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at?: unknown; body?: unknown };
    if (typeof parsed?.at !== "number" || !parsed.body) return null;
    return { at: parsed.at, body: parsed.body };
  } catch {
    return null;
  }
}

function writeCache(at: number, body: unknown): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(CACHE_KEY, JSON.stringify({ at, body }));
  } catch {
    // Quota exceeded. The weather payload is small, so this means the origin is
    // nearly out of storage; losing the cache costs upstream calls, not correctness.
  }
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Open-Meteo returned HTTP ${res.status}`);
  return res.json();
}

/**
 * Build the FeatureCollection.
 *
 * Both calls are issued together because they are independent, and the marine
 * one failing must not cost us the land observation: a map with a temperature
 * and no wave height is far more useful than a refusal.
 */
async function build(): Promise<unknown> {
  const tz = "Europe%2FLondon";
  const landUrl =
    `https://api.open-meteo.com/v1/forecast?latitude=${LAND_LAT}&longitude=${LAND_LON}` +
    `&current=${CURRENT_FIELDS}` +
    `&hourly=temperature_2m,precipitation_probability,wind_speed_10m` +
    `&wind_speed_unit=kn&forecast_days=2&timezone=${tz}`;
  const snaefellUrl =
    `https://api.open-meteo.com/v1/forecast?latitude=${SNAEFELL_LAT}&longitude=${SNAEFELL_LON}` +
    `&current=${CURRENT_FIELDS}` +
    `&wind_speed_unit=kn&forecast_days=2&timezone=${tz}`;
  const marineUrl =
    `https://marine-api.open-meteo.com/v1/marine?latitude=${MARINE_LAT}&longitude=${MARINE_LON}` +
    `&current=${MARINE_FIELDS}` +
    `&hourly=wave_height,wave_period&forecast_days=2&timezone=${tz}`;

  const [wx, snaefell, marine] = await Promise.all([
    // A land failure is fatal to this collection: it is the reason the layer exists.
    fetchJson(landUrl),
    // The summit cell is a bonus: if it fails, the coast and the sea still render.
    fetchJson(snaefellUrl).catch(() => null),
    fetchJson(marineUrl).catch(() => null),
  ]);

  const c = wx?.current ?? {};
  const s = snaefell?.current ?? {};
  const m = marine?.current ?? {};
  const generated = new Date().toISOString();

  // The API echoes the grid cell it actually used. Render THAT, not the point we
  // asked for - see the note at the top of this file.
  const landAt: [number, number] = [n(wx?.longitude, 4) ?? LAND_LON, n(wx?.latitude, 4) ?? LAND_LAT];
  const snaefellAt: [number, number] = [
    n(snaefell?.longitude, 4) ?? SNAEFELL_LON,
    n(snaefell?.latitude, 4) ?? SNAEFELL_LAT,
  ];
  const marineAt: [number, number] = [
    n(marine?.longitude, 4) ?? MARINE_LON,
    n(marine?.latitude, 4) ?? MARINE_LAT,
  ];

  const code = Number(c.weather_code);

  const features: unknown[] = [
    {
      type: "Feature",
      id: "weather/land",
      geometry: { type: "Point", coordinates: landAt },
      properties: {
        name: "Conditions (model grid)",
        kind: "weather-current",
        observedAt: c.time ?? null,
        // An unrecognised code shows the raw number rather than a wrong label.
        summary: describeCode(code) ?? (Number.isFinite(code) ? `WMO code ${code}` : null),
        temperatureC: n(c.temperature_2m),
        feelsLikeC: n(c.apparent_temperature),
        humidityPct: n(c.relative_humidity_2m, 0),
        cloudCoverPct: n(c.cloud_cover, 0),
        pressureHpa: n(c.pressure_msl),
        windKn: n(c.wind_speed_10m),
        windDir: n(c.wind_direction_10m, 0),
        windCompass: compass(c.wind_direction_10m),
        gustsKn: n(c.wind_gusts_10m),
        precipMm: n(c.precipitation, 2),
        forecast6h: forecastLine(wx?.hourly, new Date()),
        coordGrade: "B",
        coordSource:
          "Open-Meteo numerical weather model grid cell, not an instrument. The API snapped the request to this cell and we render the cell it echoed back.",
      },
    },
  ];

  // The summit marker is only offered when its own call returned. Same rule as
  // the marine marker: a feature with every null property reads as "the summit
  // is calm", which is a claim nobody made.
  if (snaefell) {
    const sCode = Number(s.weather_code);
    features.push({
      type: "Feature",
      id: "weather/snaefell",
      geometry: { type: "Point", coordinates: snaefellAt },
      properties: {
        name: "Snaefell summit (model grid)",
        kind: "weather-snaefell",
        observedAt: s.time ?? null,
        summary: describeCode(sCode) ?? (Number.isFinite(sCode) ? `WMO code ${sCode}` : null),
        temperatureC: n(s.temperature_2m),
        feelsLikeC: n(s.apparent_temperature),
        pressureHpa: n(s.pressure_msl),
        windKn: n(s.wind_speed_10m),
        windDir: n(s.wind_direction_10m, 0),
        windCompass: compass(s.wind_direction_10m),
        gustsKn: n(s.wind_gusts_10m),
        coordGrade: "B",
        coordSource:
          "Open-Meteo model grid cell for the Snaefell request. The model cannot resolve a 621 m peak, so this cell may coincide with the coastal cell - the numbers are the grid's, not a summit instrument's.",
      },
    });
  }

  // Only offer the sea-state marker when the marine call actually returned. A
  // feature with every null property would render as a marker on the water with
  // "wave height: null" in its popup, which reads as "there are no waves".
  if (marine) {
    features.push({
      type: "Feature",
      id: "weather/marine",
      geometry: { type: "Point", coordinates: marineAt },
      properties: {
        name: "Sea state (model grid)",
        kind: "weather-marine",
        observedAt: m.time ?? null,
        waveHeightM: n(m.wave_height, 2),
        wavePeriodS: n(m.wave_period, 1),
        waveDir: n(m.wave_direction, 0),
        waveCompass: compass(m.wave_direction),
        seaSurfaceTempC: n(m.sea_surface_temperature),
        coordGrade: "B",
        coordSource:
          "Open-Meteo wave model grid cell. Wave height and sea surface temperature are MODELLED, not measured, and neither is tide or sea level.",
      },
    });
  }

  return {
    type: "FeatureCollection",
    properties: {
      source: "Open-Meteo",
      licence: "CC-BY-4.0",
      attribution: "Weather data by Open-Meteo.com (CC BY 4.0)",
      generated,
      /** Open-Meteo's free tier forbids commercial use. See the file header. */
      commercialUsePermitted: false,
      count: features.length,
      caveats: [
        "FREE TIER IS NON-COMMERCIAL. Open-Meteo count subscriptions OR advertising as commercial use. A paid plan is required before this feed can back a monetised site.",
        "Model output, not observations. No Met Office observation is used here.",
        "There is NO tide or sea-level-height product. Wave height and sea surface temperature only - do not read these as tide.",
        "Ronaldsway Met Office observations run hourly and continuously since 7 May 1946, but there is NO public CSV or JSON feed for them.",
        "10,000 calls/day and 300,000/month on the free tier, and no rate-limit headers are returned - you get a bare 429 and must track usage yourself. Caching is per-browser now, so a cold cache costs one upstream call per visitor.",
      ],
    },
    features,
  };
}

/** Deduplicates concurrent polls from several components on one page. */
let inflight: Promise<unknown> | null = null;

export async function fetchWeather(): Promise<WeatherResult> {
  const cached = readCache();
  if (cached && Date.now() - cached.at < CACHE_MS) return { fc: cached.body };

  if (!inflight) {
    inflight = build()
      .then((body) => {
        writeCache(Date.now(), body);
        return body;
      })
      .finally(() => {
        inflight = null;
      });
  }

  try {
    return { fc: await inflight };
  } catch (e) {
    // Serve the last good answer rather than nothing: weather that is ten minutes
    // old is useful, an empty layer is not. The `generated` stamp travels with the
    // payload so the reader can see how old it is.
    if (cached) return { fc: cached.body, stale: true };
    return {
      failure: {
        error: "upstream-unavailable",
        reason: (e as Error).message,
        source: "open-meteo",
        licence: "CC-BY-4.0",
      },
    };
  }
}