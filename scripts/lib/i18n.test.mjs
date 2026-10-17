/**
 * Unit tests for the language logic (src/lib/i18n.ts) and the catalog
 * (src/lib/i18n-catalog.ts).
 *
 * These pin the behaviours a bug would be felt as: a corrupt/absent
 * localStorage value that should fall back to English, a missing key that
 * should show the key rather than blank, an unreviewed Manx string that is
 * empty, and a cycle that gets stuck. Pure, so it runs under `node --test`.
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  LANG_EVENT,
  LANG_STORAGE_KEY,
  describeLang,
  nextLang,
  parseLang,
  readLang,
  t,
  writeLang,
} from "../../src/lib/i18n.ts";
import { CATALOG, langLabel } from "../../src/lib/i18n-catalog.ts";

/** A localStorage stub over a Map, with optional seeds. */
function fakeStorage(seed) {
  const map = new Map(Object.entries(seed ?? {}));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value));
    },
  };
}

/** Run `fn` with a fake window.localStorage seeded to a language, then clean up. */
function withWindowLang(lang, fn) {
  globalThis.window = { localStorage: fakeStorage({ [LANG_STORAGE_KEY]: lang }) };
  try {
    return fn();
  } finally {
    delete globalThis.window;
  }
}

test("event and storage names are the shared contract", () => {
  assert.equal(LANG_STORAGE_KEY, "om:lang");
  assert.equal(LANG_EVENT, "openmannin:lang");
});

test("parseLang accepts en/gv and rejects everything else", () => {
  assert.equal(parseLang("en"), "en");
  assert.equal(parseLang("gv"), "gv");
  assert.equal(parseLang("ga"), "en");
  assert.equal(parseLang("GV"), "en");
  assert.equal(parseLang(""), "en");
  assert.equal(parseLang(null), "en");
  assert.equal(parseLang(undefined), "en");
});

test("nextLang cycles en -> gv -> en", () => {
  assert.equal(nextLang("en"), "gv");
  assert.equal(nextLang("gv"), "en");
});

test("describeLang names the language in its own tongue", () => {
  assert.equal(describeLang("en"), "English");
  assert.equal(describeLang("gv"), "Gaelg");
});

test("langLabel returns the short toggle code", () => {
  assert.equal(langLabel("en"), "EN");
  assert.equal(langLabel("gv"), "GV");
});

test("readLang/writeLang round-trip through the injected storage", () => {
  const storage = fakeStorage();
  writeLang("gv", storage);
  assert.equal(storage.getItem(LANG_STORAGE_KEY), "gv");
  assert.equal(readLang(storage), "gv");
});

test("readLang returns en for absent, corrupt and SSR storage", () => {
  assert.equal(readLang(fakeStorage()), "en");
  assert.equal(readLang(fakeStorage({ [LANG_STORAGE_KEY]: "fr" })), "en");
  assert.equal(readLang(null), "en", "no storage (SSR) falls back to en");
});

test("storage failures never throw", () => {
  const hostile = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  assert.equal(readLang(hostile), "en");
  assert.doesNotThrow(() => writeLang("gv", hostile));
});

test("t returns the English string for a known key", () => {
  assert.equal(t("app.save"), "Save");
  assert.equal(t("tab.layers"), "Layers");
});

test("t returns the key itself for an unknown key", () => {
  assert.equal(t("does.not.exist"), "does.not.exist");
});

test("t interpolates {name}-style params", () => {
  assert.equal(t("status.updatedAt", { time: "12:00" }), "Updated 12:00");
});

test("t leaves unknown placeholders untouched", () => {
  assert.equal(t("status.updatedAt", { when: "now" }), "Updated {time}");
});

test("t returns Manx for a known key when the language is gv", () => {
  withWindowLang("gv", () => {
    assert.equal(t("app.close"), "Dooney");
    assert.equal(t("status.updatedAt", { time: "12:00" }), "Er ny noaaghey 12:00");
  });
  // Window removed: back to the English source of truth.
  assert.equal(t("app.close"), "Close");
});

test("CATALOG entries are complete and unique", () => {
  const entries = Object.entries(CATALOG);
  // A sanity floor, not a target: it catches a wholesale accidental wipe of the
  // catalog. It is deliberately below the current key count so retiring a single
  // string (e.g. the unused GPX `app.import`) does not require editing the test.
  assert.ok(entries.length >= 35, `expected >= 35 keys, got ${entries.length}`);

  const seen = new Set();
  for (const [key, value] of entries) {
    assert.equal(seen.has(key), false, `duplicate key: ${key}`);
    seen.add(key);
    assert.ok(key.trim().length > 0, "empty key");
    assert.equal(typeof value.en, "string", `${key} en must be a string`);
    assert.ok(value.en.trim().length > 0, `${key} has empty en`);
    assert.equal(typeof value.gv, "string", `${key} gv must be a string`);
    assert.ok(value.gv.trim().length > 0, `${key} has empty gv`);
  }
});
