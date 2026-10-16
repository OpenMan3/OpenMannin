/**
 * Satellite-pass summaries for the live widget.
 *
 * WHY THIS EXISTS SEPARATELY. The worker emits one flat feature per satellite,
 * with the next pass duplicated into machine-readable fields (`nextRiseIso` and
 * friends) alongside the human sentences the popup renders. Turning that into
 * "what should the collapsed pill say" is string parsing and time arithmetic
 * with no DOM and no network - the kind of code that breaks on a timezone
 * boundary or an upstream shape change, and is miserable to reproduce inside a
 * mounted component. Keeping it pure means `node --test` covers it directly
 * (scripts/lib/pass-summary.test.mjs) and the widget stays a thin shell.
 *
 * DEFENSIVE BY CONSTRUCTION. `fetchPasses` returns `unknown` on purpose: the
 * FeatureCollection may be a 30-minute-old cache, a partial worker reply, or a
 * hand-edited localStorage entry. Nothing here throws on any of those; a
 * malformed feature costs one row, and malformed input costs the whole list.
 */

export interface PassSummary {
  name: string;
  noradId: number;
  /** Epoch millis of rise / set (parsed from the worker's ISO strings). */
  rise: number;
  set: number;
  maxElevDeg: number;
  durationS: number;
}

/** Local 24-hour clock, `en-GB`, matching how the rest of the app shows times. */
const CLOCK = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** Local weekday + clock, for passes too far out for a countdown ("Mon 14:03"). */
const DAY_CLOCK = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function finiteNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function parseIso(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/**
 * The next passes from `now`, soonest first.
 *
 * Passes whose rise is before `now` are dropped: the worker computes against
 * the moment it ran, but a cached collection can be handed over minutes later,
 * and a satellite already overhead is not a "next pass". Features missing the
 * flat `nextRiseIso` fields (an older cached worker build) are skipped rather
 * than guessed at - a widget that says "no passes" beats one that invents a
 * time.
 */
export function summarizePasses(fc: unknown, now: number, limit = 4): PassSummary[] {
  const out: PassSummary[] = [];
  if (!Number.isFinite(now)) return out;

  const features: unknown = (fc as { features?: unknown } | null | undefined)?.features;
  if (!Array.isArray(features)) return out;

  const cap = Number.isFinite(limit) && limit >= 1 ? Math.floor(limit) : 4;

  for (const f of features) {
    const props: unknown = (f as { properties?: unknown } | null | undefined)?.properties;
    if (!props || typeof props !== "object") continue;
    const p = props as Record<string, unknown>;

    const rise = parseIso(p.nextRiseIso);
    if (rise === null || rise < now) continue;
    const set = parseIso(p.nextSetIso);
    const maxElevDeg = finiteNumber(p.nextMaxElevDeg);
    const durationS = finiteNumber(p.nextDurationS);
    if (set === null || maxElevDeg === null || durationS === null) continue;

    const noradId = finiteNumber(p.noradId) ?? Number(typeof p.noradId === "string" ? p.noradId.trim() : NaN);
    if (!Number.isFinite(noradId)) continue;
    const name = typeof p.name === "string" && p.name.trim() ? p.name.trim() : `NORAD ${noradId}`;

    out.push({ name, noradId, rise, set, maxElevDeg, durationS });
  }

  // The worker sorts by first-pass rise, but a consumer may hand us anything.
  out.sort((a, b) => a.rise - b.rise);
  return out.slice(0, cap);
}

/** The ground station the collection was computed for, when it says. */
export function stationOf(fc: unknown): string | null {
  const props: unknown = (fc as { properties?: unknown } | null | undefined)?.properties;
  if (!props || typeof props !== "object") return null;
  const station = (props as Record<string, unknown>).station;
  return typeof station === "string" && station.trim() ? station.trim() : null;
}

/** Collapsed-pill label from the soonest pass, e.g. "ISS in 42 min", or null. */
export function nextPassLabel(summaries: PassSummary[], now: number): string | null {
  const next = Array.isArray(summaries) ? summaries[0] : null;
  if (!next || !Number.isFinite(next.rise)) return null;

  // "ISS (ZARYA)" reads as ISS anywhere but the popup; the pill has one line.
  const name = next.name.split(/\s+/)[0] || next.name;
  const mins = Math.round((next.rise - now) / 60_000);
  if (mins < 1) return `${name} now`;
  if (mins < 60) return `${name} in ${mins} min`;
  if (mins < 24 * 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${name} in ${h} h ${m} m` : `${name} in ${h} h`;
  }
  return `${name} ${DAY_CLOCK.format(new Date(next.rise))}`;
}

/** Local `HH:MM` for a list row. */
export function clockOf(epochMs: number): string {
  return CLOCK.format(new Date(epochMs));
}
