#!/usr/bin/env node
/**
 * Ingest MANNGIS / Isle of Man Government ArcGIS services into static GeoJSON.
 *
 * Why static? Every service we consume here is keyless and public, but they are
 * also the same infrastructure that fronts live road conditions and a variable
 * message sign system. We do not want thousands of visitors hammering the
 * government's ArcGIS servers, and we definitely do not want to trip the F5 WAF
 * in front of them. Everything gets baked at build time instead. Only genuinely
 * live things (buses, aircraft, vessels, weather) hit the network at runtime.
 *
 * All services verified reachable with no API key on 2026-10-04.
 *
 *   node scripts/ingest-manngis.mjs
 */

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  fetchArcGISLayer,
  listLayers,
  project,
  writeJSON,
  sleep,
  emptyFC,
} from "./lib/fetch.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "data");

const S3 = "https://services3.arcgis.com/dBlcVWoJgxxpCttN/ArcGIS/rest/services";
const DEFA =
  "https://utility.arcgis.com/usrsvcs/servers/741cd72e54164c3c92d8a944346109e7/rest/services/CorporateDynamicServices/ProdDEFA/MapServer";
const DOI =
  "https://utility.arcgis.com/usrsvcs/servers/1d5a1493ee7a45ffa8d1f6558dff2fdc/rest/services/CorporateDynamicServices/ProdDOI/MapServer";

/**
 * The manifest. `datasets` is a list of ArcGIS layers to merge into one file;
 * `keep` maps our property names to publisher field names (or candidate lists,
 * because MANNGIS field naming is not consistent between services).
 */
