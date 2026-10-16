"use client";

/**
 * ThemeToggle — a three-state cycle: system → light → dark → system.
 *
 * The preference lives in localStorage (via src/lib/theme.ts) and the visual
 * class on <html> is owned by the bootstrap script in layout.tsx. This button
 * only ever changes the preference and applies the resulting class; it never
 * guesses the theme from props, so it is safe to mount anywhere. While the
 * preference is "system" the icon shows what the OS currently resolves to,
 * and the title/aria-label name the preference so keyboard and screen-reader
 * users can tell "system" from an explicit light/dark pick.
 *
 * A change also fires `openmannin:theme` on window — the map subscribes to it
 * and swaps its basemap. That keeps this component free of any map import.
 */

import { useEffect, useState } from "react";
import {
  applyThemeToDocument,
  describeTheme,
  nextThemePref,
  readThemePref,
  resolveTheme,
  writeThemePref,
  type ThemePref,
} from "@/lib/theme";

/** The one DOM read that has no meaning on the server. */
function systemPrefersDark(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function ThemeToggle({ className }: { className?: string }) {
  // SSR/CSR agree until mount: both start on a neutral "system/light" render,
  // then the effect syncs from storage. The pre-hydration class is set by the
  // bootstrap script, not by this component, so there is nothing to mismatch.
  const [mounted, setMounted] = useState(false);
  const [pref, setPref] = useState<ThemePref>("system");
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const stored = readThemePref();
    const isDark = resolveTheme(stored, systemPrefersDark()) === "dark";
    setPref(stored);
    setDark(isDark);
    setMounted(true);

    // If the OS flips while the preference is "system", follow it live and let
    // the map know, exactly as a manual change would.
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystemChange = () => {
      if (readThemePref() !== "system") return;
      const nextDark = mq.matches;
      setDark(nextDark);
      applyThemeToDocument(document, nextDark);
      window.dispatchEvent(
        new CustomEvent("openmannin:theme", { detail: { dark: nextDark, pref: "system" } }),
      );
    };
    mq.addEventListener("change", onSystemChange);
    return () => mq.removeEventListener("change", onSystemChange);
  }, []);

  function cycle() {
    const next = nextThemePref(pref);
    const nextDark = resolveTheme(next, systemPrefersDark()) === "dark";
    writeThemePref(next);
    applyThemeToDocument(document, nextDark);
    setPref(next);
    setDark(nextDark);
    window.dispatchEvent(
      new CustomEvent("openmannin:theme", { detail: { dark: nextDark, pref: next } }),
    );
  }

  const label = describeTheme(pref);
  // "system" mirrors the OS; an explicit preference shows its own icon.
  const showMoon = pref === "system" ? dark : pref === "dark";

  return (
    <button
      type="button"
      onClick={cycle}
      className={className ?? "btn-icon"}
      aria-label={label}
      title={`${label} — click to cycle light / dark / system`}
    >
      {/* Before mount we cannot know the state, so show the neutral "auto"
       * mark — the same shape the server rendered. */}
      {!mounted ? (
        <AutoIcon className="h-5 w-5" />
      ) : showMoon ? (
        <MoonIcon className="h-5 w-5" />
      ) : (
        <SunIcon className="h-5 w-5" />
      )}
    </button>
  );
}

/* Inline icons: three states, drawn with currentColor so they inherit the
 * button's text colour in both themes. Kept local rather than in Icons.tsx so
 * the toggle is self-contained. */

function SunIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

function MoonIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function AutoIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none" />
    </svg>
  );
}
