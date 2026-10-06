import type { Gap, LayerDef } from "./types";

const MANNGIS = "https://services3.arcgis.com/dBlcVWoJgxxpCttN/ArcGIS/rest/services";
const PROD_DEFA =
  "https://utility.arcgis.com/usrsvcs/servers/741cd72e54164c3c92d8a944346109e7/rest/services/CorporateDynamicServices/ProdDEFA/MapServer";
const PROD_DOI =
  "https://utility.arcgis.com/usrsvcs/servers/1d5a1493ee7a45ffa8d1f6558dff2fdc/rest/services/CorporateDynamicServices/ProdDOI/MapServer";

/**
 * The layer registry.
 *
 * Ordering rules that matter:
 *  1. `confidence: "D"` layers are never `defaultOn`.
 *  2. Anything with a licence of `NO-LICENCE` or `UNKNOWN` that also has
 *     `requiresPermission` gets a visible badge in the layer panel. We render
 *     it because it is genuinely informative, not because we are entitled to.
 *  3. Feature counts are what the ingest script measured on 2026-10-04. They
 *     are hints for the reader, not promises.
 */
export const LAYERS: LayerDef[] = [
  // ==========================================================================
  // GEOGRAPHY
  // ==========================================================================
  {
    id: "toponyms",
    label: "Place names",
    group: "geography",
    kind: "geojson",
    file: "toponyms.geojson",
    color: "#8b8b8b",
    defaultOn: true,
    minZoom: 11,
    description:
      "1,253 distinct named places from OpenStreetMap: towns, villages, hamlets, localities and suburbs. Ordered by significance (OSM place_rank where mapped, otherwise derived from the place type) so a label renderer can drop the least significant first. Includes wikidata IDs where mapped.",
    caveats: [
      "NOT an official national gazetteer. MANNGIS does not publish one — see the gazetteer gap entry. These are OSM names, so coverage and preferred spelling vary with local mapping activity.",
      "Includes historic and alternative spellings (Manx, Irish and English variants) where mappers recorded them.",
      "Attribution required: (c) OpenStreetMap contributors, ODbL.",
    ],
    confidence: "B",
    sourceId: "osmIOM",
    featureCount: 1253,
  },
  {
    id: "field-parcels",
    label: "Agricultural field parcels",
    group: "geography",
    kind: "geojson",
    file: "field-parcels.geojson",
    color: "#a3a380",
    defaultOn: false,
    minZoom: 13,
    description:
      "19,848 field parcels with land-use category, current occupation and acreage. Despite being called 'Field Gazetteer' in MANNGIS, this layer contains no names at all.",
    caveats: [
      "UNNAMED. This is agricultural parcel data, not a gazetteer. It was previously published here mislabelled as place names, which was wrong; it now has its own entry and the place-name layer comes from OSM.",
      "Rendered as anchor points only. The parcel boundaries are not carried, so this is a density/hint layer, not a cadastral layer.",
      "Occupation and usage codes are live land management, so they change without notice.",
    ],
    confidence: "A",
    sourceId: "manngis",
    featureCount: 19848,
  },
  {
    id: "glens",
    label: "Glens",
    group: "geography",
    kind: "geojson",
    file: "glens.geojson",
    color: "#5f7a4a",
    defaultOn: false,
    description: "Officially mapped glen boundaries. 22 polygons.",
    confidence: "A",
    sourceId: "manngis",
    featureCount: 22,
  },
  {
    id: "ramblage",
    label: "Public land open to rambling",
    group: "geography",
    kind: "geojson",
    file: "ramblage.geojson",
    color: "#6b8e5a",
    defaultOn: true,
    description:
      "Land where the public has a statutory right to roam. 7 records. This is the CGMRA land, not the full PROW network.",
    caveats: [
      "Right to roam is a land classification, NOT a path network. There is no guaranteed route across these polygons.",
      "The definitive Public Rights of Way map is maintained by DoI in Central Registry and is NOT open. See the PROW layer for what is published.",
    ],
    confidence: "A",
    sourceId: "manngis",
    featureCount: 7,
  },
  {
    id: "builtings",
    label: "Registered buildings",
    group: "geography",
    kind: "geojson",
    file: "registered-buildings.geojson",
    color: "#a6785a",
    defaultOn: false,
    minZoom: 14,
    description:
      "338 buildings on the statutory building list, with registration number, date registered, address, grade, case reference and a hyperlink to the certificate.",
    caveats: ["Register entry is not a statement of structural condition."],
    confidence: "A",
    sourceId: "manngis",
    featureCount: 338,
  },
  {
    id: "trees",
    label: "Registered trees",
    group: "geography",
    kind: "geojson",
    file: "registered-trees.geojson",
    color: "#3f7d3f",
    defaultOn: false,
    minZoom: 15,
    description: "1,199 individually registered trees and tree areas.",
    confidence: "A",
    sourceId: "manngis",
    featureCount: 1199,
  },

  // ==========================================================================
  // TRAILS AND ROADS
  // ==========================================================================
  {
    id: "roads",
    label: "Road hierarchy",
    group: "trails",
    kind: "geojson",
    file: "roads.geojson",
    color: "#8d8577",
    defaultOn: true,
    description:
      "3,391 road segments with the publisher's own hierarchy and UK road-class attributes.",
    caveats: [
      "The `RoadNo` field is noisy: 1,909 distinct values across 3,391 segments, of which only 50 begin with 'A' (A1-A47 plus A1t, A3t, A18e) and 82 with 'B'. 203 segments have a blank RoadNo.",
      "The `USRN` field is 100% null across every record. It is unusable.",
      "Do not filter on RoadNo alone to build an A-road network — the field is reference fragments, not a clean classification. Use the publisher's `Hierarchy` / `RoadClass` fields instead.",
      "There are NO published traffic-count or A18 volume datasets. That requires an FOI request to Highway Services.",
    ],
    confidence: "A",
    sourceId: "manngis",
    featureCount: 3391,
  },
  {
    id: "prow",
    label: "Public Rights of Way (published subset)",
    group: "trails",
    kind: "geojson",
    file: "prow.geojson",
    color: "#c2410c",
    defaultOn: true,
    description:
      "365 records with a definitive-map reference and a numeric length. Rights of way under the Road Traffic (Registration, Licensing) framework.",
    caveats: [
      "This is NOT the definitive PROW map. The layer's own description states the definitive map is maintained by DoI and made available via Central Registry — it is gated, not open.",
      "32 PROW_No values are duplicated (333 distinct across 365 rows), so row count overstates unique rights.",
    ],
    confidence: "A",
    sourceId: "manngis",
    featureCount: 365,
  },
  {
    id: "footpaths",
    label: "Footpaths (DEFA)",
    group: "trails",
    kind: "geojson",
    file: "footpaths.geojson",
    color: "#d97706",
    defaultOn: false,
    minZoom: 13,
    description: "476 footpath records held by the Environment, Food and Agriculture Directorate.",
    caveats: [
      "Overlaps with PROW and with the MANNGIS footpath inspection layer. There is no single reconciled national path graph.",
      "The publisher's own description warns this is not the definitive PROW layer.",
    ],
    confidence: "A",
    sourceId: "manngis",
    featureCount: 476,
  },
  {
    id: "walking",
    label: "Promoted walking routes",
    group: "trails",
    kind: "geojson",
    file: "walking-routes.geojson",
    featureCount: 90,
    color: "#16a34a",
    defaultOn: true,
    description:
      "Raad ny Foillan (5 stages, Douglas-Port St Mary-Dalby-Sartfield-Maughold-Douglas), Bayr ny Skeddan, Millennium Way, 9 Manx Electric Railway Walks, 11 Railway Station Walks and the Wardens Walks.",
    caveats: ["The service is labelled 'TEST' and was last edited July 2022."],
    confidence: "A",
    sourceId: "manngis",
  },
  {
    id: "cycling",
    label: "Cycle routes (5 + 7 MTB)",
    group: "trails",
    kind: "geojson",
    file: "cycling-routes.geojson",
    featureCount: 13,
    color: "#0891b2",
    defaultOn: false,
    description:
      "Five numbered road routes (1 Ramsey, 2 Douglas, 3 Peel, 4 Castletown, 5 Port Erin) and seven MTB routes (A Grand Day Out, Southern Comfort, Witches Barrel, St Lukes & Windy Corner, Hell's 8, The Camel's Back, South Barrule Trails).",
    caveats: [
      "There is NO National Cycle Network and no Sustrans route on the Isle of Man. Earlier claims of an 'NCN Loop' are incorrect.",
      "This dataset was created in September 2015 and contains withdrawn routes.",
    ],
    confidence: "A",
    sourceId: "manngis",
  },
  {
    id: "pilgrimage",
    label: "Pilgrimage walks",
    group: "trails",
    kind: "geojson",
    file: "pilgrimage-walks.geojson",
    featureCount: 23,
    color: "#7c3aed",
    defaultOn: false,
    description: "Published pilgrimage walk alignments.",
    confidence: "A",
    sourceId: "manngis",
  },
  {
    id: "bridges",
    label: "Highway bridges",
    group: "trails",
    kind: "geojson",
    file: "bridges.geojson",
    color: "#78716c",
    defaultOn: false,
    minZoom: 12,
    description: "190 highway structures maintained for the road network.",
    confidence: "A",
    sourceId: "manngis",
    featureCount: 190,
  },
  {
    id: "speedlimits",
    label: "Speed limits",
    group: "trails",
    kind: "geojson",
    file: "speed-limits.geojson",
    color: "#dc2626",
    defaultOn: false,
    minZoom: 12,
    description: "7,142 posted speed limit segments.",
    caveats: [
      "This is the posted-limit dataset. It is NOT the IoM Safety Camera Scheme — no speed-camera scheme is evidenced anywhere in official sources. The Constabulary 'speed restrictions' page covers vehicle limits only.",
    ],
    confidence: "A",
    sourceId: "manngis",
    featureCount: 7142,
  },

  // ==========================================================================
  // TRANSPORT
  // ==========================================================================
  {
    id: "bus-stops",
    label: "Bus stops",
    group: "transport",
    kind: "geojson",
    file: "bus-stops.geojson",
    color: "#2563eb",
    defaultOn: true,
    minZoom: 13,
    description:
      "732 bus stops from OpenStreetMap with per-stop services. Official MANNGIS stop numbers and NaPTAN codes are matched where they exist.",
    caveats: [
      "Per-stop services are a best-effort merge: OSM route relations where they exist (current but partial — only 44 stops are members), otherwise a spatial join against the site's own bus-routes layer, which is a DOCUMENTED 2015 network. Route numbers change less often than timetables, but VERIFY against current timetables (iombusandrail.im) before relying on services.",
      "Official stop numbers and NaPTAN codes are matched from the MANNGIS Bus Stops layer (© IoM Government, OGL — derived) where a stop carries the same ref or is within 150 m; stops beyond that carry only OSM identifiers.",
      "Attribution required: (c) OpenStreetMap contributors, ODbL.",
    ],
    confidence: "B",
    sourceId: "osmIOM",
    featureCount: 732,
  },
  {
    id: "postcodes",
    label: "Postcodes",
    group: "transport",
    kind: "geojson",
    file: "postcodes.geojson",
    color: "#a78bfa",
    defaultOn: false,
    minZoom: 10,
    description:
      "1,414 postcode centroids derived from OSM addr:postcode tags. Each point is the mean of all addresses sharing that postcode.",
    caveats: [
      "Postcode centroids are approximate — a postcode covers a street or block, not a point.",
      "Coverage depends on OSM mapping activity. Rural and newly-built areas may be missing postcodes.",
      "Attribution required: (c) OpenStreetMap contributors, ODbL.",
    ],
    confidence: "C",
    sourceId: "osmIOM",
    featureCount: 1414,
  },
  {
    id: "house-numbers",
    label: "House numbers",
    group: "transport",
    kind: "geojson",
    file: "house-numbers.geojson",
    color: "#34d399",
    defaultOn: false,
    minZoom: 14,
    description:
      "6,949 address points from OSM addr:housenumber tags. Each point is a building or entrance with a house number and street name.",
    caveats: [
      "Coverage depends on OSM mapping activity. Rural and newly-built areas may be incomplete.",
      "Attribution required: (c) OpenStreetMap contributors, ODbL.",
    ],
    confidence: "C",
    sourceId: "osmIOM",
    featureCount: 6949,
  },
  {
    id: "parish-boundaries",
    label: "Parish boundaries",
    group: "transport",
    kind: "geojson",
    file: "parish-boundaries.geojson",
    color: "#f59e0b",
    defaultOn: false,
    minZoom: 8,
    description:
      "Parish boundaries from OSM admin_level=8 relations. The Isle of Man has 17 ancient parishes.",
    caveats: [
      "Parish boundaries are from OSM (admin_level=8). They are community-mapped and may not match exact legal boundaries.",
      "Attribution required: (c) OpenStreetMap contributors, ODbL.",
    ],
    confidence: "C",
    sourceId: "osmIOM",
    featureCount: 17,
  },
  {
    id: "bus-routes",
    label: "Bus route alignments",
    group: "transport",
    kind: "geojson",
    file: "bus-routes.geojson",
    color: "#60a5fa",
    defaultOn: false,
    minZoom: 11,
    description:
      "92 route/direction features across the publisher's six regions (North, South, East, West, West/North, South/West).",
    caveats: ["Stale (October 2015) and should not be presented as the current network."],
    confidence: "C",
    sourceId: "manngis",
    featureCount: 92,
  },
  {
    id: "railways",
    label: "Railways & tramways",
    group: "transport",
    kind: "geojson",
    file: "railways.geojson",
    color: "#111827",
    defaultOn: true,
    description:
      "Official track geometry with lengths. Every railway on the Isle of Man is HERITAGE and seasonal — there is no mainline rail. Manx Electric Railway 58,775 m; Isle of Man Steam Railway 28,086 m; Snaefell Mountain Railway 15,780 m; Horse Trams 5,637 m; Groudle Glen Railway 1,165 m; Queens Pier Track 677 m; Great Laxey Mine Railway 304 m across two segments.",
    caveats: [
      "Opening dates: Manx Electric Railway 1893, Snaefell Mountain Railway 1895, Isle of Man Steam Railway 1873. The commonly repeated claim that the Snaefell railway opened in 1893 is wrong — 1893 is the Manx Electric Railway.",
      "The government dataset misspells Groudle Glen as 'Groudel'. The operator uses 'Groudle'.",
      "The dataset omits gauge. Commonly cited figures (3 ft 6 in for the Steam Railway, 3 ft for the Electric) are NOT verified against a primary source.",
      "Groudle Glen Railway and the Great Laxey Mine Railway are ABSENT from the live vehicle feed — they are not part of Bus Vannin.",
    ],
    confidence: "A",
    sourceId: "manngis",
    featureCount: 8,
  },
  {
    id: "tt-course",
    label: "TT course",
    group: "transport",
    kind: "geojson",
    file: "tt-course.geojson",
    featureCount: 749,
    color: "#dc2626",
    defaultOn: true,
    minZoom: 11,
    description: "The Isle of Man TT mountain course, published as 'MotorCourse (TT/Billown) Course Infrastructure'.",
    caveats: [
      "The widely quoted 37.73 mile / 60.72 km length is Wikipedia-only. No official linear referencing (LGL) has been published, so mileages on this layer are absent rather than estimated.",
    ],
    confidence: "A",
    sourceId: "manngis",
  },
  {
    id: "ev",
    label: "EV charging sites",
    group: "transport",
    kind: "geojson",
    file: "ev-charging.geojson",
    color: "#10b981",
    defaultOn: true,
    minZoom: 12,
    description:
      "15 public sites, 35 sockets, all owned by Manx Utilities. Mostly Pod Point Type 2 at 7 kW; the Bungalow (on the TT course) is 22 kW 3-phase. Includes Manx Utilities HQ, police HQ, Market Square Ramsey and Market Square Peel.",
    caveats: [
      "Created November 2020, last edited August 2021. Re-verify against Manx Utilities before publishing as current.",
    ],
    confidence: "A",
    sourceId: "manngis",
    featureCount: 15,
  },
  {
    id: "traffic-signals",
    label: "Traffic signals & crossings",
    group: "transport",
    kind: "geojson",
    file: "traffic-signals.geojson",
    featureCount: 4,
    color: "#f59e0b",
    defaultOn: false,
    minZoom: 13,
    description: "Traffic signals, speed signs, zebra crossings and variable-message matrix signs.",
    caveats: [
      "The published signal layer returns only 2 features, which is anomalously low. The real inventory is likely in the maintenance tables.",
      "The gov.im 'Live Road Information' open-data entry is BROKEN — it is bare text with no href. What it actually points at is a variable-message-sign STATUS page (12 signs, 'no message' or 'OFFLINE'), containing no congestion, speed, flow or vehicle data whatsoever. Three of twelve signs were offline during testing.",
    ],
    confidence: "A",
    sourceId: "manngis",
  },
  {
    id: "coastal-access",
    label: "Coastal access points",
    group: "transport",
    kind: "geojson",
    file: "coastal-access.geojson",
    featureCount: 40,
    color: "#0ea5e9",
    defaultOn: false,
    minZoom: 12,
    description: "Published access points to the coastline.",
    confidence: "A",
    sourceId: "manngis",
  },

  // ==========================================================================
  // SUBSEA CABLES
  // ==========================================================================
  {
    id: "subsea-cables",
    label: "Submarine cables",
    group: "cables",
    kind: "geojson",
    file: "subsea-cables.geojson",
    color: "#e11d48",
    defaultOn: false,
    dashed: true,
    minZoom: 5,
    featureCount: 5,
    description:
      "Five cables with surveyed alignment geometry inside IoM waters: the IOM/UK Interconnector (E-LLAN, a 90 kV power interconnector to England), plus four telecommunications systems — BT-Mt 1, BT-Manx NI, and the LANIS 1 and LANIS 2 pairs. Alignment comes from OpenStreetMap seamarks; the authoritative inventory of type, capacity and commissioning date is Manx Utilities' Chapter 6 tables.",
    caveats: [
      "LINES ARE CLIPPED TO A BOUNDING BOX covering IoM waters, not to a legal territorial sea boundary, and not to a surveyed landing point. Endpoints are a simplification. Do not use for navigation, seabed tenure or fishing-gear hazard assessment.",
      "Hibernia A, Hibernia C, Scotland-N.Ireland 1 and ESAT 2 are absent because they transit the area without entering IoM waters. That is a real finding, not a data gap, and it is recorded rather than papered over.",
      "Cable class is explicit only where OSM carries power=cable. The four telecoms cables are INFERRED from their operator (BT, Cable & Wireless) because OSM has no telecom category tag; cableClassSource records this per feature.",
      "Capacity, ownership and commissioning dates are authoritative in MMEA Chapter 6 but are not joined per-feature here: joining OSM ways to MEA rows is a name match, and a wrong join would assert false facts about infrastructure.",
      "Do not attribute Irish Sea nuclear weapons tests here. Operation Buffalo and Hurricane were Australian. Beaufort's Dyke received ordnance and chemical-agent DUMPING, not tests.",
    ],
    confidence: "B",
    sourceId: "osmSeamarks",
  },
  {
    id: "cable-landings",
    label: "Cable landings",
    group: "cables",
    kind: "geojson",
    file: "cable-landings.geojson",
    color: "#f43f5e",
    defaultOn: false,
    minZoom: 8,
    featureCount: 4,
    description:
      "Four shore-end settlements named in the Manx Utilities cable inventory: Douglas Head (the electricity interconnector landfall), Port Grenaugh, Peel and Groudle. The MEA publishes landfalls as place names — the nearest town — not as surveyed cable positions, so each point is a Nominatim place centroid.",
    caveats: [
      "GRADE C COORDINATES. A landfall is wherever the cable enters the sea; these points are the named settlement centroid and may sit inland from the actual shore end. Do not use them to identify a cable route on the ground.",
      "The MEA Admiralty chart showing precise landing positions is Crown/SeaZone copyright and is not reproduced here.",
      "Landfalls on the mainland side (Bispham, Silecroft Beach, Blackpool, Lough Shinny, Ballywater) are outside this layer's scope and are deliberately not drawn.",
      "Resilience note: E-LLAN, CC-2's UK leg and LANIS-1 all make landfall within the same Blackpool/Bispham coastal strip. That concentration is a far narrower single point of failure than 'several independent cables' suggests. LANIS-1 failed 600 m off Port Grenaugh on 27 November 2006 and took island-wide internet down.",
    ],
    confidence: "C",
    sourceId: "mea",
  },
  {
    id: "historic-cables",
    label: "Historic & remnant cables",
    group: "cables",
    kind: "geojson",
    file: "historic-cables.geojson",
    color: "#78716c",
    defaultOn: false,
    minZoom: 8,
    description:
      "Four documented landing PLACES, not routes. The 1859 Point Cranstal-St Bees telegraph cable (36 miles, the first cable ever to the IoM and the first use of outer servings on a submarine cable) first landed at Cranstal in Bride and was relocated to Port Cornaa after tidal damage. Also recorded: remnants at Port Grenaugh, and two short cables in The Sound possibly linking to the Calf of Man.",
    caveats: [
      "THESE ARE PLACES, NOT CABLE POSITIONS. Each point is a Nominatim centroid for the named landing settlement, not a surveyed cable landing or a recovered wreck.",
      "No route geometry is published. The alignments of the 1859 and 1942 systems are not available in any reusable machine-readable form, and inferring a line between two landing points would assert a survey nobody has made.",
      "ATLANTIC-CABLE.COM CARRIES NO EXPLICIT LICENCE and is graded UNKNOWN, so this layer renders with a permission warning in the UI. Treat the history as public record, not as a grant to republish.",
      "The two cables in The Sound are described in the source as 'possibly linking to the Calf of Man'. That attribution is uncertain and is flagged, not resolved.",
      "The 1942 Anglesey-IoM Post Office cable (first use of a submerged repeater) is NOT plotted: no landing place for it could be established from the source consulted.",
      "Wreck positions and seabed debris are not included; those need a hydrographic or archaeological source and are a separate question from where a cable landed.",
    ],
    confidence: "C",
    sourceId: "atlanticcable",
    featureCount: 4,
  },

  // ==========================================================================
  // INFRASTRUCTURE
  // ==========================================================================
  {
    id: "ports",
    label: "Ports & harbours",
    group: "infrastructure",
    kind: "geojson",
    file: "ports.geojson",
    color: "#0f766e",
    defaultOn: false,
    minZoom: 8,
    description:
      "The nine statutory ports of the Isle of Man — Douglas, Ramsey, Peel, Castletown, Port Erin, Port St Mary, Laxey, Port Cornaa and Groudle — plus 13 mapped harbour areas, Douglas and Peel marinas and 12 piers, linkspans, groins and oil jetties. Marine Operations Centre on the 2nd floor of the Sea Terminal, Douglas, 24 hours. All eight mapped basins are tidal; the north-east approaches run about 8 m, which sizes vessels above roughly 7 m out of the island.",
    caveats: [
      "Two of the nine statutory ports, PORT CORNAA and GROUDLE, HAVE NO MAPPED HARBOUR GEOMETRY in any source consulted. They appear as grade-C settlement centroids with geometryPresent=false. Their positions are place names, NOT harbour boundaries, and no basin outline should be inferred.",
      "Douglas Inner Harbour Marina and Peel Marina are marinas WITHIN Douglas and Peel, not ports in their own right. They are flagged subsidiaryOfStatutoryPort and are excluded from the statutory count.",
      "No berth or pontoon allocation data exists. Nothing here indicates who may occupy a given pontoon.",
      "Several piers cite the Isle of Man Government 1:25000 map (2007) as upstream source, so those outlines are at best 2007 vintage.",
      "Douglas Harbour and Peel Harbour each exist as OVERLAPPING mapped areas in OSM. Both are retained; merging them would assert a boundary nobody has published.",
      "Depth surveys, dredged channels, marine limits and licensing conditions are NOT represented. Not for pilotage or navigation.",
      "Coastguard +44 1624 661664. Port security +44 1624 686631/2. Ferry operator is the Isle of Man Steam Packet Company on Douglas-Heysham-Liverpool-Belfast-Dublin.",
    ],
    confidence: "B",
    sourceId: "osmHarbours",
    featureCount: 27,
  },
  {
    id: "satellite",
    label: "Satellite ground stations",
    group: "infrastructure",
    kind: "geojson",
    file: "satellite-stations.geojson",
    color: "#a855f7",
    defaultOn: false,
    minZoom: 10,
    description:
      "Two features, because two sites is how many have a citable position — not how many exist. The Spaceman teleport (aql Space Services, formerly BlueWave Communications) at 54.1390 N, -4.4951, about 2 km east of Douglas: carrier-neutral, chosen for low horizon clutter and separately allocated spectrum, with dark fibre into the aql UK network and access to BlueWave masts including the adjacent 40 m CARNANE1 tower. Also the IOMS GNSS reference station at the airport, documented in OS Net and Leica SmartNet.",
    caveats: [
      "THIS LAYER HAS TWO FEATURES BECAUSE ONLY TWO SITES HAVE A CITABLE POSITION. It is not a survey of satellite infrastructure on the island. A sparse layer must not be read as an absence of infrastructure.",
      "STARLINK IS NOT PLOTTED. Starlink is licensed on the island via a BlueWave partnership, CURA having confirmed a licence in 2021, but dish coordinates appear only on third-party trackers with no operator confirmation.",
      "Arqiva's 'Chalfont' teleport is in BUCKINGHAMSHIRE, NOT the Isle of Man. A widely repeated Data Center Dynamics claim to the contrary is wrong. It is excluded deliberately.",
      "No OneWeb, Galileo or BeiDou ground infrastructure has been located either way. Absence here is not evidence of absence on the ground.",
      "The IOMS GNSS reference station is positioned at the EGNS aerodrome reference point because the station's own surveyed position is not published. That is accurate to the airfield, NOT to the antenna. Do not use it for survey-grade work. It is also a positioning reference, not a communications downlink.",
      "The Spaceman site lineage matters: SES announced an IoM teleport in September 2016 and withdrew in summer 2021; BlueWave acquired the site around 2020.",
      "Spectrum licensing is administered by CURA, and there is no public earth-station licence register for IoM-located sites, so this layer cannot be made exhaustive without operator or regulator cooperation.",
      "Dish positions change. Ground stations are re-pointed, added and decommissioned, and this layer was not resurveyed after its source date. Predicted pass windows for these two sites are on the separate Satellite pass predictions layer.",
    ],
    confidence: "B",
    sourceId: "spaceman",
    featureCount: 2,
  },
  {
    id: "dumpsites",
    label: "Chemical & ordnance dumpsites",
    group: "infrastructure",
    kind: "geojson",
    file: "dumpsites.geojson",
    color: "#ea580c",
    defaultOn: false,
    minZoom: 5,
    description:
      "Beaufort's Dyke: a glacial tunnel valley in the North Channel, 200-312 m deep, a designated MoD ordnance disposal ground after WWI and the UK's largest offshore dump site post-WWII. Over 1 million tonnes of conventional munitions; ~14,000-14,500 tonnes of 5-inch artillery rockets with phosgene dumped July 1945 plus ~14,000 t phosgene loose-dumped 1946-47; ~2 tonnes of low-level radioactive waste in concrete-encased drums authorised in the 1950s-60s. Dumping closed under the London and Oslo Conventions 1972, last dumping ~1976. A magnitude 2.5 explosion was registered on 8 February 1986. Shown as a grade-C indicative 50 x 3.5 km corridor along the OSPAR disposal axis, plus the grade-B axis itself.",
    caveats: [
      "*** THIS POLYGON IS AN INDICATIVE CORRIDOR, NOT A SURVEYED DISPOSAL BOUNDARY. *** It is reconstructed from two OSPAR inventory points (entries 16 and 19), the published 50 km x 3.5 km dimensions and the cited centre point. IT MUST NOT be used to determine whether a location is safe to fish, dredge, anchor or lay cable. Ordnance on the seabed is a physical hazard and an indicative boundary invites exactly the wrong inference.",
      "The 1996 Aberdeen Marine Laboratory survey (FRS 1996) found munitions and munitions-related materials at HIGH DENSITIES OUTSIDE the charted dumpsite, so the real distribution is wider than any published boundary can express.",
      "The OSPAR inventory itself flags dumpsite locations as uncertain: 'one of the major difficulties in managing the risk associated with dumpsites is the uncertainty associated with their location'.",
      "The MoD lost most disposal records, disclosed April 2020. Completeness is unestablished rather than disproved.",
      "A 1996 survey found no chemical agent or munitions-derived contaminants adjacent to the dyke in sediment, fish or shellfish. That is reassuring, not exculpatory, given the record loss.",
      "Operation Buffalo and Hurricane were AUSTRALIAN nuclear weapons tests, not British, and not at this site. Beaufort's Dyke received ordnance and chemical-agent DUMPING. Do not attribute weapons testing here.",
      "Operation Sandcastle (1955-56) scuttled three chemical-weapons ships in the Irish Sea beyond the continental shelf; it is not mapped here.",
      "Phosphorous devices and anti-tank grenades have washed ashore on Manx beaches.",
    ],
    confidence: "B",
    sourceId: "ospar",
    featureCount: 2,
  },
  {
    id: "lighthouses",
    label: "Lighthouses & seamarks",
    group: "infrastructure",
    kind: "geojson",
    file: "seamarks.geojson",
    color: "#eab308",
    defaultOn: false,
    minZoom: 10,
    description:
      "106 lights, light-vessels, beacons and buoys from OpenStreetMap, including Chicken Rock, Calf of Man, Point of Ayre and Bradda Head. Unnamed beacons are kept and flagged rather than discarded.",
    caveats: [
      "OpenStreetMap geometry, not a UKHO or Northern Lighthouse Board publication. MANNGIS has no seamark layer at all, so OSM is the only open route.",
      "Characteristics (range, colour, period) are frequently absent or simply wrong in OSM. Do not present them as authoritative for navigation.",
      "Northern Lighthouse Board publishes NO live webcam for any Manx light. Several 'Chicken Rock webcam' results are a content-farm aggregator with invented coordinates.",
      "Attribution required: (c) OpenStreetMap contributors, ODbL.",
    ],
    confidence: "B",
    sourceId: "osmIOM",
    featureCount: 106,
  },
  {
    id: "networks",
    label: "IP networks & ASNs",
    group: "infrastructure",
    kind: "geojson",
    file: "networks.geojson",
    color: "#a78bfa",
    defaultOn: false,
    minZoom: 8,
    description:
      "Every autonomous system registered to country IM, with what it currently announces in BGP. 27 ASNs registered, 16 of them routed and announcing 120 prefixes (109 IPv4, 11 IPv6). Includes Manx Telecom (AS13122, 34 prefixes), Domicilium (AS15766), Elite Group Wi-Manx (AS42455), TSG Interactive (AS43338 and AS48536), Netcetera (AS24851), Plan Communications (AS35691), Stacuity (AS197385), BlueWave/aql (AS201898) and others. Paired with a client-side IP lookup tool driven by prefix-index.json.",
    caveats: [
      "The marker is the OPERATOR'S ANCHOR, not the location of any prefix. ASN country of registration is IM; announced prefixes are wherever the operator routes, which for these networks is frequently mainland UK, Europe and North America. 87.254.64.0/19 and 2001:470:60::/48 (Google) appear in this index because a Manx-registered operator announces them.",
      "26 of 27 markers fall back to a Douglas town-centre anchor at confidence grade C, because RIPEstat publishes no address for the ASN. Only Manx Telecom has a verifiable anchor (Isle of Man Business Park, Braddan, grade B). Do not read these pins as premises locations.",
      "11 of the 27 ASNs are registered but NOT announced, so they have no prefixes and appear in the index's `unannounced` list rather than on the map with an address space. Several are duplicate registrations of active holders (SC IP Limited holds AS200348, AS207092 and AS64480).",
      "This is a routing registry, not threat intelligence. It cannot identify a subscriber or geolocate an address, and it deliberately exposes no query logs.",
    ],
    confidence: "A",
    sourceId: "ripestat",
    featureCount: 27,
  },

  // ==========================================================================
  // ENERGY
  // ==========================================================================
  {
    id: "offshore-wind",
    label: "Offshore wind projects",
    group: "energy",
    kind: "geojson",
    file: "offshore-wind.geojson",
    color: "#0ea5e9",
    defaultOn: false,
    minZoom: 5,
    description:
      "One project, and it is a refusal rather than a lease. Mooir Vannin (Ørsted, ~1.4 GW, up to 100 turbines, 6-12 nm off Maughold Head) reached the Marine Infrastructure Consent process and its application CLOSED UNCONSENTED on 9 September 2026. Nothing is operating or consented. Shown as a single grade-D indicative point at the midpoint of the published distance band. Not default-on.",
    caveats: [
      "GRADE D POSITION. The point is an indicative centroid derived from the published bearing and distance ('6-12 nautical miles off Maughold Head') projected north-east into the Irish Sea. It is NOT a lease area, a consent boundary or a turbine position. It falls about 15 km from the nearest coast, beyond the 3 nm territorial sea, in the extended jurisdiction area.",
      "THE CONSENT WAS REFUSED. The Marine Infrastructure Consent application closed unconsented on 9 September 2026. A refused proposal is a materially different fact from one that lapsed unexamined, which is why it is mapped at all.",
      "THE CROWN ESTATE'S MORGAN SITE IS NOT PLOTTED. Its 1.5 GW development was discontinued in January 2026 and retendered in July 2026, but no citable footprint position could be established. Inventing a polygon for it would be fabricated precision.",
      "The Mooir Vannin Agreement for Lease dates from November 2015 and predates the refusal by a decade. A historic Agreement for Lease is not evidence of a live lease.",
      "No current authoritative Isle of Man offshore petroleum licence register was located. Block 112/25 'Pepr Lab' appears only on a bare project-information portal registered in the Cayman Islands and is unverified.",
      "For any live proposal, the Marine Institute's current consent register is the only authoritative source. Do not use this layer for navigation, fisheries, seabed tenure or siting analysis.",
    ],
    confidence: "D",
    sourceId: "orsted",
    featureCount: 1,
  },
  {
    id: "reservoirs",
    label: "Reservoirs & water",
    group: "energy",
    kind: "geojson",
    file: "reservoirs.geojson",
    featureCount: 7,
    color: "#0d9488",
    defaultOn: false,
    minZoom: 10,
    description:
      "Four operational impounding reservoirs: West Baldwin, Sulby (largest and newest, completed 1982), Clypse and Kerrowdhoo. Water treatment works at Douglas and Sulby. Seven reservoirs owned in total.",
    caveats: [
      "Reservoir positions are approximate. 'Glen Vinna' appears in no official or reliable secondary source and is probably a garbled transmission-line name — excluded.",
      "1,166 salt bins are published as a separate layer; useful for winter operations, not for OSINT.",
    ],
    confidence: "B",
    sourceId: "manxutilities",
  },
  {
    id: "power",
    label: "Power stations & substations",
    group: "energy",
    kind: "geojson",
    file: "power.geojson",
    color: "#ea580c",
    defaultOn: false,
    minZoom: 10,
    description:
      "Four generation sites joined to MEA Ch.6.1 capacities: Pulrose (135MW — an 87MW combined-cycle gas turbine plus five diesel engines at 48MW), Peel (38.4MW, four diesel engines), the Island Energy from Waste plant (7MW capable, typically supplying ~3MW), and Sulby hydro (1MW). Manx Utilities has over 178MW of generation capacity, 1,300 km of underground cable and 530 km of overhead line, on three independent supply chains. Also 24 named and 53 unnamed substations, 23 solar arrays and 1 wind generator mapped by OSM.",
    caveats: [
      "GENERATION CAPACITIES ARE FROM MEA CHAPTER 6.1, EDITION OCTOBER 2018, and are TEN YEARS OLD. Treat them as a documented historical snapshot, not current installed capacity. Verify with Manx Utilities before relying on any figure.",
      "THE SUBSTATION COUNTS DO NOT RECONCILE. MEA states there are NINE primary substations. OSM maps 24 named substations plus 53 more unnamed. OSM's named set is predominantly DISTRIBUTION substations, which the MEA count excludes. Nothing consulted identifies which nine are the primary substations, so no attempt has been made to select them.",
      "53 UNNAMED SUBSTATIONS are included because they are real mapped infrastructure, but an unnamed substation carries no identity: voltage, capacity and ownership are unknown. An unnamed substation is NOT evidence of a primary substation.",
      "4MW of Ramsey diesel generation recorded in MEA could NOT be placed — OSM has no named Ramsey power plant — so it is carried as an unplaced grade-D feature with null geometry. It is deliberately not snapped to a nearby mapped feature.",
      "Overhead line and cable ROUTES ARE NOT REPRESENTED, though MEA confirms the network comprises both. No reusable route geometry was found, and drawing routes would imply an accuracy that does not exist.",
      "Interconnector capacity conflicts across sources: 40 MW at 90 kV as commissioned, 60 MW/90 kV per the 2013 audit, 65 MW into a 132 kV system per the current operator. Most likely progressive uprating, but flagged rather than picked.",
      "Solar and wind generator coverage is as uneven as OSM contributors made it. Only 1 wind generator is mapped island-wide; absence here is not evidence of absence.",
      "53 UNNAMED SUBSTATIONS and 24 unnamed generators are given the NEAREST SETTLEMENT as derived context, because no naming source exists for them. That is a locator, not an identity: \"400 m N of Jurby\" tells you where to look, not what the substation is called.",
      "Shows assets only: not grid connectivity, export capacity, outage history or embedded generation.",
    ],
    confidence: "B",
    sourceId: "osmPower",
    featureCount: 107,
  },

  // ==========================================================================
  // ENVIRONMENT
  // ==========================================================================
  {
    id: "protected",
    label: "Protected areas",
    group: "environment",
    kind: "geojson",
    file: "protected-areas.geojson",
    featureCount: 102,
    color: "#22c55e",
    defaultOn: true,
    description:
      "26 ASSIs, 10 Manx Marine Nature Reserves, 2 National Nature Reserves, 1 Special Protection Area, 6 Manx National Trust land parcels, 22 glens, 94 designated wildlife sites, 51 registered heathlands.",
    caveats: [
      "The whole-island UNESCO Biosphere designation (2016, 572 km2 land + >4,000 km2 sea, the world's first whole-jurisdiction reserve) is on biosphere.im but is not published here as a machine-readable polygon.",
    ],
    confidence: "A",
    sourceId: "manngis",
  },
  {
    id: "hydro",
    label: "Rivers & streams",
    group: "environment",
    kind: "geojson",
    file: "hydrography.geojson",
    color: "#38bdf8",
    defaultOn: true,
    minZoom: 11,
    description:
      "2,693 watercourse features, plus 25 designated watercourse extents totalling 87.00 km across all codes (including GEW, 2.96 km, which is easy to miss).",
    caveats: [
      "Every watercourse feature is a single undifferentiated class: DESCRIPTIVE_TERM is a space and FEATURE_CODE is 9013001 throughout. The layer does NOT distinguish river from stream from drain, and does not carry a name. You cannot tell the River Dhoo from a field drain using this data.",
      "Cross-reference the Field Gazetteer for watercourse names.",
    ],
    confidence: "A",
    sourceId: "manngis",
    featureCount: 2125,
  },
  {
    id: "marine-env",
    label: "Marine habitats & closures",
    group: "environment",
    kind: "geojson",
    file: "marine-habitats.geojson",
    featureCount: 434,
    color: "#2dd4bf",
    defaultOn: false,
    minZoom: 8,
    description:
      "Eelgrass, kelp, maerl and Modiolus bed extents, eelgrass conservation zones, saltmarsh, sublittoral mud, 12 sea fisheries closed or restricted areas, Ramsey Marine Nature Reserve, and the three offshore MPAs proposed between the IoM and Northern Ireland (Pisces Reef Complex SAC, South Rigg MCZ, Queenie Corner MCZ — 298 km2 combined, targeting Nephrops trawl).",
    caveats: [
      "The three offshore MPAs are a PROPOSAL under DAERA consultation (1 June - 24 August 2026), not designated. No commercial aquaculture site inventory could be found anywhere — that needs DEFA Environment Directorate or Marine Plan records.",
    ],
    confidence: "A",
    sourceId: "manngis",
  },

  // ==========================================================================
  // AVIATION
  // ==========================================================================
  {
    id: "airport",
    label: "Airports & airstrips",
    group: "aviation",
    kind: "geojson",
    file: "airports.geojson",
    color: "#f43f5e",
    defaultOn: false,
    minZoom: 7,
    featureCount: 7,
    description:
      "Seven aerodromes, from OurAirports: Isle of Man Airport (EGNS/IOM, the only field with scheduled service), the ex-RAF fields at Andreas and Jurby, two private airstrips, Noble's Hospital heliport, and the closed Hall Caine Airport. EGNS carries three asphalt runways: 08/26 at 2,110 x 46 m, 03/21 at 1,255 x 46 m, and 17/35 at 903 x 27 m which OurAirports marks closed.",
    caveats: [
      "OurAirports is crowd-maintained. Positions are aerodrome reference points and are not independently audited; expect survey-grade accuracy on paper but no published verification.",
      "MANNGIS contains ZERO airport or runway datasets — an earlier draft of this layer claimed SKYbrary and OSM geometry, which was not what the layer actually contained.",
      "Closed aerodromes are retained and flagged rather than filtered out. 'Closed' means no scheduled or general aviation; private and emergency use may still occur, so do not read these as abandoned.",
      "Runway `closed` flags come from OurAirports and can lag reality. Only the runway endpoints are published, not the strip boundary or displaced-threshold geometry as mapped.",
      "Neither Ryanair nor Aero Iom operates. Manx2 ceased 31 December 2012 and Citywing in 2017.",
    ],
    confidence: "B",
    sourceId: "ourairports",
  },

  // ==========================================================================
  // SURVEILLANCE
  // ==========================================================================
  {
    id: "webcams",
    label: "Public webcams",
    group: "surveillance",
    kind: "geojson",
    file: "webcams.geojson",
    color: "#facc15",
    defaultOn: true,
    minZoom: 9,
    description:
      "10 government snapshot cameras: three at the Bungalow on the A18 Mountain Road (north, south and Laxey valley, all 1920x1080 infrared), Douglas Marina, Douglas Promenade, Peel Breakwater, Port Erin Bay, Douglas Outer Harbour / King Edward VIII Pier, Ramsey and Castletown Bay. Plus two non-governmental feeds (Manx Radio Studio 1, The Bay Port Erin).",
    caveats: [
      "SNAPSHOT JPEG ONLY. No MJPEG, HLS or RTSP stream is published. You get a still image, not video.",
      "NO COORDINATES ARE PUBLISHED. Our pins are geolocated by eye from the webcam pages and are approximate — expect tens of metres of error.",
      "No CORS headers, so <img> works but canvas pixel readback is blocked. Cache-Control is no-cache, so you must cache-bust yourself.",
      "An AWS WAF proof-of-work challenge fires on roughly 50-70% of non-browser requests. Real user browsers are fine; our backend and CI are not.",
      "Hotlinking works and there is no referrer check, but the OGL covers the TEXT. There is no published grant for third-party reuse of the IMAGES specifically. Email harbours@gov.im before shipping.",
    ],
    confidence: "B",
    sourceId: "webcamsGov",
    featureCount: 10,
  },
  {
    id: "tide-stations",
    label: "Tide reference stations",
    group: "surveillance",
    kind: "geojson",
    file: "tide-stations.geojson",
    color: "#818cf8",
    defaultOn: false,
    minZoom: 9,
    featureCount: 6,
    description:
      "Six gauges operated by the Department of Infrastructure: Douglas, Ramsey, Peel, Port Erin, Port St Mary and Castletown. Positions are the surveyed gauge coordinates published in MMEA Chapter 2.1, to the arc-second. All are referenced to the island's Douglas02 GPS datum, and each gauge's Admiralty Chart Datum height is carried per feature.",
    caveats: [
      "Positions are the 2018 MMEA publication. Gauges may have been relocated or re-surveyed since; Douglas and Port Erin in particular are older installations.",
      "Vertical datum is NOT uniform. Douglas, Ramsey, Peel, Port St Mary and Castletown sit at 0.00 m gauge datum relative to Douglas02; Port Erin is at +6.32 m because it is a bubbler system referenced through a mid-tide pressure outlet. Never mix these when comparing water levels.",
      "Tidal RANGES AND HARMONIC CONSTANTS ARE DELIBERATELY EXCLUDED. The mean spring ranges that earlier drafts of this layer quoted (Ramsey 7.89 m, Douglas 7.74 m, Port St Mary 6.46 m, Port Erin 6.06 m, Peel 5.77 m) are supplied to MMEA by the Proudman Institute and carry separate terms, so they are not redistributed here under the IoM OGL.",
      "There is NO free, no-key tide prediction API covering the IoM. NOAA CO-OPS is US-waters only; Spire's tidal coverage ended 2025-12-31; WorldTides and UKHO EasyTide are paid. gov.im publishes 7-day prediction tables as documents only, with no API.",
      "MMEA Figure 14 is captioned 'Laxey not currently installed', so Laxey appears in no gauge list even though a Laxey weather station exists.",
    ],
    confidence: "A",
    sourceId: "mea",
  },

  // ==========================================================================
  // LIVE FEEDS
  // ==========================================================================
  {
    id: "live-transit",
    label: "Live vehicles (bus, steam train, tram, horse tram)",
    group: "live",
    kind: "live",
    // Marks this as a live feed. Resolved in src/lib/feeds. This deployment is a
    // static export on Cloudflare Pages with no server, so function-backed feeds
    // are reported as unavailable rather than fetched.
    endpoint: "function:live-transit",
    color: "#22d3ee",
    defaultOn: false,
    // As of 2026-10-06 this feed is on hold: polling is disabled and no
    // requests are made until a data agreement is secured (FEEDS_ON_HOLD).
    description:
      "Live positions from the FindMyBus.im SignalR hub. This single stream covers ALL government-operated road passenger transport: buses (type B), school buses (S), steam trains (L), trams (T) and horse trams (H). Server-side ingest, one upstream connection, fanned out to all clients. OFF BY DEFAULT: it needs FINDMYBUS_PERMISSION=1 and, as of 2026-10-05, the upstream is not actually delivering.",
    caveats: [
      "*** DELIVERY IS UNVERIFIED. *** Re-tested 2026-10-05: negotiate, handshake and poll all succeed, and 11 separate connections were held for 160 s in total, but NOT ONE TransportData frame was ever pushed. The hub accepted an invocation and returned 200 with an empty body. So the protocol is right and the endpoint is live, and we still have never seen a vehicle on it. Do not describe this layer as working until a real frame has been seen.",
      "The route is built to the protocol verified from the official client bundle: POST /transporthub/negotiate?negotiateVersion=1, then handshake and poll with the returned CONNECTION TOKEN (not connectionId - using connectionId gets 'No Connection with that ID' on every request), frames terminated by 0x1e, method 'TransportData'.",
      "THE SERVER DROPS THE CONNECTION ABOUT 15 SECONDS after the handshake, whether or not it sent anything, and answers each poll immediately instead of holding it. Verified. So this cannot be a held-open socket like the AIS feed: the route re-negotiates on a loop and keeps last-known position per vehicle, with the receive time as the staleness clock.",
      "NO robots.txt (404), no terms page, no licence. Absence of a licence is not a grant. The route refuses to run unless FINDMYBUS_PERMISSION=1, so setting it is the deliberate act of saying you have checked. Contact infrastructure@gov.im before publishing.",
      "An F5 BIG-IP WAF sits in front and returns HTTP 504 on a fraction of long-polls. Treat 504 as normal, keep exactly one poll in flight, and carry the ARRAFFinity cookie across negotiate, handshake and poll or the WAF moves us to a different backend mid-conversation.",
      "The client hard-deletes markers older than 300 s. That interval is read from api/v1/clientconfig rather than hardcoded, so a change on their side does not silently become a lie here.",
      "The payload carries no trustworthy timestamp, so age is measured from when we received the record. A congested upstream inflates every age on the map.",
      "Fields at indices 1, 2 and 7 are transmitted but never read by the official client. We do not guess their meaning; the raw record is carried through uninterpreted.",
      "Groudle Glen Railway and Great Laxey Mine Railway are absent from this feed entirely.",
    ],
    confidence: "A",
    sourceId: "findmybus",
  },
  {
    id: "live-flights",
    label: "Live aircraft",
    group: "live",
    kind: "live",
    // Server-backed, and unavailable here. OpenSky pins CORS to its own origin, so a
    // browser cannot call it at all - see src/lib/feeds. As of 2026-10-06 it is
    // on hold: no polling runs and no requests are made until a written data
    // agreement is secured - see FEEDS_ON_HOLD in src/lib/feeds/index.ts.
    endpoint: "function:live-flights",
    color: "#f472b6",
    defaultOn: false,
    description:
      "ADS-B aircraft state vectors within a 0.15 x 0.25 degree box centred on the Isle of Man, which falls in the <=25 sq degree cost tier at 1 credit per call.",
    caveats: [
      "PERMISSION REQUIRED BEFORE PUBLISHING. OpenSky's Terms of Use §3(vi) and its own summary box require a previous written agreement for any 'operational' use, including integration into a live product, 'even for only internal' use and 'regardless of the entity's non-profit status'. Email contact@opensky-network.org. The route refuses to run without OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET, so setting them is the deliberate act of saying the agreement exists.",
      "400 credits/day on the anonymous tier, IP-bucketed. That is about 400 refreshes per day across ALL your users behind one egress IP. You need an OAuth2 account (basic auth was removed 2026-03-18) and aggressive caching. The box used is 0.4 x 0.6 degrees = 0.24 sq degrees, inside the <=25 sq degree tier at 1 credit per call; widening it to catch more traffic crosses into the next tier.",
      "CORS is hard-pinned to https://opensky-network.org regardless of the Origin header - verified by request. A browser cannot read this feed, and it would need a server-side proxy to be reachable from one at all.",
      "`category` IS ABSENT FROM THE ANONYMOUS TIER ENTIRELY. Re-tested 2026-10-05: state vectors came back as 17-element arrays with no index 17, so the ADS-B emitter category is simply not there. Indexing the documented position blindly yields undefined where a number belongs, which becomes NaN in JSON and draws a marker at 0,0 off West Africa. Every field is read through a null guard for this reason.",
      "`category` is the ADS-B EMITTER category (0-20), not a civil/military flag. Treating category 1 or 14 as 'military' is community folklore and will miss most military traffic, because most military aircraft emit category 1 or 7.",
      "`/tracks` and `/tracks/all` return 404 from OpenSky. Only the /states/all family responds.",
      "An empty box returns `\"states\": null`, not `[]`. Guard against null.",
      "This is ADS-B over a volunteer receiver network. An aircraft with no transmitter, or one below coverage, does not appear at all - an empty layer does not mean an empty sky, and coverage over the Irish Sea is thinner than over land.",
    ],
    confidence: "A",
    sourceId: "opensky",
  },
  {
    id: "satellite-passes",
    label: "Satellite pass predictions",
    group: "live",
    kind: "live",
    // Client-side: CelesTrak sends CORS *, the TLEs are public domain, and the
    // SGP4 arithmetic runs in a Web Worker. See src/lib/feeds/passes-client.ts.
    endpoint: "client:satellite-passes",
    color: "#c084fc",
    defaultOn: false,
    minZoom: 5,
    description:
      "Predicted pass windows for the ISS and other crewed spacecraft over the island's two ground stations, computed in your browser by propagating public-domain two-line element sets with SGP4, in a Web Worker so the map stays responsive.",
    caveats: [
      "PREDICTED, NOT OBSERVED. These are pass windows computed from a TLE by SGP4. Nothing here has been correlated against an actual signal received on the ground.",
      "SGP4 is good to a few kilometres and a few seconds in LEO, which answers 'roughly when could a receiver here see it' and nothing operational.",
      "Elevation mask is 5 degrees. TERRAIN MASKING IS NOT MODELLED: Snaefell at 621 m would genuinely shadow passes to the south-east, and that is not accounted for.",
      "The ISS orbits at 51.6 degrees inclination, so it never passes directly over the Isle of Man at 54.4 N. It tracks about 300 km to the south, which is why the best passes reach only about 50 degrees of elevation.",
      "Orbital elements go stale. A TLE more than a few days old will drift; CelesTrak is the reference source and is re-read every six hours.",
    ],
    confidence: "C",
    sourceId: "celestrak",
  },
  {
    id: "live-vessels",
    label: "Live vessels (AIS)",
    group: "live",
    kind: "live",
    // Server-backed, and unavailable here. An AISStream key must not be readable in
    // devtools, and their 3-connections-per-IP cap forbids a socket per visitor.
    endpoint: "function:live-vessels",
    color: "#2dd4bf",
    defaultOn: false,
    // On hold as of 2026-10-06: polling disabled, no upstream requests
    // (FEEDS_ON_HOLD).
    minZoom: 5,
    description:
      "AIS PositionReports inside a bounding box around the Isle of Man. Would need one server-side ingest fanned out to all clients, which a static host cannot provide.",
    caveats: [
      "There is NO free, no-key, programmatic AIS source. MarineTraffic is ~EUR 330 per 10,000 credits and now sales-gated. Global Fishing Watch needs a token and is CC BY-NC (non-commercial only, which rules out an ad-supported site).",
      "AISStream is free but has NO published terms document, no SLA and no replay. Absence of a prohibition is not a commercial-use grant — this is a legal gap, not an open licence.",
      "AISStream caps you at 3 connections per account AND 3 per originating IP, which is why this would need one ingest plus internal fan-out rather than one socket per client.",
      "Send permessage-deflate; uncompressed connections are bandwidth-capped from September 2026.",
    ],
    confidence: "C",
    sourceId: "aisstream",
  },
  {
    id: "weather",
    label: "Weather & sea state",
    group: "live",
    kind: "live",
    // Client-side: Open-Meteo sends CORS * and needs no key. See
    // src/lib/feeds/weather-client.ts.
    endpoint: "client:weather",
    color: "#38bdf8",
    defaultOn: true,
    description:
      "Current conditions, 6-hour forecast and marine wave/sea-surface-temperature from Open-Meteo, at the two model grid cells the API actually uses. Fetched directly from your browser: keyless, no account, CC-BY 4.0, CORS *, so this feed needs no server at all.",
    caveats: [
      "NON-COMMERCIAL ONLY on the free tier. Their terms count subscriptions OR advertising as commercial. If you monetise this app you need a paid plan - this is the one live feed that is enabled by default, so it is the one most likely to be misused by accident.",
      "MODEL OUTPUT, NOT OBSERVATIONS. No Met Office observation is used. The marker is the grid cell the API snapped to, not an instrument, and it is drawn where the API says the cell is rather than where we asked.",
      "THERE IS NO TIDE PRODUCT. Wave height and sea surface temperature only. Do not conflate marine with tide, and do not read the sea-surface figure as a tide level.",
      "10,000 calls/day, 300,000/month, and no rate-limit headers are returned - you get a bare 429 and must track usage yourself. The route caches for 10 minutes, which is ~144 calls/day.",
      "Ronaldsway Met Office observations are hourly and continuous since 7 May 1946, but there is NO public CSV or JSON feed for them - the WiskiWeb dashboard fetches from an endpoint buried inside its SAP/OpenUI5 bundle.",
    ],
    confidence: "A",
    sourceId: "openmeteo",
  },
];

