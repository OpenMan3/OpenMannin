/**
 * Satellite pass predictions, computed in the browser.
 *
 * WHY THIS MOVED OUT OF A SERVER ROUTE. CelesTrak sends
 * `access-control-allow-origin: *`, the TLEs are published by the US Space Force
 * and are public domain, and SGP4 is a published algorithm. Nothing here needed a
 * server. Running it client-side also removes the one real cost of the old
 * design: the route recomputed 48 hours of SGP4 for every crewed TLE on every
 * poll, and MapView already had an in-flight guard because it could outlast the
 * poll interval. On a static host there is no warm instance holding that state
 * anyway.
 *
 * WHY IT IS IN A WEB WORKER AND NOT ON THE MAIN THREAD. This is the load-bearing
 * part. SGP4 over 20 element sets at 30-second steps is 20 x 5760 = 115,200
 * propagations, each doing coordinate rotations and a Kepler solve.
 * On the main thread that is long enough to drop frames on the map for seconds
 * and can trip the browser's "unresponsive script" threshold on a slow machine.
 * The MapLibre worker is already a solved problem in this project (see
 * scripts/copy-maplibre-worker.mjs) so the same pattern applies here.
 *
 * TLE CACHING. CelesTrak re-reads every 6 hours server-side, so the 6-hour
 * cache below is preserved per-browser. Two caches, both needed:
 *   - the raw TLE text, for 6 h, because it only changes a few times a day
 *   - the computed FeatureCollection, for 30 min, because the pass windows
 *     drift with `now` and a cached collection would show yesterday's rise times
 */

const TLE_URL = "https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle";
/** Matches the 6 h re-read the server route used. TLEs update a few times a day. */
const TLE_CACHE_MS = 6 * 60 * 60 * 1000;
/**
 * Pass windows are computed against `now`, so a cached collection has a shelf
 * life far shorter than the TLEs it came from. 30 min keeps rise times honest
 * while still covering most polls.
 */
const FC_CACHE_MS = 30 * 60 * 1000;

const TLE_KEY = "openmannin:passes:tle:v2";
const FC_KEY = "openmannin:passes:fc:v2";

/** Ground stations, from the satellite-stations layer. Positions are graded there. */
export const STATIONS: Record<string, { name: string; lat: number; lon: number; altM: number }> = {
  spaceman: { name: "Spaceman teleport (aql)", lat: 54.139, lon: -4.4951, altM: 60 },
  ioms: { name: "IOMS GNSS reference station", lat: 54.083081, lon: -4.623871, altM: 20 },
};

const MIN_ELEV_DEG = 5;
const WINDOW_HOURS = 48;
/** 30 s resolves a pass's peak elevation well enough to publish. */
const STEP_S = 30;

/** `localStorage` throws in private mode on some browsers. */
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

function readCache<T>(key: string): { at: number; body: T } | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at?: unknown; body?: unknown };
    if (typeof parsed?.at !== "number" || !parsed.body) return null;
    return { at: parsed.at, body: parsed.body as T };
  } catch {
    return null;
  }
}

function writeCache(key: string, at: number, body: unknown): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(key, JSON.stringify({ at, body }));
  } catch {
    // The TLE text can approach the localStorage quota on its own. Losing the
    // cache costs one upstream request, not correctness.
  }
}

