import type { Source } from "./types";

/**
 * Source register. Every layer points at one of these.
 * `lastChecked` is a hand-verified date, not a build timestamp — be honest
 * about when a human actually read the page.
 */
export const SOURCES: Record<string, Source> = {
  manngis: {
    id: "manngis",
    name: "MANNGIS (Manx National Mapping and GIS) ArcGIS REST services",
    publisher: "Isle of Man Government — Department of Infrastructure",
    url: "https://manngis.maps.arcgis.com/",
    licence: "OGL-IoM-DERIVED",
    lastChecked: "2026-10-04",
    notes:
      "MANNGIS IS NOT OPEN SOURCE. It is a pan-government system established in 1992, running on proprietary Esri ArcGIS. IMPORTANT LICENCE SPLIT: the Crown copyright applies to the DERIVED feature services published through the open data portal (what we consume), but the Isle of Man Survey BASE CARTOGRAPHY is explicitly EXCLUDED from the Open Government Licence and sold as a commercial product — the high-resolution vector and digital map data, DTM, LiDAR, contour and raster series all require specific licensing. Never composite our MANNGIS vectors over their base tiles without a licence. No API key needed for the derived services. 564 public items, 51 feature services. Undocumented on the gov.im open data pages — this is the real open-data goldmine.",
  },
  iomsurvey: {
    id: "iomsurvey",
    name: "Isle of Man Survey — Digital Map Data",
    publisher: "Isle of Man Government — Isle of Man Survey",
    url: "https://www.gov.im/about-the-government/departments/infrastructure/mapping/",
    licence: "UNKNOWN",
    lastChecked: "2026-10-04",
    notes:
      "NOT OPEN. Commercial products: 1:1,250 and 1:2,500 DXF/GIS, 1:10,000 raster TIFF/DXF, 1:25,000-1:100,000 raster TIFF, contour DXF/NTF, 20 m and 50 m ASCII DTM, and LiDAR (purchase only). The complete set is free ONLY to a researcher or student at an eligible higher education institution under a Digital Map Data agreement. Contact mapping@gov.im.",
  },
  manngisPortal: {
    id: "manngisPortal",
    name: "MANNGIS Open Data Portal",
    publisher: "Isle of Man Government",
    url: "https://manngis.maps.arcgis.com/",
    licence: "OGL-IoM-DERIVED",
    lastChecked: "2026-10-04",
    notes:
      "The government's public platform for analysing, combining and downloading selected open datasets to build web or mobile applications. This is the sanctioned front door for what we consume via REST.",
  },
  osmIOM: {
    id: "osmIOM",
    name: "OpenStreetMap — WikiProject Isle of Man",
    publisher: "OpenStreetMap contributors",
    url: "https://www.openstreetmap.org/wiki/WikiProject_Isle_of_Man",
    licence: "ODbL",
    lastChecked: "2026-10-04",
    notes:
      "Highly detailed and genuinely open. Historically the Isle of Man Government has supported this community by occasionally donating small-scale maps and historic aerial imagery. This is our route to seamarks and the partial mine features that MANNGIS lacks.",
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
  findmybus: {
    id: "findmybus",
    name: "FindMyBus.im live vehicle feed (SignalR)",
    publisher: "Isle of Man Public Transport / Bus Vannin",
    url: "https://www.findmybus.im/",
    licence: "NO-LICENCE",
    lastChecked: "2026-10-04",
    notes:
      "Undocumented internal PDMS feed. Payload captured by hand: SignalR JSON hub, hub method 'TransportData', 10 pipe-delimited fields. No robots.txt (404), no terms page. F5 WAF in front. Reference is officially made in the Isle of Man Railways timetable PDF ('To track your Heritage Railway services in real time visit findmybus.im').",
  },
  opensky: {
    id: "opensky",
    name: "The OpenSky Network REST API",
    publisher: "OpenSky Network / ETH Zurich",
    url: "https://openskynetwork.github.io/opensky-api/rest.html",
    licence: "UNKNOWN",
    lastChecked: "2026-10-04",
    notes:
      "Terms of Use §3(vi) and the summary box require a PREVIOUS WRITTEN AGREEMENT for any 'operational' use, including integration into a live product, 'regardless of the entity's non-profit status'. Anonymous tier = 400 credits/day. CORS hard-pinned to their own origin, so server-side proxy is mandatory.",
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
  aisstream: {
    id: "aisstream",
    name: "AISStream.io",
    publisher: "AISStream (Voltron / vtex.ai)",
    url: "https://aisstream.io/",
    licence: "NO-LICENCE",
    lastChecked: "2026-10-04",
    notes:
      "Free WebSocket, no SLA, no published terms document. Direct browser connections explicitly prohibited. Max 3 connections per account and 3 per originating IP — forces a single server-side ingest with internal fan-out.",
  },
  gfw: {
    id: "gfw",
    name: "Global Fishing Watch API v3",
    publisher: "Global Fishing Watch Foundation",
    url: "https://globalfishingwatch.org/",
    licence: "CC-BY-NC-4.0",
    lastChecked: "2026-10-04",
    notes:
      "Free token, instant. 50,000/day and 1,500,000/month. Token must NOT be exposed client-side. Mandatory 'Powered by Global Fishing Watch' attribution.",
  },
  openmeteo: {
    id: "openmeteo",
    name: "Open-Meteo weather and marine API",
    publisher: "Open-Meteo",
    url: "https://open-meteo.com/",
    licence: "CC-BY-4.0",
    lastChecked: "2026-10-04",
    notes:
      "No key. 10,000 calls/day and 300,000/month. CORS *. Free tier is NON-COMMERCIAL ONLY — their terms count subscriptions or advertising as commercial. Has waves and sea surface temperature but NO tide or sea-level-height product.",
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
  atlanticcable: {
    id: "atlanticcable",
    name: "Atlantic-Cable.com cable history",
    publisher: "Atlantic Cable (Steven Roberts / Bill Glover)",
    url: "https://atlantic-cable.com/",
    licence: "UNKNOWN",
    lastChecked: "2026-10-04",
    notes: "Standard reference for historic cable routes and landing points. Effectively the public record for pre-1950 cables.",
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
  openfreemap: {
    id: "openfreemap",
    name: "OpenFreeMap / OpenMapTiles",
    publisher: "OpenFreeMap",
    url: "https://openfreemap.org/",
    licence: "ODbL",
    lastChecked: "2026-10-04",
    notes:
      "Free, no API key, no signup, no rate limit, commercial use permitted. maxzoom is 14 — z15/z16 return HTTP 200 with a ZERO-BYTE body, which silently renders blank. Always point MapLibre at the TileJSON, never a hard-coded tile path (the dated snapshot segment changes on rebuild).",
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
  esri: {
    id: "esri",
    name: "Esri World Imagery basemap",
    publisher: "Esri / Maxar / Earthstar Geographics",
    url: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer",
    licence: "UNKNOWN",
    lastChecked: "2026-10-04",
    notes:
      "Free and keyless today with CORS *, but the ArcGIS Online basemap terms are not a contract and Esri reserves the right to change them. Technically the best keyless satellite basemap; legally the least certain. Tile order is {z}/{y}/{x}.",
  },
  ripestat: {
    id: "ripestat",
    name: "RIPEstat data API",
    publisher: "RIPE NCC",
    url: "https://stat.ripe.net/",
    licence: "NO-LICENCE",
    lastChecked: "2026-10-04",
    notes:
      "Keyless JSON, CORS *. Used as the authoritative registry of which ASNs are registered to country IM (country-asns with lod=1, which returns 27 registered / 16 routed and the actual ASN set) and of what each currently announces in BGP (announced-prefixes). GOTCHA: country-asns WITHOUT lod=1 returns only a count and no list, which reads misleadingly as 'zero'. RIPE NCC data is free to use with attribution but no formal open licence is published for RIPEstat output. RIPE Database's own search API is unusable for discovery here — every query-string + type-filter combination returns ERROR:115, including plain country:GB.",
  },
  companiesRegistry: {
    id: "companiesRegistry",
    name: "Companies Registry — public company search",
    publisher: "Isle of Man Government — Department of Economic Affairs",
    url: "https://services.gov.im/ded/services/companiesregistry/companysearch.iom",
    licence: "OGL-IoM",
    lastChecked: "2026-10-04",
    notes:
      "FREE public fields without login: name, company number, type, status, registered office, registered agent, date of incorporation, presence of charges, liquidation flag, receivers flag, and a count of filed documents. PAID/ACCOUNT-GATED: documents (annual returns, accounts, confirmation statements), officer details, charges and mortgages. We therefore build deep links only and never scrape or republish records. Search form verified as GET with two parameters: searchby (0 = name, 1 = number) and searchtext. robots.txt is served by an F5 WAF that rejects non-browser clients, so crawl permissions are UNKNOWN — another reason to link rather than scrape. A newer portal exists at https://centralregistry.gov.im/ but is a JavaScript SPA with no crawlable profile URLs.",
  },
  financialServicesAuthority: {
    id: "financialServicesAuthority",
    name: "Isle of Man Financial Services Authority registers",
    publisher: "Isle of Man FSA",
    url: "https://www.iomfsa.im/registers/",
    licence: "OGL-IoM",
    lastChecked: "2026-10-04",
    notes:
      "Separate regulator with its own public registers of regulated entities (banks, insurers, funds, trusts, companies, persons). Distinct from the Companies Registry: a regulated entity here is not necessarily an incorporated company. Public search, deep-link only.",
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
  webcamsGov: {
    id: "webcamsGov",
    name: "Isle of Man Government public webcams",
    publisher: "Isle of Man Government (images.gov.im)",
    url: "https://www.gov.im/webcams/",
    licence: "OGL-IoM",
    lastChecked: "2026-10-04",
    notes:
      "10 snapshot JPEGs, no key, hotlinking works, no referrer check. No CORS headers (so <img> works, canvas pixel readback does not). Cache-Control: no-cache. AWS WAF challenge fires on ~50-70% of non-browser requests. No published grant for third-party reuse of the IMAGES specifically. No MJPEG/HLS stream exists. Published coordinates not found — our pins are geolocated by eye from the pages and must be treated as approximate.",
  },
  metoffice: {
    id: "metoffice",
    name: "UK Met Office DataHub",
    publisher: "UK Met Office",
    url: "https://datahub.metoffice.gov.uk/",
    licence: "CC-BY-4.0",
    lastChecked: "2026-10-04",
    notes:
      "Requires an API key AND an active plan subscription; there is no anonymous tier. 'Powered by Met Office data' attribution is mandatory. API v1 is being retired 2026-11-11 and v2 needs a brand new key. Ronaldsway observations run hourly and continuously since 7 May 1946.",
  },
};