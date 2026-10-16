/**
 * Unit tests for the theme logic (src/lib/theme.ts).
 *
 * These pin the two things a bug would be felt as: a saved preference that
 * resolves to the wrong colour, and a corrupt/absent localStorage value that
 * throws instead of quietly falling back to "system". Pure, so it runs under
 * `node --test`.
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  DARK_STYLE_URL,
  LIGHT_STYLE_URL,
  THEME_STORAGE_KEY,
  applyThemeToDocument,
  describeTheme,
  nextThemePref,
  parseThemePref,
  readThemePref,
  resolveTheme,
  writeThemePref,
} from "../../src/lib/theme.ts";

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

/** A document stub with just classList/style, enough for applyThemeToDocument. */
function fakeDocument() {
  const classes = new Set();
  return {
    documentElement: {
      classList: {
        toggle: (name, force) => {
          const on = force === undefined ? !classes.has(name) : force;
          if (on) classes.add(name);
          else classes.delete(name);
          return on;
        },
        contains: (name) => classes.has(name),
      },
      style: {},
    },
  };
}

test("resolveTheme honours explicit light and dark over the OS", () => {
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(resolveTheme("light", false), "light");
  assert.equal(resolveTheme("dark", true), "dark");
  assert.equal(resolveTheme("dark", false), "dark");
});

test("resolveTheme follows the OS for system", () => {
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
});

test("nextThemePref cycles system -> light -> dark -> system", () => {
  assert.equal(nextThemePref("system"), "light");
  assert.equal(nextThemePref("light"), "dark");
  assert.equal(nextThemePref("dark"), "system");
});

test("parseThemePref accepts the three values and rejects everything else", () => {
  assert.equal(parseThemePref("light"), "light");
  assert.equal(parseThemePref("dark"), "dark");
  assert.equal(parseThemePref("system"), "system");
  assert.equal(parseThemePref("banana"), "system");
  assert.equal(parseThemePref(""), "system");
  assert.equal(parseThemePref(null), "system");
  assert.equal(parseThemePref(undefined), "system");
});

test("describeTheme names the preference, not the resolved colour", () => {
  assert.equal(describeTheme("system"), "Theme: system");
  assert.equal(describeTheme("light"), "Theme: light");
  assert.equal(describeTheme("dark"), "Theme: dark");
});

test("applyThemeToDocument toggles the dark class and color-scheme", () => {
  const doc = fakeDocument();
  const root = doc.documentElement;

  applyThemeToDocument(doc, true);
  assert.equal(root.classList.contains("dark"), true);
  assert.equal(root.style.colorScheme, "dark");

  applyThemeToDocument(doc, false);
  assert.equal(root.classList.contains("dark"), false);
  assert.equal(root.style.colorScheme, "light");
});

test("readThemePref round-trips a written preference", () => {
  const storage = fakeStorage();
  writeThemePref("dark", storage);
  assert.equal(storage.getItem(THEME_STORAGE_KEY), "dark");
  assert.equal(readThemePref(storage), "dark");
});

test("readThemePref returns system for absent, corrupt and SSR storage", () => {
  assert.equal(readThemePref(fakeStorage()), "system");
  assert.equal(readThemePref(fakeStorage({ [THEME_STORAGE_KEY]: "banana" })), "system");
  assert.equal(readThemePref(null), "system", "no storage (SSR) falls back to system");
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
  assert.equal(readThemePref(hostile), "system");
  assert.doesNotThrow(() => writeThemePref("dark", hostile));
});

test("style URLs point at the keyless OpenFreeMap light and dark styles", () => {
  assert.equal(LIGHT_STYLE_URL, "https://tiles.openfreemap.org/styles/liberty");
  assert.equal(DARK_STYLE_URL, "https://tiles.openfreemap.org/styles/dark");
});