/**
 * Parse a CelesTrak GP response into element sets.
 *
 * THE FORMAT HAS NO BLANK LINES. This is the whole reason this function exists.
 * A GP payload is a flat run of CRLF-separated triples - name, line 1, line 2,
 * then the next name with no separator at all:
 *
 *     ISS (ZARYA)\r\n
 *     1 25544U 98067A ...\r\n
 *     2 25544  51.6316 ...\r\n
 *     POISK\r\n
 *     1 36086U 09060A ...\r\n
 *
 * Splitting on blank lines therefore yields exactly ONE block from a file of
 * twenty satellites, and the "3 lines per block, take the first three" reading
 * of that block returns the ISS and silently discards the rest. The previous
 * server route did precisely that, so the pass layer has only ever shown the
 * ISS and reported no error about the other nineteen. Verified against a live
 * payload: 20 records in, 1 element set out.
 *
 * So this parses by structure instead. A line beginning with "1 " IS the start of
 * an element set; its name is the nearest preceding line that is not itself an
 * element line. That is robust to blank lines, to CRLF, and to a missing name.
 *
 * Exported because this is the part worth testing against a real captured
 * payload: a malformed block must be skipped, not fatal, because one bad element
 * set from upstream should cost one satellite rather than the whole layer.
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

export function parseTles(text: string): { name: string; line1: string; line2: string }[] {
  const out: { name: string; line1: string; line2: string }[] = [];
  // Split on newlines only and trim each line, so a CRLF payload yields fields
  // with no carriage return embedded in them. satellite.js does not strip one.
  // Blank lines are kept, then skipped explicitly where a contiguous line is
  // assumed - see the line2 lookup below.
  const lines = text.split(/\r?\n/);

  /** Index of the next non-blank line at or after `from`, or -1. */
  const nextContent = (from: number): number => {
    for (let k = from; k < lines.length; k++) {
      if (lines[k].trim()) return k;
    }
    return -1;
  };

  /** Index of the previous non-blank line before `from`, or -1. */
  const prevContent = (from: number): number => {
    for (let k = from; k >= 0; k--) {
      if (lines[k].trim()) return k;
    }
    return -1;
  };

  for (let i = 0; i < lines.length; i++) {
    const line1 = lines[i].trim();
    if (!line1.startsWith("1 ")) continue;

    // Skip blanks looking for line 2, rather than assuming i + 1. Some
    // CelesTrak endpoints and mirrors emit a blank line between the two element
    // lines, and demanding adjacency there loses every element set silently.
    const j = nextContent(i + 1);
    const line2 = j === -1 ? "" : lines[j].trim();
    if (!line2.startsWith("2 ")) continue;
    if (!elementSetSane(line1, line2)) continue;

    // The name is the closest preceding non-element line. Only fall back to a
    // synthesised name when there genuinely is nothing above it.
    let name = `NORAD ${line1.slice(2, 7).trim()}`;
    for (let k = prevContent(i - 1); k >= 0; k = prevContent(k - 1)) {
      const candidate = lines[k].trim();
      if (candidate.startsWith("1 ") || candidate.startsWith("2 ")) break;
      name = candidate;
      break;
    }

    out.push({ name, line1, line2 });
    // Resume after line2 so a "2 " line is never re-examined as a potential name
    // for the next set.
    i = j;
  }

  return out;
}

async function fetchTles(): Promise<string> {
  const cached = readCache<string>(TLE_KEY);
  if (cached && Date.now() - cached.at < TLE_CACHE_MS) return cached.body;

  const res = await fetch(TLE_URL, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`CelesTrak returned ${res.status}`);
  const text = await res.text();

  // Only cache something we can actually parse. CelesTrak serves an HTML error
  // page with a 200 in some failure modes, and caching that would break the feed
  // for 6 hours with no obvious cause.
  if (!parseTles(text).length) throw new Error("CelesTrak returned no parsable element sets");

  writeCache(TLE_KEY, Date.now(), text);
  return text;
}

/**
 * Outer bound on a worker reply.
 *
 * The worker does ~115k propagations and can legitimately take a while on a
 * slow machine, so this is deliberately generous. It exists because the
 * alternative to a deadline is a wedged layer: MapView's in-flight guard is
 * released in a `finally` that only runs when this promise settles, so a
 * worker that accepts a request and never answers would stop the satellite
 * layer polling for the rest of the session with no badge and no console
 * line. A late reply after the deadline finds no `pending` entry and is
 * dropped, which costs one wasted poll rather than the layer.
 */
const REPLY_TIMEOUT_MS = 120_000;

/** Resolves once the worker module is loaded, reused across polls. */
let worker: Worker | null = null;
let workerPromise: Promise<Worker> | null = null;

/**
 * All waiters for the current worker, keyed by request id.
 *
 * Declared here rather than beside its first use because the reply listener
 * and the error handler below both own entries in it: a reply resolves one
 * entry, a worker failure rejects every entry still open. That is the whole
 * contract - see the note where the listener is attached.
 */
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