const MANIFEST = [
  {
    // NOT a gazetteer. DEFA/0 "Field Gazetteer" has no name field whatsoever:
    // its fields are PLOT, START, ACRES3D, CATEGORY, OCCUP_CURR, USECOD_CURR.
    // It is agricultural field parcels. This was previously written out as
    // "toponyms.geojson" and mislabelled in the UI as place names, which is how
    // 19,848 unlabelled polygons ended up described as a gazetteer.
    // toponyms.geojson now comes from OpenStreetMap via scripts/ingest-osm.mjs.
    out: "field-parcels.geojson",
    asPoints: true,
    datasets: [{ url: `${DEFA}/0`, name: "Field Gazetteer" }],
    keep: {
      plot: ["PLOT"],
      category: ["CATEGORY"],
      occupation: ["OCCUP_CURR"],
      use: ["USECOD_CURR"],
      acres: ["ACRES3D"],
    },
    note: "19,848 agricultural field parcels. Unnamed. Points only; the parcel boundaries are not published in a usable form here.",
  },
  {
    out: "glens.geojson",
    datasets: [{ url: `${DEFA}/3`, name: "Glens" }],
    keep: { label: ["NAME", "Name", "GLEN_NAME"] },
  },
  {
    out: "ramblage.geojson",
    simplify: 0.00006,
    datasets: [{ url: `${DEFA}/5`, name: "Public land open to rambling" }],
    keep: { label: ["NAME", "Name", "LOCATION"], ref: ["REF", "REFERENCE"] },
  },
  {
    out: "registered-buildings.geojson",
    datasets: [{ url: `${DEFA}/16`, name: "Registered Buildings" }],
    keep: {
      label: ["ADDRESS", "address", "Name", "NAME"],
      regNo: ["registration_number", "REGISTRATION_NUMBER", "RegNo"],
      grade: ["grade", "GRADE"],
      dateRegistered: ["date_registered", "DATE_REGISTERED"],
      dateCertified: ["date_certified", "DATE_CERTIFIED"],
      caseRef: ["case_ref", "CASE_REF"],
      url: ["hyperlink", "HYPERLINK"],
    },
  },
  {
    out: "registered-trees.geojson",
    datasets: [{ url: `${DEFA}/1`, name: "Registered Trees" }],
    keep: {
      label: ["ADDRESS", "address", "Name", "NAME", "LOCATION"],
      regNo: ["registration_number", "REGISTRATION_NUMBER"],
    },
  },

  // --- Roads and trails -----------------------------------------------------
  {
    out: "roads.geojson",
    simplify: 0.00003,
    datasets: [{ url: `${DOI}/4`, name: "Road Hierarchy" }],
    keep: {
      label: ["RoadNo", "ROADNO", "ROAD_NO", "Road_No"],
      roadClass: ["RoadClass", "ROADCLASS", "ROAD_CLASS"],
      hierarchy: ["Hierarchy", "HIERARCHY"],
      ukClass: ["UKClass", "UKCLASS", "UK_CLASS"],
      localAuthority: ["LocalAuthority", "LOCALAUTHORITY"],
    },
    note: "RoadNo is noisy (1,909 distinct across 3,391 rows). USRN is 100% null upstream and is deliberately not carried.",
  },
  {
    out: "prow.geojson",
    simplify: 0.00003,
    datasets: [{ url: `${DOI}/3`, name: "Public Rights of Way (Definitive Map)" }],
    keep: {
      label: ["PROW_No", "PROW_NO", "prow_no", "PROWNO"],
      length: ["Length_m", "LENGTH", "Length", "LENGTH_M"],
      ref: ["PROW_Ref", "PROW_REF", "REF"],
      desc: ["DESCRIPTION", "Description", "DESC"],
    },
  },
  {
    out: "footpaths.geojson",
    simplify: 0.00003,
    datasets: [{ url: `${DEFA}/20`, name: "Footpaths (DEFA)" }],
    keep: {
      label: ["NAME", "Name", "Path_No", "PATH_NO", "REF"],
      length: ["Length_m", "LENGTH", "Length"],
    },
    note: "The layer's own description states this is NOT the definitive PROW map.",
  },
  {
    out: "bridges.geojson",
    simplify: 0.00003,
    datasets: [{ url: `${DOI}/1`, name: "Highway Bridges" }],
    keep: {
      label: ["NAME", "Name", "Bridge_No", "BRIDGE_NO", "REF"],
      structure: ["Structure_Type", "STRUCTURE_TYPE", "TYPE"],
    },
  },
  {
    out: "speed-limits.geojson",
    simplify: 0.00003,
    datasets: [{ url: `${DOI}/20`, name: "Speed Limits" }],
    keep: {
      limit: ["SPEED_LIMIT", "SpeedLimit", "SPEEDLIMIT", "LIMIT", "POSTED"],
      label: ["RoadNo", "ROADNO", "ROAD_NO", "NAME"],
    },
  },

  // --- Transport ------------------------------------------------------------
  {
    out: "bus-stops.geojson",
    datasets: [{ url: `${S3}/BusStops/FeatureServer/0`, name: "Bus Stops" }],
    keep: {
      stopNo: ["Stop_No_1", "STOP_NO_1", "StopNo"],
      naptan: ["NaPTAN_1", "NAPTAN_1", "NaPTAN"],
      label: ["Full_Name_1", "FULL_NAME_1", "Name"],
      locality: ["Locality", "LOCALITY"],
      shelter: ["Shelter_Type", "SHELTER_TYPE"],
    },
    note: "NaPTAN area code for the IoM is 891085.",
  },
  {
    out: "bus-routes.geojson",
    simplify: 0.00006,
    datasets: [{ url: `${S3}/BusRoutes/FeatureServer/0`, name: "Bus Routes" }],
    keep: {
      route: ["Route_Number", "ROUTE_NUMBER", "RouteNumber"],
      day: ["Day", "DAY"],
      region: ["Region", "REGION"],
      direction: ["Direction_", "DIRECTION_", "Direction"],
    },
    note: "STALE — October 2015 network. Do not present as current.",
  },
  {
    out: "railways.geojson",
    simplify: 0.00002,
    datasets: [{ url: `${S3}/Railways/FeatureServer/0`, name: "Railways" }],
    keep: {
      label: ["Name", "NAME", "RAILWAY_NAME"],
      lengthM: ["Length_m", "LENGTH_M", "Length", "LENGTH"],
      lineRef: ["Ref", "REF", "Reference"],
    },
    note: "Every railway on the IoM is heritage and seasonal. Gauge is not in the data.",
  },
  {
    out: "cycling-routes.geojson",
    simplify: 0.00005,
    allLayersIn: `${S3}/CyclingRoutes/FeatureServer`,
    keep: { label: ["Name", "NAME"], routeNo: ["Route_No", "ROUTE_NO", "RouteNumber"] },
    note: "STALE — created September 2015. Contains withdrawn routes.",
  },
  {
    out: "walking-routes.geojson",
    simplify: 0.00005,
    allLayersIn: `${S3}/WalkingRoutesComplete/FeatureServer`,
    skipLayerName: /test/i,
    keep: { label: ["Name", "NAME"], stage: ["Stage", "STAGE"] },
    note: "Raad ny Foillan, Bayr ny Skeddan, Millennium Way, railway walks, station walks, Wardens Walks.",
  },
  {
    out: "pilgrimage-walks.geojson",
    simplify: 0.00006,
    allLayersIn: `${S3}/PilgrimageWalks/FeatureServer`,
    keep: { label: ["Name", "NAME"] },
  },
  {
    out: "ev-charging.geojson",
    datasets: [{ url: `${S3}/Electric_Vehicle_Charging_Sites_(Read_Only)/FeatureServer/0`, name: "EV Charging Sites" }],
    keep: {
      label: ["Site_Name", "SITE_NAME", "Name", "NAME", "Description"],
      locality: ["Town", "TOWN", "Locality"],
      sockets: ["No_Of_Outlets", "NO_OF_OUTLETS", "Outlets", "Sockets"],
      kw: ["Max_kW", "MAX_KW", "kW", "POWER_KW"],
      owner: ["Owner", "OWNER", "Operator"],
    },
    note: "STALE — last edited August 2021. 15 sites, 35 sockets.",
  },
  {
    out: "traffic-signals.geojson",
    allLayersIn: `${S3}/TrafficSignals/FeatureServer`,
    skipLayerName: /maint|audit|log|history/i,
    maxLayers: 4,
    keep: {
      label: ["Name", "NAME", "Description", "SIGN_NAME"],
      kind: ["Type", "TYPE", "Sign_Type"],
    },
  },
  {
    out: "coastal-access.geojson",
    datasets: [{ url: `${S3}/CoastalAccessPoints/FeatureServer/0`, name: "Coastal Access Points" }],
    keep: { label: ["Name", "NAME", "Label"], ref: ["Ref", "REF"] },
  },
  {
    out: "tt-course.geojson",
    simplify: 0.00002,
    allLayersIn: `${S3}/RestrictedAreas/FeatureServer`,
    preferLayerName: /motorcourse|tt|billown/i,
    keep: { label: ["Name", "NAME", "Description"], kind: ["Type", "TYPE"] },
    note: "The TT mountain course as published by MANNGIS. Length is Wikipedia-only upstream; no LGL is published.",
  },

  // --- Environment ----------------------------------------------------------
  {
    out: "hydrography.geojson",
    simplify: 0.00004,
    datasets: [
      { url: `${S3}/Hydrology/FeatureServer/0`, name: "Hydrology" },
      { url: `${DOI}/5`, name: "Designated Watercourse Extents" },
    ],
    keep: {
      label: ["NAME", "Name", "DESCRIPTIVE_TERM"],
      code: ["FEATURE_CODE", "FeatureCode", "CODE"],
      length: ["Length_m", "LENGTH", "Length"],
    },
    note: "All watercourse features are one undifferentiated class. No names, no river/stream distinction.",
  },
  {
    out: "protected-areas.geojson",
    simplify: 0.00006,
    datasets: [
      { url: `${DEFA}/7`, name: "Areas of Special Scientific Interest" },
      { url: `${DEFA}/9`, name: "National Nature Reserves" },
      { url: `${DEFA}/8`, name: "Special Protection Area" },
      { url: `${DEFA}/13`, name: "Manx Marine Nature Reserves" },
      { url: `${DEFA}/14`, name: "Manx National Trust Land" },
      { url: `${DEFA}/22`, name: "Designated Wildlife Sites" },
      { url: `${DEFA}/10`, name: "Ramsar Wetland Sites" },
      { url: `${DEFA}/6`, name: "Bird Sanctuaries" },
    ],
    keep: {
      label: ["NAME", "Name", "Site_Name", "SITE_NAME"],
      code: ["CODE", "Code", "SITE_CODE"],
      areaHa: ["Area_Ha", "AREA_HA", "Area"],
    },
    defaults: { designation: "" },
  },
  {
    out: "marine-habitats.geojson",
    simplify: 0.00006,
    datasets: [
      { url: `${DEFA}/37`, name: "Saltmarsh Extents" },
      { url: `${DEFA}/38`, name: "Kelp Extents" },
      { url: `${DEFA}/39`, name: "Modiolus Extents" },
      { url: `${DEFA}/40`, name: "Maerl Extents" },
      { url: `${DEFA}/45`, name: "Eel Grass Extents" },
      { url: `${DEFA}/46`, name: "Eelgrass Conservation Zones" },
      { url: `${DEFA}/11`, name: "Ramsey Marine Nature Reserve" },
      { url: `${DEFA}/12`, name: "Sea Fisheries Closed or Restricted Areas" },
      { url: `${DEFA}/35`, name: "Sub-littoral Mud" },
      { url: `${DEFA}/36`, name: "Experimental Closed Areas" },
    ],
    keep: { label: ["NAME", "Name", "Site_Name"], code: ["CODE", "Code"] },
  },
  {
    out: "reservoirs.geojson",
    datasets: [{ url: `${DEFA}/27`, name: "Reservoir Watershed Areas" }],
    keep: { label: ["NAME", "Name", "RESERVOIR"] },
    note: "Watershed polygons, not water bodies. Four of seven impounding reservoirs are operational: West Baldwin, Sulby (completed 1982), Clypse, Kerrowdhoo.",
  },
];

