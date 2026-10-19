"use client";

/**
 * Saved and recent destinations: the data behind the "Recent & saved" list in
 * the navigation preview card.
 *
 * The list rules (dedupe on rounded coordinates + title, cap, newest first)
 * are pure and take their store from the caller, so the same code runs against
 * `window.localStorage` in the app and against an object literal in the tests.
 * Every store access is guarded: SSR has no `window`, privacy modes block
 * storage outright and an older build can leave a half-written value behind -
 * none of which may throw into a render.
 */

export interface StoredDestination {
  lon: number;
  lat: number;
  title: string;
  detail?: string;
  /** Epoch ms of the last visit (recents) or of the save itself (saved). */
  at: number;
}

/** What callers hand in; `at` is stamped at merge time when it is absent. */
export type DestinationSeed = Omit<StoredDestination, "at"> & { at?: number };

/** The minimal store these lists need; the DOM `Storage` satisfies it. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Recents are a short trail of last places; saved is the favourites list. */
export const RECENT_KEY = "om:destinations.recent";
export const SAVED_KEY = "om:destinations.saved";
export const RECENT_CAP = 8;
export const SAVED_CAP = 30;

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * Resolved on every call rather than at module load: tests inject their own
 * store, and SSR (or storage blocked by the browser) resolves to null, which
 * readers answer with [] and writers simply ignore.
 */
function defaultStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    // Reading the property alone throws when cookies are blocked wholesale.
    return null;
  }
}

/**
 * Identity of a place, for dedupe and matching. 5 dp is about a metre on the
 * island, so re-dropping the same pin lands on the same entry while two
 * genuinely different places stay apart; the title keeps two pins that round
 * alike from collapsing into one.
 */
export function destKey(dest: { lon: number; lat: number; title: string }): string {
  return `${dest.lon.toFixed(5)}|${dest.lat.toFixed(5)}|${dest.title}`;
}

function isStoredDestination(value: unknown): value is StoredDestination {
  if (typeof value !== "object" || value === null) return false;
  const d = value as {
    lon?: unknown;
    lat?: unknown;
    title?: unknown;
    detail?: unknown;
    at?: unknown;
  };
  return (
    typeof d.lon === "number" &&
    Number.isFinite(d.lon) &&
    typeof d.lat === "number" &&
    Number.isFinite(d.lat) &&
    typeof d.title === "string" &&
    typeof d.at === "number" &&
    Number.isFinite(d.at) &&
    (d.detail === undefined || typeof d.detail === "string")
  );
}

/**
 * Read one list. Anything unreadable - absent, unparsable, not an array, or
 * seeded with broken rows - reads as an empty list rather than throwing or
 * letting malformed entries reach the UI.
 */
function readList(storage: StorageLike | null, key: string): StoredDestination[] {
  if (!storage) return [];
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return [];
  }
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  return Array.isArray(parsed) ? parsed.filter(isStoredDestination) : [];
}

/** Write one list, handing it back so callers can return it in one statement. */
function writeList(
  storage: StorageLike | null,
  key: string,
  list: StoredDestination[],
): StoredDestination[] {
  if (storage) {
    try {
      storage.setItem(key, JSON.stringify(list));
    } catch {
      // Quota or private mode: the session carries on with the in-memory list.
    }
  }
  return list;
}

/** Attach the timestamp; an empty detail is dropped so stored JSON stays tidy. */
function stamp(seed: DestinationSeed): StoredDestination {
  const dest: StoredDestination = {
    lon: seed.lon,
    lat: seed.lat,
    title: seed.title,
    at: typeof seed.at === "number" && Number.isFinite(seed.at) ? seed.at : Date.now(),
  };
  if (seed.detail) dest.detail = seed.detail;
  return dest;
}

/**
 * Newest-first merge shared by both lists: re-opening a place already listed
 * moves it to the front with a refreshed timestamp instead of stacking a
 * duplicate, and the tail is cut at `cap`.
 */
function merge(list: StoredDestination[], seed: DestinationSeed, cap: number): StoredDestination[] {
  const dest = stamp(seed);
  const key = destKey(dest);
  return [dest, ...list.filter((d) => destKey(d) !== key)].slice(0, cap);
}

// ---------------------------------------------------------------------------
// Recents
// ---------------------------------------------------------------------------

export function loadRecent(storage: StorageLike | null = defaultStorage()): StoredDestination[] {
  return readList(storage, RECENT_KEY);
}

/** Record a visit: front of the list, timestamped, capped at RECENT_CAP. */
export function recordRecent(
  seed: DestinationSeed,
  storage: StorageLike | null = defaultStorage(),
): StoredDestination[] {
  return writeList(storage, RECENT_KEY, merge(readList(storage, RECENT_KEY), seed, RECENT_CAP));
}

export function clearRecent(storage: StorageLike | null = defaultStorage()): void {
  writeList(storage, RECENT_KEY, []);
}

// ---------------------------------------------------------------------------
// Saved (favourites)
// ---------------------------------------------------------------------------

export function loadSaved(storage: StorageLike | null = defaultStorage()): StoredDestination[] {
  return readList(storage, SAVED_KEY);
}

export function saveDest(
  seed: DestinationSeed,
  storage: StorageLike | null = defaultStorage(),
): StoredDestination[] {
  return writeList(storage, SAVED_KEY, merge(readList(storage, SAVED_KEY), seed, SAVED_CAP));
}

export function unsaveDest(
  seed: DestinationSeed,
  storage: StorageLike | null = defaultStorage(),
): StoredDestination[] {
  const key = destKey(seed);
  return writeList(
    storage,
    SAVED_KEY,
    readList(storage, SAVED_KEY).filter((d) => destKey(d) !== key),
  );
}

export function isSaved(seed: DestinationSeed, storage: StorageLike | null = defaultStorage()): boolean {
  const key = destKey(seed);
  return readList(storage, SAVED_KEY).some((d) => destKey(d) === key);
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/**
 * Coordinates the way the rows show them: latitude first, the way the
 * island's places are quoted, both to 5 dp so the row matches the dedupe key.
 */
export function formatCoordPair(lon: number, lat: number): string {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

/**
 * Compact "how long ago" for the rows. Elapsed time leads while it still says
 * something useful, then the calendar day, then an absolute date - a favourite
 * from months back reads better as "5 Jan 2026" than as "9 months ago".
 * Pure: the caller passes `now`, so tests need not mock the clock.
 */
export function relativeWhen(at: number, now: number = Date.now()): string {
  // An unreadable stamp must not masquerade as "just now": that would make a
  // corrupt record look fresher than it is. Fall back to blank.
  if (!Number.isFinite(at) || !Number.isFinite(now)) return "";
  const elapsed = now - at;
  // A stamp ahead of `now` (clock skew) clamps to "just now", never "-1 min".
  if (elapsed < 60_000) return "just now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} min ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} hr ago`;
  if (calendarDaysApart(at, now) <= 1) return "yesterday";
  const d = new Date(at);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Whole calendar days between two instants, in the viewer's local time. */
function calendarDaysApart(a: number, b: number): number {
  const da = new Date(a);
  const db = new Date(b);
  const ua = Date.UTC(da.getFullYear(), da.getMonth(), da.getDate());
  const ub = Date.UTC(db.getFullYear(), db.getMonth(), db.getDate());
  return Math.round((ub - ua) / 86_400_000);
}
