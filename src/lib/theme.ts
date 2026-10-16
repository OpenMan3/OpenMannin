/**
 * Theme preference: the single source of truth for colour scheme and basemap.
 *
 * The user picks one of three preferences — "system" (follow the OS), "light"
 * or "dark" — stored under `om:theme` in localStorage. "system" resolves
 * against `prefers-color-scheme` at read time, so a device that flips from day
 * to night and a user who has never opened the toggle both behave sensibly.
 *
 * PURE and dependency-free: nothing here imports the DOM or React, so the
 * logic is testable under `node --test` and safe to import from a Server
 * Component or a render-blocking inline script. The DOM-touching helpers take
 * the document / storage as arguments rather than reaching for globals.
 *
 * OpenFreeMap publishes a matching dark basemap keyless alongside Liberty, so
 * a resolved theme maps 1:1 onto a style URL — the map and the chrome change
 * colour together rather than the panels going dark over a bright basemap.
 */

export type ThemePref = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

/** localStorage key. Namespaced so it cannot collide with another app's data. */
export const THEME_STORAGE_KEY = "om:theme";

/**
 * OpenFreeMap styles, both keyless and CORS-open. Liberty is the light basemap
 * chosen in the five-style evaluation (see map-style.ts); "dark" is the
 * publisher's matching night style, selected for the same legibility reasons.
 */
export const LIGHT_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
export const DARK_STYLE_URL = "https://tiles.openfreemap.org/styles/dark";

/**
 * The minimum surface of localStorage this module needs. Injected so tests can
 * pass a stub, and so a future cookie- or memory-backed store needs no change.
 */
export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Collapse a stored preference plus the OS setting into the theme actually
 * shown. "system" is deliberately resolved to light/dark here, once, so the
 * rest of the app only ever deals in two states.
 */
export function resolveTheme(pref: ThemePref, prefersDark: boolean): ResolvedTheme {
  if (pref === "dark") return "dark";
  if (pref === "light") return "light";
  return prefersDark ? "dark" : "light";
}

/** Validate a raw stored string, falling back to "system" on anything else. */
export function parseThemePref(value: string | null | undefined): ThemePref {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

/** The next preference in the toggle's cycle: system → light → dark → system. */
export function nextThemePref(pref: ThemePref): ThemePref {
  if (pref === "system") return "light";
  if (pref === "light") return "dark";
  return "system";
}

/**
 * Accessible label for a preference. Used verbatim as the toggle's aria-label
 * and title prefix, so it states the preference (not just the resolved colour)
 * and a screen-reader user can tell "system" apart from an explicit pick.
 */
export function describeTheme(pref: ThemePref): string {
  switch (pref) {
    case "light":
      return "Theme: light";
    case "dark":
      return "Theme: dark";
    default:
      return "Theme: system";
  }
}

/**
 * Read the stored preference. SSR-safe: with no storage and no `window` it
 * returns "system". A storage that throws (private mode, quota, disabled
 * cookies) and a corrupt value both degrade to "system" rather than throwing.
 */
export function readThemePref(storage?: ThemeStorage | null): ThemePref {
  try {
    const store =
      storage ?? (typeof window !== "undefined" ? window.localStorage : null);
    if (!store) return "system";
    return parseThemePref(store.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

/** Persist a preference. Best-effort: a write failure never breaks the toggle. */
export function writeThemePref(pref: ThemePref, storage?: ThemeStorage | null): void {
  try {
    const store =
      storage ?? (typeof window !== "undefined" ? window.localStorage : null);
    if (!store) return;
    store.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    /* Private mode / quota — the in-memory state still drives this session. */
  }
}

/**
 * Toggle the `dark` class on the document root. globals.css keys the whole dark
 * palette and `color-scheme` off `html.dark`, so the class is the one switch
 * that matters. We also set `style.colorScheme` directly as belt-and-braces:
 * the render-blocking bootstrap script in layout.tsx runs this before the
 * stylesheet has necessarily applied, and native form controls / scrollbars
 * pick it up immediately.
 */
export function applyThemeToDocument(
  doc: Pick<Document, "documentElement">,
  dark: boolean,
): void {
  const root = doc.documentElement;
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
}
