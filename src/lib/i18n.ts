/**
 * Language preference: the single source of truth for the UI locale.
 *
 * The user picks either English ("en", the source of truth) or Manx Gaelic
 * ("gv"). The choice is stored under `om:lang` in localStorage. Anything
 * unreadable — absent, corrupt, a storage that throws — degrades to "en"
 * rather than throwing, mirroring src/lib/theme.ts.
 *
 * PURE and dependency-free: nothing here imports the DOM or React, so the
 * logic is testable under `node --test` and safe to import from a Server
 * Component. The DOM-touching helpers take the storage as an argument rather
 * than reaching for a global.
 *
 * A change fires `openmannin:lang` on window with `{ lang }` in the detail —
 * the toggle dispatches it and any screen can subscribe to re-render. That
 * keeps the toggle free of any screen import.
 */

import { CATALOG } from "./i18n-catalog.ts";

export type Lang = "en" | "gv";

/** localStorage key. Namespaced so it cannot collide with another app's data. */
export const LANG_STORAGE_KEY = "om:lang";

/** Window event fired whenever the language changes. Detail: `{ lang: Lang }`. */
export const LANG_EVENT = "openmannin:lang";

/**
 * The minimum surface of localStorage this module needs. Injected so tests can
 * pass a stub, and so a future cookie- or memory-backed store needs no change.
 */
export interface LangStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Validate a raw stored string, falling back to English on anything else. */
export function parseLang(value: string | null | undefined): Lang {
  return value === "gv" ? "gv" : "en";
}

/** The next language in the toggle's cycle: en → gv → en. */
export function nextLang(lang: Lang): Lang {
  return lang === "gv" ? "en" : "gv";
}

/**
 * Accessible, human-readable name of a language. Used verbatim as the toggle's
 * aria-label and the prefix of its title, in the language's own endonym.
 */
export function describeLang(lang: Lang): string {
  return lang === "gv" ? "Gaelg" : "English";
}

/**
 * Read the stored language. SSR-safe: with no storage and no `window` it
 * returns "en". A storage that throws (private mode, quota, disabled cookies)
 * and a corrupt value both degrade to English rather than throwing.
 */
export function readLang(storage?: LangStorage | null): Lang {
  try {
    const store =
      storage ?? (typeof window !== "undefined" ? window.localStorage : null);
    if (!store) return "en";
    return parseLang(store.getItem(LANG_STORAGE_KEY));
  } catch {
    return "en";
  }
}

/** Persist a language. Best-effort: a write failure never breaks the toggle. */
export function writeLang(lang: Lang, storage?: LangStorage | null): void {
  try {
    const store =
      storage ?? (typeof window !== "undefined" ? window.localStorage : null);
    if (!store) return;
    store.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    /* Private mode / quota — the in-memory state still drives this session. */
  }
}

/**
 * Substitute `{name}` placeholders. Unknown placeholders are left untouched so
 * a typo shows up as `{name}` in the UI instead of silently vanishing.
 */
function interpolate(
  template: string,
  params?: Record<string, string | number>,
): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name)
      ? String(params[name])
      : match,
  );
}

/**
 * Translate a catalog key into the currently selected language. English is the
 * source of truth: an unknown key returns the key itself (so a missing string
 * is visible, not blank), and a known key with no Manx text falls back to its
 * English value.
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const entry = CATALOG[key];
  if (!entry) return interpolate(key, params);
  const lang = readLang();
  const template = lang === "gv" && entry.gv ? entry.gv : entry.en;
  return interpolate(template, params);
}