// ---------------------------------------------------------------------------

async function resolveDatasets(entry) {
  if (entry.datasets) return entry.datasets;

  if (entry.allLayersIn) {
    const layers = await listLayers(entry.allLayersIn);
    let chosen = layers;
    if (entry.preferLayerName) {
      const preferred = layers.filter((l) => entry.preferLayerName.test(l.name));
      if (preferred.length) chosen = preferred;
    }
    if (entry.skipLayerName) chosen = chosen.filter((l) => !entry.skipLayerName.test(l.name));
    if (entry.maxLayers) chosen = chosen.slice(0, entry.maxLayers);
    return chosen.map((l) => ({ url: `${entry.allLayersIn}/${l.id}`, name: l.name }));
  }
  throw new Error("manifest entry has neither datasets nor allLayersIn");
}

async function run() {
  mkdirSync(OUT, { recursive: true });
  const report = [];

  for (const entry of MANIFEST) {
    const t0 = Date.now();
    const datasets = await resolveDatasets(entry);
    const merged = emptyFC();
    const perDataset = [];
    let warned = 0;

    for (const ds of datasets) {
      try {
        const fc = await fetchArcGISLayer(ds.url, { label: ds.name });
        for (const f of fc.features) merged.features.push(f);
        perDataset.push({ name: ds.name, count: fc.features.length });
      } catch (err) {
        warned++;
        perDataset.push({ name: ds.name, error: String(err.message).slice(0, 200) });
      }
      await sleep(250);
    }

    // Tag every feature with which dataset it came from, then project.
    for (const ds of perDataset) {
      if (ds.error) continue;
      // project() handles this via defaults; but we want per-feature source,
      // so re-tag using a synthetic marker we set during the loop.
    }
    const tagged = {
      type: "FeatureCollection",
      features: merged.features.map((f) => ({
        ...f,
        properties: { ...f.properties },
      })),
    };

    const out = project(tagged, entry.keep ?? {}, entry.defaults ?? {}, {
      simplify: entry.simplify ?? 0,
      points: entry.asPoints === true,
      minVertices: entry.minVertices,
    });
    // Stash dataset provenance per feature for merged layers.
    if (datasets.length > 1) {
      let i = 0;
      for (const ds of perDataset) {
        for (let n = 0; n < ds.count; n++) {
          const f = out.features[i++];
          if (f) f.properties.dataset = ds.name;
        }
      }
    } else if (out.features.length && !out.features[0].properties.dataset) {
      for (const f of out.features) f.properties.dataset = datasets[0].name;
    }

    const path = join(OUT, entry.out);
    const bytes = writeJSON(path, out);
    report.push({
      file: entry.out,
      features: out.features.length,
      datasets: perDataset,
      kb: Math.round(bytes / 1024),
      ms: Date.now() - t0,
      warned,
      note: entry.note,
    });
    console.log(
      `  ${out.features.length.toString().padStart(6)} features  ${String(Math.round(bytes / 1024)).padStart(6)} KB  ${entry.out}` +
        (warned ? `   [${warned} dataset(s) FAILED]` : "")
    );
  }

  console.log("\nMANNGIS ingest complete.");
  const failed = report.filter((r) => r.warned);
  if (failed.length) {
    console.log(`\n${failed.length} file(s) had failures — inspect before publishing:`);
    for (const f of failed) {
      for (const d of f.datasets.filter((d) => d.error)) {
        console.log(`  ${f.file} <- ${d.name}: ${d.error}`);
      }
    }
  }
  writeJSON(join(OUT, "_ingest-manngis-report.json"), { generatedAt: new Date().toISOString(), report }, { pretty: true });
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});