/**
 * Pure formatting helpers for the weather feed.
 *
 * WHY SEPARATE. This started life inside the old /api/weather route - 317 lines
 * of fetch orchestration and formatting with no automated coverage at all - and
 * the formatting is where the bugs were: a forecast line that began an hour in
 * the past because UTC wall-clock was compared against local wall-clock, and a
 * compass lookup that could index past the end of its own table. Both produce
 * plausible output, which is exactly why they need tests.
 *
 * Open-Meteo needs no credentials and no permission, so this is the one live
 * feed whose helpers can be checked against real data at any time.
 */

/**
 * 16-point compass, because "254" is not a wind direction a person can read.
 *
 * The `% 16` is load-bearing: 360° rounds to index 16, and without the modulo
 * that indexes one past the end of the table and yields `undefined`.
 */
export function compass(deg: number | null | undefined): string | null {
  if (deg == null || !Number.isFinite(deg)) return null;
  const points = [
    "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
    "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
  ];
  return points[Math.round(deg / 22.5) % 16];
}

/**
 * Round for display, and pass non-numbers through as null so the popup omits
 * the field rather than printing "null" or "NaN".
 */
export function n(v: unknown, dp = 1): number | null {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? Number(x.toFixed(dp)) : null;
}

/**
 * The timezone every Open-Meteo request in this app asks for, and therefore the
 * timezone whose wall clock the hourly arrays are written in.
 *
 * Duplicated from `feeds/weather-client.ts` (which percent-encodes it for a
 * query string) because that module fetches and this one must not.
 */
export const FEED_TIMEZONE = "Europe/London";

/**
 * Formatters are expensive enough to build that module scope is the right
 * place: `forecastLine` runs once per weather poll, but the full-ICU lookup
 * behind `timeZone` is not free.
 */
const wallClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: FEED_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

/**
 * `YYYY-MM-DDTHH` wall clock in FEED_TIMEZONE - the exact shape Open-Meteo
 * returns its hourly `time` array in.
 *
 * NOT the browser's local clock, which is what this used to build. The API is
 * asked for `timezone=Europe/London` and answers with naive London wall-clock
 * strings; deriving "now" from `getHours()` made every comparison wrong by
 * however far the VISITOR is from the island. A reader in UTC+9 got a forecast
 * line starting nine hours early - the same bug this function exists to prevent
 * had simply moved from UTC to the visitor's offset, and a forecast that starts
 * in the past still looks like a forecast.
 *
 * Timezone strings are also why this cannot be `toISOString().slice(...)`: UTC
 * is out by the offset, exactly as the original bug was.
 */
export function forecastHourKey(now: Date): string {
  const p: Record<string, string> = {};
  for (const part of wallClock.formatToParts(now)) p[part.type] = part.value;
  return `${p.year}-${p.month}-${p.day}T${p.hour}`;
}

/**
 * Next N hourly steps from now, as a single readable line.
 *
 * The subtlety is the timezone. Open-Meteo returns wall-clock times in the
 * requested timezone with NO offset suffix, so they must be compared against a
 * clock in THAT timezone - see `forecastHourKey`. Comparing against UTC (the
 * original bug) or against the visitor's own zone (the bug that replaced it)
 * both start the forecast at the wrong hour, silently; a line that begins an
 * hour in the past still reads as a forecast, which is why it survived a
 * manual look.
 *
 * `now` is a parameter rather than a call to `new Date()` so the behaviour is
 * testable at a fixed instant, including across a DST boundary.
 */
export function forecastLine(
  hourly:
    | { time?: unknown; temperature_2m?: unknown; precipitation_probability?: unknown }
    | null
    | undefined,
  now: Date,
  count = 6,
): string | null {
  const times: string[] = Array.isArray(hourly?.time) ? (hourly!.time as string[]) : [];
  if (!times.length) return null;

  // Open-Meteo returns parallel arrays, all the same length as `time`. Reading
  // them through an indexer needs the array-ness asserted explicitly, since an
  // unknown-typed value narrows to `{}` and cannot be indexed.
  const series = (key: "temperature_2m" | "precipitation_probability"): unknown[] =>
    Array.isArray(hourly?.[key]) ? (hourly[key] as unknown[]) : [];

  const temps = series("temperature_2m");
  const pops = series("precipitation_probability");

  const nowKey = forecastHourKey(now);
  let start = times.findIndex((t: string) => t.slice(0, 13) >= nowKey);
  // Every hour in the array is already past (a late-evening request against a
  // short array): fall back to the first entry rather than showing nothing.
  if (start < 0) start = 0;

  const parts: string[] = [];
  for (let i = start; i < Math.min(start + count, times.length); i++) {
    const t = String(times[i]).slice(11, 16);
    const temp = n(temps[i], 0);
    const pop = pops[i];
    // A null temperature means this hour is unusable, so skip it rather than
    // printing "null C".
    if (temp === null) continue;
    parts.push(`${t} ${temp}C${pop == null ? "" : ` ${pop}%`}`);
  }
  return parts.length ? parts.join(" · ") : null;
}

/**
 * WMO weather interpretation codes, as the subset Open-Meteo returns.
 *
 * An unrecognised code must stay absent rather than become a wrong label, so
 * callers render a fallback of their own choosing.
 */
export const WMO: Record<number, string> = {
  0: "Clear",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  56: "Light freezing drizzle",
  57: "Dense freezing drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  66: "Light freezing rain",
  67: "Heavy freezing rain",
  71: "Slight snow",
  73: "Moderate snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Slight rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  85: "Slight snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with slight hail",
  99: "Thunderstorm with heavy hail",
};

/** Descriptive label for a WMO code, or null when the code is not recognised. */
export function describeCode(code: unknown): string | null {
  const c = n(code, 0);
  return c === null ? null : (WMO[c] ?? null);
}