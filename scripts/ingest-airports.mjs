/**
 * Isle of Man airports and airstrips.
 *
 * Source: OurAirports (https://ourairports.com/data/), which publishes its
 * airport and runway tables as CSV under a public-domain dedication. That
 * licence is the reason this layer can be redistributed at all, and it is why
 * these coordinates are graded A rather than the B/C that name-derived
 * positions get elsewhere in the project: OurAirports records the aerodrome
 * reference point, not a place name someone eyeballed off a map.
 *
 * Scope is every aerodrome whose `iso_country` is IM, which is seven records:
 * Isle of Man Airport (EGNS, the only one with scheduled service), the two
 * ex-RAF fields at Andreas and Jurby, two private strips, Noble's Hospital
 * heliport, and the closed Hall Caine Airport. Closed aerodromes are kept and
 * labelled rather than filtered out, because "this airfield no longer exists"
 * is itself provenance worth publishing.
 *
 * Runways are joined on `airport_ref`, which is OurAirports' numeric airport
 * id, not the ident. Getting that wrong silently drops every runway.
 *
 * Caveat worth stating plainly: OurAirports is crowd-maintained. Positions for
 * the private strips and the hospital heliport are survey-grade on paper but
 * not independently audited, and a closed runway can linger in the table for
 * years. Runway `closed` flags are carried through verbatim so the map does
 * not assert that every runway here is currently usable.
 */

import { get, writeJSON } from "./lib/fetch.mjs";

const OUT = "public/data/airports.geojson";
const AIRPORTS_URL = "https://ourairports.com/data/airports.csv";
const RUNWAYS_URL = "https://ourairports.com/data/runways.csv";
const ISO = "IM";

/** OurAirports `type` values we keep. Anything else is not an aerodrome. */
const AERODROME_TYPES = new Set([
  "large_airport",
  "medium_airport",
  "small_airport",
  "heliport",
  "seaplane_base",
  "closed",
]);

/**
 * Minimal RFC 4180 CSV reader.
 *
 * OurAirports quotes every field and embeds commas inside names
 * ("Fazanda Progresso, Airstrip" and wiki URLs with commas are both real), so
 * a split-on-comma parser corrupts rows. Handles quoted fields, escaped
 * double quotes, and embedded newlines.
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++; // consume the escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      // Treat CRLF as one terminator.
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      // Skip the trailing blank line most CSV files end with.
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  if (!rows.length) return [];

  const header = rows[0];
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

const num = (v) => {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const ftToM = (ft) => {
  const n = num(ft);
  return n === null ? null : Number((n * 0.3048).toFixed(1));
};

async function fetchCsv(url) {
  const res = await get(url, { headers: { Accept: "text/csv,*/*" } });
  const text = await res.text();
  return parseCsv(text);
}

function buildRunways(runwayRows) {
  const byAirport = new Map();
  for (const r of runwayRows) {
    const key = r.airport_ref;
    if (!byAirport.has(key)) byAirport.set(key, []);
    const lengthFt = num(r.length_ft);
    const widthFt = num(r.width_ft);
    byAirport.get(key).push({
      ident: [r.le_ident, r.he_ident].filter(Boolean).join("/") || null,
      lengthM: ftToM(r.length_ft),
      widthM: ftToM(r.width_ft),
      lengthFt,
      widthFt,
      surface: r.surface || null,
      lighted: r.lighted === "1",
      closed: r.closed === "1",
      // Threshold coordinates, where OurAirports records them. Useful for
      // drawing runway ends accurately rather than centring a rectangle.
      le: { lat: num(r.le_latitude_deg), lon: num(r.le_longitude_deg) },
      he: { lat: num(r.he_latitude_deg), lon: num(r.he_longitude_deg) },
      headingLeDegT: num(r.le_heading_degT),
      headingHeDegT: num(r.he_heading_degT),
    });
  }
  return byAirport;
}

