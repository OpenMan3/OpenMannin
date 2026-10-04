/**
 * Historic and remnant submarine cable landing points.
 *
 * The Isle of Man was linked to the outside world by telegraph cable from 1859,
 * and those early landings matter to anyone assessing the seabed today: the
 * wrecks and cable debris of the first-generation systems sit on the same
 * ground that fishing, dredging, aggregate extraction and now the GDF siting
 * process have to contend with.
 *
 * What this layer is, precisely: a set of PLACES at which a historic cable is
 * documented to have landed. It is not a route layer. The alignments of the
 * 1859 and 1942 systems are not available in any machine-readable, reusable
 * form, and drawing a line between two inferred landing points would assert a
 * survey that nobody has made.
 *
 * LICENCE WARNING. The substantive history here comes from Atlantic-Cable.com,
 * which is the effective public record for pre-1950 cables but publishes no
 * explicit licence. The registry therefore grades this source UNKNOWN, which
 * renders the layer with a permission warning in the UI. That is the correct
 * treatment: the facts are public record, but public record is not the same
 * thing as a grant to republish.
 *
 * The coordinates themselves are grade C. They are Nominatim centroids for the
 * named landing places, obtained from OpenStreetMap under ODbL. A cable landing
 * is a specific stretch of beach; a village centroid is not that, and the
 * difference can be a few hundred metres on a curving coast.
 */

import { get, writeJSON, roundCoords } from "./lib/fetch.mjs";

const OUT = "public/data/historic-cables.geojson";
const ATLANTIC_CABLE = "https://atlantic-cable.com/";

/**
 * Documented landing places. `system` records what is known of each; `routes`
 * describes the far end only where the source states it.
 */
const LANDINGS = [
  {
    place: "Port Cornaa",
    system: "1859 Point Cranstal - St Bees cable, relocated",
    year: 1859,
    detail:
      "The first submarine cable to the Isle of Man, 36 miles from Point Cranstal to St Bees in Cumbria, and the first use of outer servings on a submarine cable. It suffered tidal damage at its original landing and was relocated to Port Cornaa.",
    notable: true,
  },
  {
    place: "Cranstal",
    placeSuffix: ", Bride",
    system: "1859 Point Cranstal - St Bees cable, original landing",
    year: 1859,
    detail:
      "The original Manx end of the first cable to the island, at Point Cranstal in the parish of Bride, before the tidal damage that forced relocation to Port Cornaa.",
    notable: true,
  },
  {
    place: "Port Grenaugh",
    system: "Recorded cable remnant",
    detail:
      "A remnant of historic cable recorded at Port Grenaugh. Port Grenaugh is also a live cable landing for the LANIS-1 system, so the same shore-end area carries both generations.",
  },
  {
    place: "The Sound",
    placeSuffix: "",
    system: "Recorded cable remnants (two short cables)",
    detail:
      "Two short lengths of historic cable recorded in The Sound, the channel between the Isle of Man and the Calf of Man. Some sources suggest these may link the island to the Calf of Man rather than crossing to a far shore.",
    ambiguous: true,
  },
];

async function geocode(place) {
  const q = place.placeSuffix
    ? `${place.place} ${place.placeSuffix.trim()}, Isle of Man`
    : `${place.place}, Isle of Man`;
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`;
  const res = await get(url, { headers: { Accept: "application/json" } });
  const json = await res.json();
  if (!json.length) return null;
  return { lat: Number(json[0].lat), lon: Number(json[0].lon), displayName: json[0].display_name };
}

const CAVEATS = [
  "THESE ARE PLACES, NOT CABLE POSITIONS. Each point is a Nominatim centroid for the named landing settlement or feature, not a surveyed cable landing or a recovered wreck.",
  "No route geometry is published here. The alignments of the 1859 and 1942 systems are not available in any reusable machine-readable form, and inferring a line between two landing points would assert a survey nobody has made.",
  "The Atlantic-Cable.com source carries no explicit licence and is graded UNKNOWN in the registry. Treat the history as public record, not as a grant to republish.",
  "The two cables in The Sound are described in the source as 'possibly linking to the Calf of Man'. That attribution is uncertain and is flagged rather than resolved.",
  "Wreck positions and seabed debris for these systems are not included; they would need a hydrographic or archaeological source and are a separate question from where the cable landed.",
];

async function main() {
  const features = [];

  for (const l of LANDINGS) {
    const hit = await geocode(l);
    if (!hit) {
      console.warn(`  ! could not geocode ${l.place}, omitted`);
      continue;
    }

    features.push({
      type: "Feature",
      id: `historic-cable/${l.system.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 48)}`,
      geometry: roundCoords({ type: "Point", coordinates: [hit.lon, hit.lat] }, 6),
      properties: {
        name: l.place,
        kind: "historic-cable-landing",
        system: l.system,
        year: l.year ?? null,
        detail: l.detail,
        notable: Boolean(l.notable),
        attributionUncertain: Boolean(l.ambiguous),
        coordGrade: "C",
        coordSource: `Nominatim (OSM) centroid for ${l.place}, Isle of Man. This is the named landing place, not a surveyed cable landing.`,
        geocoderDisplayName: hit.displayName,
        source: ATLANTIC_CABLE,
        licence: "UNKNOWN",
        sourceVerified: new Date().toISOString().slice(0, 10),
      },
    });
  }

  const fc = {
    type: "FeatureCollection",
    name: "historic-cables",
    properties: {
      generated: new Date().toISOString(),
      source: ATLANTIC_CABLE,
      sourceVerified: new Date().toISOString().slice(0, 10),
      licence: "UNKNOWN",
      licenceWarning:
        "Atlantic-Cable.com publishes no explicit licence. Coordinates are OSM/Nominatim derived under ODbL; the historical narrative is UNKNOWN-licensed and is included as public record only.",
      caveats: CAVEATS,
    },
    features,
  };

  const bytes = writeJSON(OUT, fc, { pretty: true });
  console.log(`  historic-cables.geojson  ${features.length} landing points, ${(bytes / 1024).toFixed(1)} KB`);
  for (const f of features) {
    const p = f.properties;
    console.log(`    [${p.coordGrade}] ${p.name.padEnd(15)} ${p.year ?? "—"}  ${p.system}`);
  }
}

main().catch((e) => {
  console.error(`historic cables ingest failed: ${e.message}`);
  process.exit(1);
});