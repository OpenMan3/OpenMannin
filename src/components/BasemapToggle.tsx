"use client";

/**
 * Basemap theme toggle: light/dark mode for the basemap.
 *
 * Of the two basemap families this app serves, OpenFreeMap ships a light
 * (Liberty) and a dark style, so it is the one a theme toggle can affect.
 * OpenTopoMap is raster-only and has no dark twin, so the toggle hides
 * itself when that basemap is active. The OpenStreetMap standard tiles were
 * removed (their usage policy is incompatible); OpenFreeMap serves the same
 * ODbL road data under a style this app may use freely.
 */

import { useEffect, useState } from "react";
import type { BasemapId } from "@/components/MapView";
import { MoonIcon, SunIcon } from "./Icons";

const THEME_KEY = "om:basemapTheme";

type Theme = "light" | "dark";

export function BasemapToggle({
  basemap,
  onBasemapChange,
}: {
  basemap: BasemapId;
  onBasemapChange: (id: BasemapId) => void;
}) {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === "undefined") return "light";
    return (localStorage.getItem(THEME_KEY) as Theme) ?? "light";
  });

  const isDark = basemap === "openfreemap-dark";
  // Only OpenFreeMap has a dark twin; OpenTopoMap is raster-only.
  const canTheme = basemap === "openfreemap" || basemap === "openfreemap-dark";

  useEffect(() => {
    setTheme(isDark ? "dark" : "light");
  }, [basemap, isDark]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(THEME_KEY, theme);
    }
  }, [theme]);

  if (!canTheme) return null;

  const target = isDark ? "openfreemap" : "openfreemap-dark";

  const handleToggle = () => {
    setTheme((prev) => (prev === "light" ? "dark" : "light"));
    onBasemapChange(target);
  };

  return (
    <button
      type="button"
      onClick={handleToggle}
      aria-label={`Switch to ${theme === "light" ? "dark" : "light"} basemap`}
      title={`Switch to ${theme === "light" ? "dark" : "light"} basemap`}
      className="btn-icon !h-8 !w-8 relative transition-colors"
    >
      {theme === "light" ? (
        <MoonIcon className="h-4 w-4" />
      ) : (
        <SunIcon className="h-4 w-4" />
      )}
    </button>
  );
}