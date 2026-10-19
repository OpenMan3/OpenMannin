"use client";

/**
 * React binding for the language preference.
 *
 * `t()` (src/lib/i18n.ts) reads the stored language at call time, but a plain
 * call gives React nothing to subscribe to: a component that renders `t("x")`
 * keeps the old string when the language changes. This hook subscribes to the
 * `openmannin:lang` event and returns the current language, so any component
 * that reads it re-renders on a switch and its `t()` calls pick up the new
 * value. It mirrors the storage reads done by the pure module, degrading to
 * "en" the same way.
 */

import { useEffect, useState } from "react";
import { LANG_EVENT, parseLang, readLang, type Lang } from "@/lib/i18n";

export function useLang(): Lang {
  const [lang, setLang] = useState<Lang>("en");

  useEffect(() => {
    setLang(readLang());
    const onLangChange = (event: Event) => {
      const detail = (event as CustomEvent<{ lang?: unknown }>).detail;
      setLang(parseLang(detail?.lang as string | undefined));
    };
    window.addEventListener(LANG_EVENT, onLangChange);
    return () => window.removeEventListener(LANG_EVENT, onLangChange);
  }, []);

  return lang;
}
