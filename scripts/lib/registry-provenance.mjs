/**
 * Provenance for a data file, resolved from the layer/source/licence registers
 * the UI actually renders.
 *
 * The point of the block at the top of every data file is that a GeoJSON file
 * should not silently depend on an application registry to explain where it
 * came from: a reader of public/data/roads.geojson - the next Project, a new
 * tool, a human audit - gets source, licence and caveats without having to find
 * the app. The registers are the single source of truth so the file and the UI
 * cannot drift apart.
 *
 * Because this imports the TypeScript registers it must be run under
 * `node --experimental-strip-types` (as all the ingest and verify scripts are).
 */

import { LAYERS } from "../../src/lib/layers.ts";
import { SOURCES } from "../../src/lib/sources.ts";
import { LICENCES } from "../../src/lib/licences.ts";

/**
 * The provenance block the app would show for the layer that owns `file`.
 * Returns null when no registered layer claims the file.
 */
export function registryProvenance(file) {
  const def = LAYERS.find((l) => l.file === file);
  if (!def || def.kind !== "geojson") return null;
  const src = SOURCES[def.sourceId];
  const lic = src ? LICENCES[src.licence] : null;
  return {
    source: src?.name ?? null,
    sourceId: def.sourceId,
    sourceUrl: src?.url ?? null,
    licence: lic?.name ?? src?.licence ?? null,
    licenceId: src?.licence ?? null,
    licenceUrl: lic?.url ?? null,
    caveats: def.caveats ?? [],
    generated: new Date().toISOString(),
  };
}