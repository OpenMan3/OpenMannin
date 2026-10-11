import type { Source } from "./types";

/**
 * Source register. Every layer points at one of these.
 * `lastChecked` is a hand-verified date, not a build timestamp — be honest
 * about when a human actually read the page.
 */
export const SOURCES: Record<string, Source> = {
  osmIOM: {
    id: "osmIOM",
    name: "OpenStreetMap — WikiProject Isle of Man",
    publisher: "OpenStreetMap contributors",
    url: "https://www.openstreetmap.org/wiki/WikiProject_Isle_of_Man",
    licence: "ODbL",
    lastChecked: "2026-10-04",
    notes:
      "Highly detailed and genuinely open. Historically the Isle of Man Government has supported this community by occasionally donating small-scale maps and historic aerial imagery. This is the route to roads, railways, watercourses, protected areas and sealife features used across the map.",
  },
  wikidata: {
    id: "wikidata",
    name: "Wikidata",
    publisher: "Wikimedia Foundation / Wikidata community",
    url: "https://www.wikidata.org/",
    licence: "CC0-1.0",
    lastChecked: "2026-10-06",
    notes:
      "Structured data released under CC0. Queried via the Wikidata Query Service (WDQS) SPARQL endpoint for Isle of Man (Q9676) items with a heritage designation (P1435) and a coordinate (P625). Community-maintained and incomplete; the authoritative statutory registers are held by government and are not open.",
  },
  govim: {
    id: "govim",
    name: "Isle of Man Government web publication",
    publisher: "Isle of Man Government",
    url: "https://www.gov.im/",
    licence: "OGL-IoM",
    lastChecked: "2026-10-04",
    notes:
      "No CKAN/Socrata API. Hand-maintained CMS of HTML pages. Subject categories: agriculture, births/deaths, crime, economy, education, energy/environment, FIU, government, health, society, transport.",
  },
  celestrak: {
    id: "celestrak",
    name: "CelesTrak orbital elements",
    publisher: "CelesTrak (GP data by TLE)",
    url: "https://celestrak.org/",
    licence: "PUBLIC-DOMAIN",
    lastChecked: "2026-10-04",
    notes:
      "Two-line element sets for the ISS and crewed spacecraft. Published by the US Space Force as public domain and redistributed by CelesTrak with no key, no login and no terms restricting use. Propagated with SGP4 via satellite.js (MIT). This is the only live feed here that needs nobody's permission, which is why it is the only one enabled.",
  },
  manxutilities: {
    id: "manxutilities",
    name: "Manx Utilities asset disclosures",
    publisher: "Manx Utilities",
    url: "https://www.manxutilities.im/",
    licence: "OGL-IoM",
    lastChecked: "2026-10-04",
    notes:
      "Operator statements: 3 power stations, 102 km subsea cable, 1,300 km underground cable, 530 km overhead line, 7 impounding reservoirs (4 operational). Power station names are NOT published officially.",
  },
  submarinecablemap: {
    id: "submarinecablemap",
    name: "Submarine Cable Map / TeleGeography",
    publisher: "TeleGeography",
    url: "https://www.submarinecablemap.com/",
    licence: "CC-BY-4.0",
    lastChecked: "2026-10-04",
    notes: "Modern cable systems with owners and routes. Route alignment is indicative, not survey-grade.",
  },
  nda: {
    id: "nda",
    name: "Nuclear Decommissioning Authority / Sellafield Ltd",
    publisher: "UK Nuclear Decommissioning Authority",
    url: "https://www.gov.uk/government/publications/nuclear-decommissioning-authority-annual-report-and-accounts-2025-to-2026",
    licence: "OGL-IoM",
    lastChecked: "2026-10-04",
    notes: "UK Government Crown copyright. OGL applied by us as the closest fit; verify before republication.",
  },
  mea: {
    id: "mea",
    name: "Manx Marine Environmental Assessment (MMEA), 2nd edition",
    publisher: "Isle of Man Government",
    url: "https://www.gov.im/media/1363407/ch-21-physical-environment.pdf",
    licence: "OGL-IoM",
    lastChecked: "2026-10-04",
    notes:
      "The island's authoritative marine baseline study, October 2018. Chapter 2.1 publishes surveyed tide-gauge positions and Douglas02 vertical datum relationships; Chapter 6 is the authoritative cable and pipeline inventory. IMPORTANT EXCLUSION: the Admiralty/SeaZone chart extracts and Proudman Institute tidal range tables reproduced in MMEA are separately licensed and are NOT reusable under the IoM OGL, so neither is reused here.",
  },
  osmSeamarks: {
    id: "osmSeamarks",
    name: "OpenStreetMap seamarks survey",
    publisher: "OpenStreetMap contributors",
    url: "https://wiki.openstreetmap.org/wiki/Seamark",
    licence: "ODbL",
    lastChecked: "2026-10-04",
    notes:
      "Submarine cable alignments tagged seamark:type=cable_submarine, retrieved by way id from the OSM API. Alignment data is largely derived from Kingfisher Information Service cable surveys. Clipboard caveat: geometry is clipped to an IoM bounding box, not a legal boundary.",
  },
  osmHarbours: {
    id: "osmHarbours",
    name: "OpenStreetMap harbour and marine infrastructure",
    publisher: "OpenStreetMap contributors",
    url: "https://wiki.openstreetmap.org/wiki/Tag:seamark%3Dharbour",
    licence: "ODbL",
    lastChecked: "2026-10-04",
    notes:
      "Harbour areas, marinas, piers, linkspans, breakwaters and groins retrieved via Overpass. Several Douglas piers cite the Isle of Man Government 1:25000 map (2007) as upstream source. Two statutory ports (Port Cornaa, Groudle) have no mapped geometry and are held as grade-C settlement centroids.",
  },
  osmPower: {
    id: "osmPower",
    name: "OpenStreetMap power infrastructure",
    publisher: "OpenStreetMap contributors",
    url: "https://wiki.openstreetmap.org/wiki/Key:power",
    licence: "ODbL",
    lastChecked: "2026-10-04",
    notes:
      "Substations, power plants and generators retrieved via Overpass, joined by name to MMEA Ch.6.1 capacity figures (edition October 2018). MEA states nine primary substations; OSM maps about two dozen named plus many unnamed, and the two counts cannot be reconciled.",
  },
  ourairports: {
    id: "ourairports",
    name: "OurAirports airport and runway tables",
    publisher: "OurAirports",
    url: "https://ourairports.com/data/",
    licence: "PD-OURAIRPORTS",
    lastChecked: "2026-10-04",
    notes:
      "Crowd-maintained global aerodrome and runway database published under a public domain dedication. Contains seven Isle of Man records including the closed ex-RAF fields at Andreas and Jurby. Positions are aerodrome reference points, not boundary surveys.",
  },
  ospar: {
    id: "ospar",
    name: "OSPAR Commission / Beaufort's Dyke records",
    publisher: "OSPAR Secretariat",
    url: "https://www.ospar.org/",
    licence: "PUBLIC-DOMAIN",
    lastChecked: "2026-10-04",
    notes:
      "Ordinance and chemical waste dumping in Beaufort's Dyke. Ca 14,000 tonnes phosgene artillery rockets, >1 million tonnes conventional munitions, ~2 tonnes low-level radioactive waste. MoD lost most disposal records (disclosed April 2020), so completeness is unestablished rather than disproved.",
  },
  orsted: {
    id: "orsted",
    name: "Mooir Vannin project documentation",
    publisher: "Ørsted",
    url: "https://cdn.orsted.com/-/media/www/docs/corp/uk/im/240214mooirvanninsummaryreportv60-08654899a-1.pdf",
    licence: "PUBLIC-DOMAIN",
    lastChecked: "2026-10-04",
    notes: "~1.4 GW, up to 100 turbines, 6-12 nm off Maughold Head, within IoM territorial seas. Agreement for Lease granted November 2015.",
  },
  crownestate: {
    id: "crownestate",
    name: "The Crown Estate offshore wind leasing",
    publisher: "The Crown Estate",
    url: "https://www.thecrownestate.co.uk/our-business/marine/offshore-wind/morgan-offshore-wind-site",
    licence: "PUBLIC-DOMAIN",
    lastChecked: "2026-10-04",
    notes: "Morgan site: 22.22 km from the Isle of Man. Development discontinued January 2026; retendered July 2026.",
  },
  spaceman: {
    id: "spaceman",
    name: "Spaceman teleport / aql Space Services",
    publisher: "aql (formerly BlueWave Communications)",
    url: "https://spaceman.im/",
    licence: "PUBLIC-DOMAIN",
    lastChecked: "2026-10-04",
    notes:
      "Satellite teleport at 54.1390 N, -4.4951 — 2 km east of Douglas. Site lineage: SES announced an IoM teleport in Sept 2016, withdrew summer 2021; BlueWave acquired ~2020. Starlink licensed 2021 via BlueWave partnership.",
  },
  opentopomap: {
    id: "opentopomap",
    name: "OpenTopoMap tiles",
    publisher: "OpenTopoMap (based on OpenStreetMap, SRTM)",
    url: "https://opentopomap.org/",
    licence: "CC-BY-4.0",
    lastChecked: "2026-10-04",
    notes: "CC-BY-SA derived map data on ODbL geometry. Raster, keyless, ACAO *.",
  },
  emodnet: {
    id: "emodnet",
    name: "EMODnet Bathymetry",
    publisher: "EMODnet / European Commission",
    url: "https://emodnet.ec.europa.eu/en/bathymetry",
    licence: "CC-BY-4.0",
    lastChecked: "2026-10-04",
    notes:
      "Free, keyless, CORS *. The old services.emodnet-geoservices host no longer resolves — moved to tiles.emodnet-bathymetry.eu. Gotcha: the WMTS layer id (mean_multicolour_latest) differs from the URL path segment (latest/mean_multicolour); use the path.",
  },
  awsTerrain: {
    id: "awsTerrain",
    name: "AWS Open Data — Terrain Tiles (Mapzen/Joerd)",
    publisher: "Mapzen (Linux Foundation) / AWS Open Data",
    url: "https://registry.opendata.aws/terrain-tiles/",
    licence: "COPERNICUS",
    lastChecked: "2026-10-11",
    notes:
      "Keyless global bare-earth elevation tiles on S3 (elevation-tiles-prod), CORS *. Terrarium encoding, maxzoom 15. Over the Isle of Man the contributing layers are Copernicus EU-DEM (Europe) and SRTM (public domain, USGS); attribution: 'Produced using Copernicus data and information funded by the European Union - EU-DEM layers' plus 'SRTM data courtesy of the U.S. Geological Survey'.",
  },
  openmannin: {
    id: "openmannin",
    name: "OpenMannin compilation",
    publisher: "OpenMannin",
    url: "https://github.com/",
    licence: "OGL-IoM",
    lastChecked: "2026-10-04",
    notes: "Our own compilation from the registered sources above.",
  },
};