/**
 * Geometry guards for the split paint layers.
 *
 * A static layer is drawn by up to four MapLibre layers (fill, line, circle,
 * symbol). Registering a layer type that does not match a feature's geometry is
 * NOT a no-op: a circle layer draws every line vertex as a dot and a fill layer
 * closes the path into a polygon, which turned roads, footpaths and power-lines
 * into dots and boxes. Each paint layer therefore carries a `geometry-type`
 * filter restricting it to the geometry it can actually draw.
 *
 * This lives apart from map-layers.ts (which imports browser-only modules) so
 * the guards can be exercised directly in the unit tests.
 */

import type { FilterSpecification } from "maplibre-gl";

/** Every paint layer suffix a registry layer can be split into. */
export const PAINT_SUFFIXES = ["fill", "line", "circle", "symbol"] as const;

export type PaintSuffix = (typeof PAINT_SUFFIXES)[number];

/**
 * Per-suffix geometry guard.
 *
 * The line layer draws both line strings and polygon outlines (a polygon has no
 * separate outline layer in MapLibre), so it accepts both; everything else maps
 * onto the single geometry type it can represent.
 */
export const GEOMETRY_FILTER: Record<PaintSuffix, FilterSpecification> = {
  fill: ["match", ["geometry-type"], ["Polygon", "MultiPolygon"], true, false],
  line: ["match", ["geometry-type"], ["LineString", "MultiLineString", "Polygon", "MultiPolygon"], true, false],
  circle: ["match", ["geometry-type"], ["Point", "MultiPoint"], true, false],
  symbol: ["match", ["geometry-type"], ["Point", "MultiPoint", "Polygon", "MultiPolygon"], true, false],
};
