"use client";

/**
 * Basemap theme toggle: light/dark mode for the basemap.
 *
 * Each basemap has a light and dark variant. This component toggles between
 * the two for the currently selected basemap.
 */

import { useEffect, useState } from "react";
import type { BasemapId } from "@/components/MapView";
import { MoonIcon, SunIcon } from "./Icons";

const THEME_KEY = "om:basemapTheme";

type Theme = "light" | "dark";

function darkVariant(id: BasemapId): BasemapId {
  if (id.endsWith("-dark")) return id;
  return `${id}-dark` as BasemapId;
}

function lightVariant(id: BasemapId): BasemapId {
  if (id.endsWith("-dark")) return id.slice(0, -5) as BasemapId;
  return id;
}

interface BasemapToggleProps {
  basemap: BasemapId;
  onBasemapChange: (id: BasemapId) => void;
}

export function BasemapToggle({ basemap, onBasemapChange }: BasemapToggleProps) {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === "undefined") return "light";
    return (localStorage.getItem(THEME_KEY) as Theme) ?? "light";
  });

  const isDark = basemap.endsWith("-dark");

  useEffect(() => {
    // Sync local state with the actual basemap
    setTheme(basemap.endsWith("-dark") ? "dark" : "light");
  }, [basemap]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(THEME_KEY, theme);
    }
  }, [theme]);

  const target = isDark ? lightVariant(basemap) : darkVariant(basemap);

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