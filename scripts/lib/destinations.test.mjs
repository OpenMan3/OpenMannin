/**
 * Unit tests for saved & recent destinations (src/lib/destinations.ts).
 *
 * The list rules are pure, so they run under `node --test` against an object
 * literal standing in for localStorage - including the ways a real store
 * misbehaves: corrupt JSON, values that are not arrays, rows of the wrong
 * shape, and a store that throws on every call.
 *
 * NOTE: this file is plain JS (.mjs) on purpose - `--experimental-strip-types`
 * applies to the imported .ts sources, but the test file itself must not use
 * TypeScript syntax.
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  RECENT_CAP,
  RECENT_KEY,
  SAVED_CAP,
  SAVED_KEY,
  clearRecent,
  destKey,
  formatCoordPair,
  isSaved,
  loadRecent,
  loadSaved,
  recordRecent,
  relativeWhen,
  saveDest,
  unsaveDest,
} from "../../src/lib/destinations.ts";

/** localStorage stand-in: the injected store the API is built around. */
function fakeStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    raw() {
      return Object.fromEntries(map);
    },
  };
}

/** A destination with a deterministic timestamp. */
function place(title, lon, lat, at) {
  return { lon, lat, title, detail: "Isle of Man", at };
}

test("lists read as empty when there is no store (SSR has no window)", () => {
  assert.deepEqual(loadRecent(), []);
  assert.deepEqual(loadSaved(), []);
  assert.doesNotThrow(() => recordRecent(place("Douglas", -4.4814, 54.1509, 1)));
  assert.doesNotThrow(() => clearRecent());
});

test("recordRecent keeps the newest visit first and persists under om:destinations.recent", () => {
  const store = fakeStorage();
  recordRecent(place("Douglas", -4.4814, 54.1509, 1), store);
  const list = recordRecent(place("Ramsey", -4.3838, 54.3772, 2), store);

  assert.deepEqual(
    list.map((d) => d.title),
    ["Ramsey", "Douglas"],
  );
  assert.deepEqual(
    loadRecent(store).map((d) => d.title),
    ["Ramsey", "Douglas"],
  );
  assert.ok(Object.prototype.hasOwnProperty.call(store.raw(), RECENT_KEY));
  assert.equal(store.raw()[SAVED_KEY], undefined, "recents never touch the saved key");
});

test("a repeat visit moves the entry forward and refreshes its timestamp", () => {
  const store = fakeStorage();
  recordRecent(place("Douglas", -4.4814, 54.1509, 1), store);
  recordRecent(place("Peel", -4.6878, 54.1754, 2), store);

  const list = recordRecent(place("Douglas", -4.4814, 54.1509, 3), store);
  assert.deepEqual(
    list.map((d) => d.title),
    ["Douglas", "Peel"],
    "no duplicate stacked on the front",
  );
  assert.equal(list[0].at, 3, "timestamp refreshed to the latest visit");
});

test("dedupe rounds coordinates to 5 dp", () => {
  const store = fakeStorage();
  recordRecent(place("Douglas", -4.4814, 54.1509, 1), store);

  // ~4e-7 of a degree away: same place once rounded.
  const jittered = recordRecent(place("Douglas", -4.4814004, 54.1509004, 2), store);
  assert.equal(jittered.length, 1, "sub-metre jitter is the same destination");
  assert.equal(jittered[0].at, 2);

  // ~6e-4 of a degree away: past the rounding, so a second entry.
  const moved = recordRecent(place("Douglas", -4.482, 54.1509, 3), store);
  assert.equal(moved.length, 2, "a different street is a different destination");
});

test("same coordinates with a different title stay separate", () => {
  const store = fakeStorage();
  recordRecent(place("Douglas Head", -4.4814, 54.1509, 1), store);
  const list = recordRecent(place("Douglas Harbour", -4.4814, 54.1509, 2), store);

  assert.equal(list.length, 2);
  assert.deepEqual(
    list.map((d) => d.title),
    ["Douglas Harbour", "Douglas Head"],
  );
});

test("the recent list is capped at 8, newest first, oldest dropped", () => {
  const store = fakeStorage();
  for (let i = 0; i < RECENT_CAP + 2; i++) {
    recordRecent(place(`Place ${i}`, -4.5 + i * 0.001, 54.15, i + 1), store);
  }

  const list = loadRecent(store);
  assert.equal(list.length, RECENT_CAP);
  assert.equal(list[0].title, "Place 9");
  assert.equal(list[list.length - 1].title, "Place 2", "the two oldest fell off");
});

test("the saved list is capped at 30 and also dedupes", () => {
  const store = fakeStorage();
  for (let i = 0; i < SAVED_CAP + 5; i++) {
    saveDest(place(`Spot ${i}`, -4.5 + i * 0.01, 54.15, i + 1), store);
  }
  assert.equal(loadSaved(store).length, SAVED_CAP);

  // Re-saving one of the survivors must not grow the list.
  saveDest(place("Spot 34", -4.5 + 34 * 0.01, 54.15, 99), store);
  const list = loadSaved(store);
  assert.equal(list.length, SAVED_CAP);
  assert.equal(list[0].title, "Spot 34", "re-saving moves it to the front");
  assert.equal(list[0].at, 99);
});

