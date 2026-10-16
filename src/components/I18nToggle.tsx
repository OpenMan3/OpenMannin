"use client";

/**
 * I18nToggle — a two-state cycle: English ("EN") → Manx ("GV") → English.
 *
 * The preference lives in localStorage (via src/lib/i18n.ts); this button only
 * ever changes it and announces the change. It reads the stored value on mount
 * and re-reads it whenever another screen fires `openmannin:lang`, so multiple
 * toggles stay in step. The face shows the short code and the title/aria-label
 * name the language, so keyboard and screen-reader users hear "Gaelg" rather
 * than "GV".
 *
 * SSR-safe: the first render body never touches window. The server and the
 * first client render both show the default "EN"; the mount effect then syncs
 * from storage, which is a plain post-hydration state update with nothing to
 * mismatch.
 */

import { useEffect, useState } from "react";
import { langLabel } from "@/lib/i18n-catalog";
import {
  LANG_EVENT,
  describeLang,
  nextLang,
  parseLang,
  readLang,
  writeLang,
  type Lang,
} from "@/lib/i18n";

export function I18nToggle({ className }: { className?: string }) {
  const [lang, setLang] = useState<Lang>("en");

  useEffect(() => {
    setLang(readLang());

    // Another toggle (or any screen) may change the language; mirror it.
    const onLangChange = (event: Event) => {
      const detail = (event as CustomEvent<{ lang?: unknown }>).detail;
      setLang(parseLang(detail?.lang as string | undefined));
    };
    window.addEventListener(LANG_EVENT, onLangChange);
    return () => window.removeEventListener(LANG_EVENT, onLangChange);
  }, []);

  function cycle() {
    const next = nextLang(lang);
    writeLang(next);
    setLang(next);
    window.dispatchEvent(
      new CustomEvent(LANG_EVENT, { detail: { lang: next } }),
    );
  }

  const label = describeLang(lang);

  return (
    <button
      type="button"
      onClick={cycle}
      className={className ?? "btn-icon"}
      aria-label={label}
      title={`${label} — click to switch English / Gaelg`}
    >
      <span className="text-xs font-semibold tracking-wide">
        {langLabel(lang)}
      </span>
    </button>
  );
}