async function main() {
  const [airportRows, runwayRows] = await Promise.all([
    fetchCsv(AIRPORTS_URL),
    fetchCsv(RUNWAYS_URL),
  ]);

  const ours = airportRows.filter((r) => r.iso_country === ISO);
  const runwaysByAirport = buildRunways(runwayRows);

  const features = [];
  let totalRunways = 0;
  let closedRunways = 0;

  for (const a of ours) {
    const lat = num(a.latitude_deg);
    const lon = num(a.longitude_deg);
    if (lat === null || lon === null) {
      console.warn(`  ! ${a.ident} has no coordinates, skipped`);
      continue;
    }
    if (!AERODROME_TYPES.has(a.type)) continue;

    const runways = runwaysByAirport.get(a.id) ?? [];
    totalRunways += runways.length;
    closedRunways += runways.filter((r) => r.closed).length;

    // EGNS carries an official aerodrome reference point and is the only field
    // with scheduled service, so it earns grade A. The rest are OurAirports
    // survey data with no independent audit: grade B.
    const grade = a.scheduled_service === "yes" ? "A" : "B";

    features.push({
      type: "Feature",
      id: `airport/${a.ident}`,
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: {
        name: a.name || a.ident,
        ident: a.ident,
        airportType: a.type,
        icao: a.icao_code || null,
        iata: a.iata_code || null,
        // OurAirports omits the field for some entries rather than nulling it.
        municipality: a.municipality || null,
        elevationM: ftToM(a.elevation_ft),
        scheduledService: a.scheduled_service === "yes",
        closed: a.type === "closed",
        runways,
        runwayCount: runways.length,
        homeLink: a.home_link || null,
        wikipedia: a.wikipedia_link || null,
        coordGrade: grade,
        coordSource:
          grade === "A"
            ? "OurAirports aerodrome reference point for EGNS (public-domain OurAirports dataset)."
            : "OurAirports aerodrome reference point (public-domain OurAirports dataset); crowd-maintained, not independently audited.",
        source: "https://ourairports.com/data/",
        sourceVerified: new Date().toISOString().slice(0, 10),
        licence: "PD-OurAirports",
      },
    });
  }

  // Largest aerodrome first: it is the one people are usually looking for.
  features.sort((a, b) => {
    const rank = (f) => (f.properties.icao ? 0 : f.properties.closed ? 2 : 1);
    return rank(a) - rank(b) || a.properties.name.localeCompare(b.properties.name);
  });

  const fc = {
    type: "FeatureCollection",
    name: "airports",
    properties: {
      generated: new Date().toISOString(),
      source: "https://ourairports.com/data/",
      sourceVerified: new Date().toISOString().slice(0, 10),
      licence: "PD-OurAirports",
      caveats: [
        "OurAirports is crowd-maintained; positions are not independently audited.",
        "Runway `closed` flags are carried through from OurAirports and may lag reality.",
        "Airport type 'closed' means OurAirports has marked the aerodrome closed; the site may still be in use for private or emergency aviation.",
        "Only the aerodrome reference point is published, not the boundary or extent of any runway strip.",
      ],
    },
    features,
  };

  const bytes = writeJSON(OUT, fc, { pretty: true });
  console.log(
    `  airports.geojson  ${features.length} aerodromes, ${totalRunways} runways (${closedRunways} closed), ${(bytes / 1024).toFixed(1)} KB`,
  );
  for (const f of features) {
    const p = f.properties;
    const bits = [p.ident];
    if (p.iata) bits.push(p.iata);
    if (p.closed) bits.push("CLOSED");
    if (p.scheduledService) bits.push("scheduled");
    console.log(
      `    [${p.coordGrade}] ${bits.join(" ")} ${p.name} — ${p.runwayCount} runway${p.runwayCount === 1 ? "" : "s"}`,
    );
  }
}

main().catch((e) => {
  console.error(`airports ingest failed: ${e.message}`);
  process.exit(1);
});