test("saveDest, isSaved and unsaveDest round-trip on rounded coords + title", () => {
  const store = fakeStorage();
  saveDest(place("Douglas", -4.4814, 54.1509, 5), store);

  assert.equal(isSaved(place("Douglas", -4.4814, 54.1509, 0), store), true);
  assert.equal(isSaved(place("Ramsey", -4.4814, 54.1509, 0), store), false, "title differs");
  assert.equal(isSaved(place("Douglas", -4.4824, 54.1509, 0), store), false, "coords differ");

  // Unsave through the same rounding the dedupe uses.
  const rest = unsaveDest(place("Douglas", -4.4814003, 54.1509002, 0), store);
  assert.deepEqual(rest, []);
  assert.equal(isSaved(place("Douglas", -4.4814, 54.1509, 0), store), false);
  assert.equal(loadSaved(store).length, 0);
});

test("clearRecent empties recents but leaves saved alone", () => {
  const store = fakeStorage();
  recordRecent(place("Douglas", -4.4814, 54.1509, 1), store);
  saveDest(place("Ramsey", -4.3838, 54.3772, 2), store);

  clearRecent(store);
  assert.deepEqual(loadRecent(store), []);
  assert.equal(loadSaved(store).length, 1);
});

test("corrupt or foreign storage reads as an empty list", () => {
  const store = fakeStorage({
    [RECENT_KEY]: "{not json",
    [SAVED_KEY]: JSON.stringify({ places: [] }),
  });
  assert.deepEqual(loadRecent(store), []);
  assert.deepEqual(loadSaved(store), []);

  const nonArray = fakeStorage({ [RECENT_KEY]: "42" });
  assert.deepEqual(loadRecent(nonArray), []);
});

test("malformed rows are dropped instead of reaching the UI", () => {
  const store = fakeStorage({
    [RECENT_KEY]: JSON.stringify([
      { lon: "west", lat: 54.15, title: "Bad", at: 1 },
      { lon: -4.4814, lat: 54.1509, title: "Good", at: 2 },
      { lon: -4.4814, lat: 54.1509, title: "No timestamp" },
      null,
      "nope",
    ]),
  });

  const list = loadRecent(store);
  assert.equal(list.length, 1);
  assert.equal(list[0].title, "Good");
});

test("a store that throws on every call never escapes as an error", () => {
  const broken = {
    getItem() {
      throw new Error("storage blocked");
    },
    setItem() {
      throw new Error("quota");
    },
  };

  assert.deepEqual(loadRecent(broken), []);
  assert.deepEqual(loadSaved(broken), []);

  let list;
  assert.doesNotThrow(() => {
    list = recordRecent(place("Douglas", -4.4814, 54.1509, 1), broken);
  });
  assert.deepEqual(
    list.map((d) => d.title),
    ["Douglas"],
    "the in-memory list still works when nothing persists",
  );
  assert.doesNotThrow(() => saveDest(place("Douglas", -4.4814, 54.1509, 1), broken));
  assert.doesNotThrow(() => clearRecent(broken));
});

test("destKey rounds to 5 dp before comparing", () => {
  assert.equal(
    destKey({ lon: -4.4814001, lat: 54.1509004, title: "Douglas" }),
    destKey({ lon: -4.4814, lat: 54.1509, title: "Douglas" }),
  );
  assert.notEqual(
    destKey({ lon: -4.4814, lat: 54.1509, title: "Douglas" }),
    destKey({ lon: -4.4814, lat: 54.1509, title: "Ramsey" }),
  );
});

test("an absent timestamp is stamped at record time", () => {
  const store = fakeStorage();
  const before = Date.now();
  const [row] = recordRecent({ lon: -4.4814, lat: 54.1509, title: "Douglas" }, store);
  const after = Date.now();

  assert.ok(row.at >= before && row.at <= after, `at ${row.at} within [${before}, ${after}]`);
  assert.equal(row.detail, undefined, "no detail was supplied");
});

test("formatCoordPair prints latitude first, both to 5 dp", () => {
  assert.equal(formatCoordPair(-4.4814, 54.1509), "54.15090, -4.48140");
  assert.equal(formatCoordPair(0, 0), "0.00000, 0.00000");
});

test("relativeWhen steps through minutes, hours, yesterday and dates", () => {
  const now = new Date(2026, 9, 16, 12, 0, 0).getTime();

  assert.equal(relativeWhen(now, now), "just now");
  assert.equal(relativeWhen(now - 45_000, now), "just now");
  assert.equal(relativeWhen(now - 120_000, now), "2 min ago");
  assert.equal(relativeWhen(now - 59 * 60_000, now), "59 min ago");
  assert.equal(relativeWhen(now - 3 * 3_600_000, now), "3 hr ago");
  assert.equal(relativeWhen(now - 23 * 3_600_000, now), "23 hr ago");
  assert.equal(relativeWhen(new Date(2026, 9, 15, 12, 0, 0).getTime(), now), "yesterday");
  assert.equal(relativeWhen(new Date(2026, 9, 14, 12, 0, 0).getTime(), now), "14 Oct 2026");
  assert.equal(relativeWhen(new Date(2026, 0, 5, 9, 30, 0).getTime(), now), "5 Jan 2026");
  // A stamp ahead of the clock (skew) reads as "just now", never a negative.
  assert.equal(relativeWhen(now + 600_000, now), "just now");
});