async function getWorker(): Promise<Worker> {
  if (worker) return worker;
  if (workerPromise) return workerPromise;

  workerPromise = (async () => {
    // Served from public/, NOT `new URL("./passes-worker.ts", import.meta.url)`.
    //
    // That looks like the correct way to construct a module worker and works in
    // dev. It does not survive a static export: the bundler copies the TypeScript
    // source into the output as an ASSET, keeping the .ts extension, rather than
    // compiling it to something a Worker can execute. Cloudflare serves that file
    // as video/mp2t and the browser refuses to run it, so the worker never replies
    // and this layer renders nothing - with no error in the console and nothing to
    // distinguish it from "nothing is currently overhead".
    //
    // scripts/build-passes-worker.mjs bundles the worker and its satellite.js
    // dependency graph into one self-contained public/passes-worker.mjs, the same
    // arrangement MapLibre's worker needs and already has here.
    const w = new Worker("/passes-worker.mjs", { type: "module" });

    // THE REPLY LISTENER LIVES ON THE WORKER, NOT ON `window`.
    //
    // A worker's `self.postMessage` is delivered to the `Worker` object that
    // created it. It never bubbles to `window`, so listening there - which is
    // what this used to do - means every reply is silently dropped: the
    // promise below never settles, MapView's in-flight guard never releases,
    // `pending` leaks an entry per poll, and the layer renders nothing with no
    // error anywhere. The two shapes are not interchangeable, and this is the
    // second time the distinction has mattered (see the static-export note in
    // the worker construction above).
    w.addEventListener("message", (e: MessageEvent) => {
      const { id, ok, result, error } = (e.data ?? {}) as {
        id?: number;
        ok?: boolean;
        result?: unknown;
        error?: string;
      };
      if (typeof id !== "number") return;
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      if (ok) entry.resolve(result);
      else entry.reject(new Error(error ?? "passes worker failed"));
    });

    // A worker that dies must not be reused, and must not leave callers
    // waiting on a reply that can never arrive. Clearing `workerPromise` as
    // well as `worker` is what allows the next poll to build a fresh one:
    // `getWorker()` returns the cached promise if it is set, so clearing only
    // `worker` - the previous behaviour - handed every later caller the same
    // dead instance forever.
    w.addEventListener("error", (e) => {
      if (worker === w) {
        worker = null;
        workerPromise = null;
      }
      const err = new Error(`passes worker failed: ${e.message || "worker error"}`);
      for (const [, entry] of pending) entry.reject(err);
      pending.clear();
      console.warn("[passes]", err.message);
    });

    worker = w;
    return w;
  })();

  return workerPromise;
}

let seq = 0;

export interface PassesResult {
  fc?: unknown;
  /** Served from cache because the network or the worker let us down. */
  stale?: boolean;
  failure?: { error: string; reason: string; source: string };
}

export async function fetchPasses(stationKey = "spaceman"): Promise<PassesResult> {
  const station = STATIONS[stationKey];
  if (!station) {
    return {
      failure: {
        error: "unknown station",
        reason: `No ground station named "${stationKey}". Known: ${Object.keys(STATIONS).join(", ")}`,
        source: "celestrak",
      },
    };
  }

  const cacheKey = `${FC_KEY}:${stationKey}`;
  const cached = readCache<unknown>(cacheKey);
  if (cached && Date.now() - cached.at < FC_CACHE_MS) return { fc: cached.body };

  let tleText: string;
  try {
    tleText = await fetchTles();
  } catch (e) {
    // Stale passes beat no passes: a 30-minute-old prediction of a window that is
    // still to come is still useful, and the payload carries its own timestamp.
    // It must say so, though - `stale` is what puts the badge on the panel, and
    // without it yesterday's rise times are presented as a fresh answer with the
    // error cleared. This is the same contract the live feeds honour.
    if (cached) return { fc: cached.body, stale: true };
    return {
      failure: {
        error: "tle-fetch-failed",
        reason: (e as Error).message,
        source: "celestrak",
      },
    };
  }

  try {
    const w = await getWorker();
    const id = ++seq;
    const fc = await new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      w.postMessage({ id, tles: tleText, station, windowHours: WINDOW_HOURS, stepS: STEP_S, minElevDeg: MIN_ELEV_DEG });
      // A deadline, not "no timeout": see REPLY_TIMEOUT_MS above. The worker
      // is doing a lot of work, so the bound is minutes rather than seconds,
      // but it must be a bound - MapView's in-flight guard is released only
      // when this settles.
      setTimeout(() => {
        const entry = pending.get(id);
        if (!entry) return;
        pending.delete(id);
        entry.reject(new Error(`passes worker did not reply within ${REPLY_TIMEOUT_MS / 1000}s`));
      }, REPLY_TIMEOUT_MS);
    });
    writeCache(cacheKey, Date.now(), fc);
    return { fc };
  } catch (e) {
    if (cached) return { fc: cached.body, stale: true };
    return {
      failure: {
        error: "propagation-failed",
        reason: (e as Error).message,
        source: "celestrak",
      },
    };
  }
}