/**
 * Things the brief asked for that we could NOT get. Rendered in the UI as a
 * first-class panel, because "here is what we could not obtain, and why" is
 * the most useful part of an OSINT tool.
 */
export const GAPS: Gap[] = [
  {
    id: "gazetteer",
    title: "Official national place-name gazetteer",
    wanted: "An authoritative Isle of Man gazetteer of settlements, streets and named places, with official spellings.",
    whyUnavailable:
      "MANNGIS has no gazetteer layer. DEFA/0 is called 'Field Gazetteer' but contains no name field at all — its fields are PLOT, START, ACRES3D, CATEGORY, OCCUP_CURR and USECOD_CURR, making it agricultural field parcels. All 43 DEFA layers and all 18 DOI layers were enumerated and none is a place-name index. This was previously mislabelled in OpenMannin as a 19,848-record toponymic gazetteer; the error is corrected and the parcels now have their own layer.",
    whatWeWouldNeed:
      "A published MANNGIS gazetteer service, or the Isle of Man Survey's place-name data if it is released under the OGL. Meanwhile the place-name layer is built from OpenStreetMap (1,253 distinct named places after dropping 152 node/way duplicates, ODbL), which is open and usable but is a community dataset rather than an official one.",
    contact: "mapping@gov.im",
    severity: "medium",
  },
  {
    id: "house-numbers",
    title: "House numbers",
    wanted: "Isle of Man house numbers and full street addresses as map points.",
    whyUnavailable:
      "The MANNGIS LLPG address geocoder returns HTTP 403 with error GWM_0003 to anonymous callers and has no copyrightText — it is an authorised-access service. The only complete address source is OS AddressBase Islands, which is a commercial product (three-month free Data Exploration Licence). A second LLPG geocoder is exposed on the pre-production host ppmaps.gov.im. Planning-application data carries 81,232 non-null addresses but those are application sites, not a national address register.",
    whatWeWouldNeed:
      "Either a MANNGIS authorised-access account, or an OS AddressBase Islands subscription. Until then: the 19,848-record Field Gazetteer and the Planning layer's 35,158 postcode-bearing addresses are the closest available substitutes.",
    contact: "mapping@gov.im",
    severity: "high",
  },
  {
    id: "mines",
    title: "Abandoned mines",
    wanted:
      "Lead and copper mine sites, adits, shafts, spoil heaps and processing plants — the Isle of Man's signature industrial heritage.",
    whyUnavailable:
      "MANNGIS has NO mining layer. Searches of all 564 items for 'mine', 'mining', 'mineral', 'spoil' and 'shaft' return zero results, and the ProdDEFA service has no mining layer among its 40 layers. Manx National Heritage holds the authoritative archaeological record but its HER API returns 404 on every conventional path and it operates an Access and Charging Policy, so some reuse may be chargeable.",
    whatWeWouldNeed:
      "The Manx National Heritage HER under licence, or a scoped build-time pull from OSM (which does carry a partial scatter of mine features). Contact iomher@mnh.im. We have attempted the OSM fallback.",
    contact: "iomher@mnh.im",
    severity: "high",
  },
  {
    id: "cameras",
    title: "CCTV and ANPR camera locations",
    wanted: "The actual positions and count of fixed public CCTV and ANPR cameras.",
    whyUnavailable:
      "Nobody publishes it. Neither the Constabulary, nor DoI, nor any local authority has ever released a camera count, location list or retention schedule. Ramsey Borough Council's own FOI response references a camera map that is absent from the released PDF, and a second FOI gives purchase and maintenance costs with no count or locations. The Chief Constable's Annual Report 2024/25 contains none. The DoI CCTV policy page self-contradicts on retention (10 days in the FAQ vs 'usually in the region of one month' elsewhere) and was last updated 24 May 2017.",
    whatWeWouldNeed:
      "FOI requests to DoI, the Constabulary and all 21 local authorities. Do NOT attempt to geolocate individual cameras from imagery — that is not a thing we will help with, and the statutory basis for intrusive surveillance is narrow (only the Constabulary and Customs & Excise may apply).",
    contact: "Police@gov.im",
    severity: "high",
  },
  {
    id: "boundaries",
    title: "Parish and sheading boundaries",
    wanted: "The 17 ancient parishes and 6 sheadings as machine-readable polygons.",
    whyUnavailable:
      "The IoM publishes no authoritative open boundary dataset. The official local authority map is a PDF (cartography, not GIS). The 17-parish / 6-sheading model is standard and well attested, but not published as open data.",
    whatWeWouldNeed:
      "MANNGIS authorisation, or a Central Registry land-boundary extract.",
    contact: "mapping@gov.im",
    severity: "medium",
  },
  {
    id: "traffic-counts",
    title: "Traffic counts",
    wanted: "A18 / A5 / A30 traffic volumes.",
    whyUnavailable:
      "There is no transport section at all in Isle of Man in Numbers 2025 — all 112 sheets were checked. The only transport-adjacent figures are registered aircraft, the shipping registry, road accidents and driving tests. The gov.im 'Live Road Information' open data entry is a broken link to a variable-message-sign status page with no flow data. TomTom one.network returns 401/503/403 on every API probe.",
    whatWeWouldNeed: "An FOI request to Highway Services.",
    contact: "infrastructure@gov.im",
    severity: "medium",
  },
  {
    id: "census",
    title: "Census 2021 boundaries and tables",
    wanted: "Statistical area and parish boundaries plus machine-readable 2021 tables.",
    whyUnavailable:
      "Both 2021 Census PDFs promise tables on the open data Society page, but the only machine-readable files published are the 2016 tables. No 2021 CSV/XLSX and no official boundary shapefile or GeoJSON exist.",
    whatWeWouldNeed:
      "Statistics Isle of Man. Meanwhile we carry verified 2021 headline figures: 81,797 residents present, 84,069 resident population, 571 visitors, 82,368 de facto population (night 30-31 May 2021).",
    contact: "kevin.thompson@gov.im",
    severity: "medium",
  },
  {
    id: "bathymetry",
    title: "Bathymetry",
    wanted: "Authoritative seabed depth around the Isle of Man.",
    whyUnavailable:
      "UKHO operates a Data Exploration Licence that is revocable, non-transferable, limited to specified uses and expires after 12 months. The relevant CDI record (survey HI705, IoM to Liverpool Bay) is metadata only and explicitly 'beyond the 12 NM boundary'. There is no free authoritative alternative.",
    whatWeWouldNeed:
      "A UKHO Data Exploration Licence. EMODnet gives indicative regional depth for display only and we use it as such.",
    contact: "datahub.admiralty.co.uk",
    severity: "medium",
  },
  {
    id: "cni",
    title: "Critical National Infrastructure register",
    wanted: "The statutory list of Essential and Important infrastructure providers.",
    whyUnavailable:
      "The National Infrastructure Security Bill is still a Bill. The consultation-stage reference guide lists 19 proposed sectors but is policy material, not a designation instrument. No competent authority exists yet and no public asset register exists.",
    whatWeWouldNeed: "Enactment of the Bill. We show the operator's own published asset figures in the meantime.",
    severity: "low",
  },
  {
    id: "mod",
    title: "MOD land",
    wanted: "Ministry of Defence landholdings, ranges and installations on the island.",
    whyUnavailable:
      "No current MOD-owned or MOD-leased land was identified anywhere. GOV.UK lists the 1939 Jurby Air Gunnery and Bombing Range byelaws but records them as LAPSED. Jurby airfield today is general aviation. The only military presence is Military Aid to the Civil Community, which is a reciprocal UK arrangement, not Manx land.",
    whatWeWouldNeed: "Nothing — the honest answer is that there is no evidence of any.",
    severity: "low",
  },
  {
    id: "aquaculture",
    title: "Aquaculture sites",
    wanted: "Fish farm, mussel and oyster lease areas in Manx waters.",
    whyUnavailable:
      "Repeated searches found no reliable inventory. Searches surfaced unrelated Maine lease data and Bangor University wild-fishery pages instead. Note the IoM holds exclusive fishing rights only within the first 3 nm, and commercial fishing inside the territorial sea needs BOTH a UK and an IoM licence.",
    whatWeWouldNeed: "DEFA Environment Directorate, or Marine Plan seabed lease records.",
    contact: "EnvironmentalProtection@gov.im",
    severity: "medium",
  },

  // --------------------------------------------------------------------------
  // Layers that were previously asserted and have since been investigated.
  // A verified absence belongs here with its evidence, not deleted silently:
  // "we looked and there is nothing" is a finding worth publishing.
  // --------------------------------------------------------------------------
  {
    id: "nuclear",
    title: "Nuclear facilities (verified absent from the Isle of Man)",
    wanted: "Any operating, decommissioning or licensed nuclear facility within the Isle of Man's territory or territorial waters.",
    whyUnavailable:
      "THERE ISN'T ONE. This layer previously asserted Sellafield, Calder Hall and THORP at grade A with three features. Those sites are real but are on the Cumbrian coast roughly 32 miles (52 km) from the Isle of Man and outside Manx territorial waters entirely — an earlier draft put them at 22 km, which is wrong. No nuclear facility of any kind exists on the island. The risk is real but it is a regional external, not a local asset, so plotting it on an Isle of Man infrastructure map asserted a jurisdiction that does not exist. DEFA's Radioactivity Monitoring reports and the Tynwald PP 2023/33 papers both describe only ambient monitoring of radionuclides arriving by airfall and sea, with no local facility. What remains relevant — Sellafield's Magnox Swarf Storage Silo retrievals and the live GDF siting process (Mid Copeland and South Copeland candidates) — is UK domestic policy recorded in those documents, not Isle of Man infrastructure.",
    whatWeWouldNeed:
      "Nothing. If an application for a nuclear licence in Manx waters ever appears it would show up in DEFA's environmental permitting or MIMA's marine licensing. The layer should stay absent, and any future sighting should be added with a citation rather than inherited from this note.",
    contact: "EnvironmentalProtection@gov.im",
    severity: "low",
  },
  {
    id: "satellite-stations",
    title: "Satellite ground stations and GNSS reference stations",
    wanted: "Satellite teleport, gateway and ground-station sites, plus the IoM GNSS reference station.",
    whyUnavailable:
      "The one site with a published position is the Spaceman teleport (aql Space Services) at 54.1390 N, 4.4951 W, about 2 km east of Douglas, chosen for low horizon clutter and separately allocated spectrum, with dark fibre into the aql UK network. That single coordinate is quotable, but the layer as a whole cannot be completed honestly: Starlink is licensed on the island via a BlueWave partnership and appears only on third-party dish trackers with no operator-confirmed coordinate; Arqiva's 'Chalfont' teleport is in Buckinghamshire and NOT on the island despite being widely misstated as such; and no OneWeb, Galileo or BeiDou ground infrastructure has been located either way. Publishing one confident pin next to a layer title that implies a network would overstate what is known.",
    whatWeWouldNeed:
      "Written confirmation of coordinates from aql/BlueWave for each site, and an Ofcom or CURA satellite earth station licence register covering IoM-located sites. The IOMS GNSS reference station at the airport is separately documented in OS Net and Leica SmartNet and can be added independently if a source cites its position.",
    contact: "info@spaceman.im",
    severity: "low",
  },
  {
    id: "ports",
    title: "Ports and harbours",
    wanted: "The eight statutory harbours as point features with official positions.",
    whyUnavailable:
      "The harbour list is not in doubt — Douglas, Peel, Port Erin, Port St Mary, Ramsey, Laxey, Castletown and Derbyhaven — and the Marine Operations Centre on the second floor of the Sea Terminal in Douglas is the authority. What is missing is a published, machine-readable, licensed set of positions. OSM does carry harbour and pier features, but they are community-mapped and an earlier Overpass query for waste-site features returned nothing usable, so OSM coverage of IoM harbour infrastructure has not been verified as sufficient. The IoM does not publish a harbours GeoJSON or point service, and MMEA's harbour material is descriptive text plus restricted Admiralty chart extracts.",
    whatWeWouldNeed:
      "Either a MANNGIS harbours layer, or the Marine Operations Centre's own published positions under the OGL. OSM is a reasonable fallback provided each point is graded honestly as a community-derived harbour centroid rather than a surveyed pier head.",
    contact: "harbours@gov.im",
    severity: "medium",
  },
  {
    id: "power",
    title: "Power stations and substations",
    wanted: "Manx Utilities' three power stations and nine primary substations as point features.",
    whyUnavailable:
      "The inventory is documented but the coordinates are not publishable. MMEA Chapter 6 states there are NINE PRIMARY SUBSTATIONS and that Manx Utilities runs three independent supply chains (natural gas, liquid fuel, electricity imports) and three power stations, with about 1,300 km of underground cable and 530 km of overhead line. Manx Utilities' own asset disclosures do not publish substation or power station positions, and MMEA's Figure 2 major asset map is an image from which coordinates cannot be taken. Guessing positions from a figure would be exactly the kind of fabricated precision this project exists to avoid. The nearby OSM substation nodes have not been confirmed to correspond to the nine primary substations and should not be substituted on the assumption that they do.",
    whatWeWouldNeed:
      "Manx Utilities would need to publish substation and generation coordinates, either as a GeoJSON or as a table under the OGL. A single email to their asset records team would likely resolve it; this is the most tractable of the remaining infrastructure gaps.",
    contact: "info@manxutilities.im",
    severity: "medium",
  },
];