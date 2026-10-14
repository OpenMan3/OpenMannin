import type { LayerDef } from "./types";

/**
 * The MapLibre source descriptor for a registry layer, or null when the layer
 * has no PMTiles archive and should fall back to its GeoJSON file.
 *
 * Kept as a pure function (no imports beyond the type) so it can be unit
 * tested without the TypeScript path alias or a browser.
 */
export function pmtilesSource(def: Pick<LayerDef, "pmtiles">): { type: "vector"; url: string } | null {
  if (!def.pmtiles) return null;
  const path = def.pmtiles.replace(/^\/+/, "");
  return { type: "vector", url: `pmtiles:///${path}` };
}
