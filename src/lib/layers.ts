import type { Gap, LayerDef } from "./types";

/**
 * The layer registry.
 *
 * Ordering rules that matter:
 *  1. As of 2026-10-07 every layer is `defaultOn: false` — the reader should be
 *    shown the evidence, including the weak and the disputed, rather than a
 *    curated subset. Disputed (grade D) layers are still rendered but flagged,
 *    and on-hold live feeds badge themselves without ever fetching.
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
      category: "foundational",
      subcategory: "place-names",
    kind: "geojson",
    file: "toponyms.geojson",
    color: "#8b8b8b",
    defaultOn: true,
    minZoom: 10,
    description:
      "1,253 distinct named places from OpenStreetMap: towns, villages, hamlets, localities and suburbs. Ordered by significance (OSM place_rank where mapped, otherwise derived from the place type) so a label renderer can drop the least significant first. Includes wikidata IDs where mapped.",
    caveats: [
      "NOT an official national gazetteer. No official gazetteer is published as open data — see the gazetteer gap entry. These are OSM names, so coverage and preferred spelling vary with local mapping activity.",
      "Includes historic and alternative spellings (Manx, Irish and English variants) where mappers recorded them.",
      "Attribution required: (c) OpenStreetMap contributors, ODbL.",
    ],
    confidence: "B",
    sourceId: "osmIOM",
    featureCount: 1253,
  },
  {
    id: "heritage",
    label: "Heritage-designated places",
    group: "geography",
    category: "heritage",
    subcategory: "designated",
    kind: "geojson",
    file: "heritage.geojson",
    color: "#a6785a",
    defaultOn: false,
    minZoom: 14,
    description:
      "Places on the Isle of Man that carry a heritage designation in Wikidata (heritage designation P1435, country P17 = Isle of Man Q9676) and a published coordinate. Predominantly 'registered building' entries, plus scheduled monuments and Manx National Heritage records. Records are enriched where Wikidata holds it, with an inception year, a Wikimedia Commons image, an official website and the administrative parish or town.",
    caveats: [
      "WIKIDATA, NOT THE OFFICIAL REGISTER. This is a community-maintained, georeferenced subset. The authoritative statutory register of registered buildings is held by the Department of Infrastructure/DEFA and is not published as open data. Wikidata lags and is incomplete.",
      "A heritage listing is a legal status, not a statement of structural condition.",
      "Enrichment fields (inception, image, website) are present only on a minority of records and are as reliable as the underlying Wikidata statement.",
      "Wikidata structured data is CC0 — no attribution or share-alike obligation.",
    ],
    confidence: "C",
    sourceId: "wikidata",
    featureCount: 319,
  },
  // ==========================================================================
  // TRAILS AND ROADS
  // ==========================================================================
  {
    id: "roads",
    label: "Road network",
    group: "trails",
      category: "foundational",
      subcategory: "transport-network",
    kind: "geojson",
    file: "roads.geojson",
    pmtiles: "tiles/roads.pmtiles",
    color: "#8d8577",
    defaultOn: false,
    minZoom: 8,
    description:
      "The island's road network from OpenStreetMap: motorway, trunk, primary, secondary, tertiary, unclassified, residential, service, living_street and track (plus their link roads). Each segment carries its OSM highway class, route reference and posted maxspeed where mapped.",
    caveats: [
      "OpenStreetMap, not the Department of Infrastructure road hierarchy. It does not carry the government's own road classification, USRNs, or maintenance responsibility.",
      "Footways, paths, steps and bridleways are deliberately NOT in this layer — they are in the 'Footpaths & PRoW' layer. Speed limits are NOT a separate layer either: every segment here carries its maxspeed tag where one is mapped.",
      "Not every road is named, and some service roads and tracks are mapped inconsistently.",
      "There are NO published traffic-count or A18 volume datasets. That requires an FOI request to Highway Services.",
      "Attribution required: (c) OpenStreetMap contributors, ODbL.",
    ],
    confidence: "B",
    sourceId: "osmIOM",
    featureCount: 12023,
  },
  {
    id: "bridges",
    label: "Bridges",
    group: "trails",
      category: "foundational",
      subcategory: "transport-network",
    kind: "geojson",
    file: "bridges.geojson",
    color: "#78716c",
    defaultOn: false,
    minZoom: 12,
    description:
      "Road, rail and foot bridges mapped in OpenStreetMap as ways tagged bridge=*.",
    caveats: [
      "Community-mapped; culverts and small crossings are inconsistently tagged. Presence is not a bridge condition assessment.",
      "Attribution required: (c) OpenStreetMap contributors, ODbL.",
    ],
    confidence: "C",
    sourceId: "osmIOM",
    featureCount: 558,
  },
  {
    id: "emergency",
    label: "Emergency services",
    group: "trails",
    category: "civic",
    subcategory: "emergency-services",
    kind: "geojson",
    file: "emergency.geojson",
    color: "#ef4444",
    defaultOn: false,
    minZoom: 12,
    description:
      "Police, fire and ambulance stations from OpenStreetMap (amenity=police/fire_station/ambulance_station). Public-access defibrillators are NOT in this layer — they are owned by 'Essential utilities & services' so the two cannot drift.",
    caveats: [
      "Community-mapped; coverage and currency depend on OSM contributors. VERIFY against official sources (gov.im, iomfire.com, nwas.nhs.uk) before relying in an emergency.",
      "Defibrillators live in the 'Essential utilities & services' layer, not here.",
      "Attribution required: (c) OpenStreetMap contributors, ODbL.",
    ],
    confidence: "C",
    sourceId: "osmIOM",
    featureCount: 13,
  },
  {
    id: "footpaths",
    label: "Footpaths & PRoW",
    group: "trails",
    category: "prow",
    subcategory: "rights-of-way",
    kind: "geojson",
    file: "footpaths.geojson",
    pmtiles: "tiles/footpaths.pmtiles",
    color: "#22c55e",
    defaultOn: false,
    minZoom: 13,
    description:
      "Public rights of way and recreational paths from OpenStreetMap: footway, path, bridleway, steps. Includes designation tags (public_footpath, public_bridleway, etc.) where mapped.",
    caveats: [
      "Not an official definitive map — the IoM definitive map of PRoW is not openly licensed. This is OSM community mapping only.",
      "designation tags are inconsistent; a path tagged footway may be a PRoW, a permissive path, or a private track.",
      "Surface and condition are rarely mapped. Expect rough ground, gates, stiles, and seasonal obstacles.",
      "Attribution required: (c) OpenStreetMap contributors, ODbL.",
    ],
    confidence: "C",
    sourceId: "osmIOM",
    featureCount: 9266,
  },
  {
    id: "schools-health",
    label: "Schools & health",
    group: "transport",
    category: "poi",
    subcategory: "services",
    kind: "geojson",
    file: "schools-health.geojson",
    color: "#06b6d4",
    defaultOn: false,
    minZoom: 12,
    description:
      "Schools (school, college, university, kindergarten) and healthcare (hospital, clinic, doctors, dentist, pharmacy, veterinary) from OpenStreetMap.",
    caveats: [
      "Community-mapped; opening hours, services and contact details may be outdated. VERIFY against official sources (gov.im/education, manxcare.im) before relying on them.",
      "Pharmacies and dental practices are included; veterinary is included for completeness.",
      "Attribution required: (c) OpenStreetMap contributors, ODbL.",
    ],
    confidence: "C",
    sourceId: "osmIOM",
    featureCount: 120,
  },
  {
    id: "tourism",
    label: "Tourism",
    group: "transport",
    category: "poi",
    subcategory: "tourism",
    kind: "geojson",
    file: "tourism.geojson",
    color: "#f59e0b",
    defaultOn: false,
    minZoom: 12,
    description:
      "Tourism features from OpenStreetMap: attractions, museums, galleries, campsites, hostels, hotels, guest houses, artwork, memorials and monuments. Viewpoints and picnic sites are owned by the 'Coastal & outdoor' layer, not repeated here.",
    caveats: [
      "Community-mapped; facilities, opening times and prices change. VERIFY against official tourism sources (visitisleofman.com) before planning a visit.",
      "Campsites and accommodation may be seasonal or require booking.",
      "Viewpoints and picnic sites live in the 'Coastal & outdoor' layer.",
      "Attribution required: (c) OpenStreetMap contributors, ODbL.",
    ],
    confidence: "C",
    sourceId: "osmIOM",
    featureCount: 298,
  },
  {
    id: "worship",
    label: "Places of worship",
    group: "transport",
    category: "poi",
    subcategory: "worship",
    kind: "geojson",
    file: "worship.geojson",
    color: "#a855f7",
    defaultOn: false,
    minZoom: 13,
    description:
      "Places of worship from OpenStreetMap (amenity=place_of_worship) with religion and denomination where mapped.",
    caveats: [
      "Community-mapped; service times and access arrangements vary. Contact the venue directly for current information.",
      "Religion and denomination tags are not always complete.",
      "Attribution required: (c) OpenStreetMap contributors, ODbL.",
    ],
    confidence: "C",
    sourceId: "osmIOM",
    featureCount: 97,
  },
  {
    id: "parish-boundaries",
    label: "Parish boundaries",
    group: "geography",
    category: "civic",
    subcategory: "boundaries",
    kind: "geojson",
    file: "parish-boundaries.geojson",
    color: "#6366f1",
    defaultOn: true,
    minZoom: 8,
    description:
      "Civil parish boundaries of the Isle of Man from OpenStreetMap (admin_level=8 relations). All 24 parishes (incl. Laxey) successfully reconstructed from OSM API.",
    caveats: [
      "Community-mapped boundaries from OSM; not the legal definitive map. May not match exact legal boundaries.",
      "Laxey parish (relation 1061137) was reconstructed from 2 ways.",
      "Attribution required: (c) OpenStreetMap contributors, ODbL.",
    ],
    confidence: "C",
    sourceId: "osmIOM",
    featureCount: 24,
  },

  // ==========================================================================
  // TRANSPORT
  // ==========================================================================
  {
    id: "bus-stops",
    label: "Bus stops",
    group: "transport",
    category: "poi",
    subcategory: "public-transport",
    kind: "geojson",
    file: "bus-stops.geojson",
    color: "#2563eb",
    defaultOn: false,
    minZoom: 13,
    description:
      "Bus stops from OpenStreetMap (highway=bus_stop and public_transport=platform), with per-stop services taken from OSM bus route relations where the stop is a member.",
    caveats: [
      "Per-stop services come only from OSM route relations, which are current but partial: most stops carry no service list rather than a guessed one. VERIFY against current timetables (iombusandrail.im) before relying on services.",
      "No official stop numbers or NaPTAN codes are shown; those identifiers come from government data that is not openly licensed and is not used here.",
      "Attribution required: (c) OpenStreetMap contributors, ODbL.",
    ],
    confidence: "C",
    sourceId: "osmIOM",
    featureCount: 732,
  },
  {
    id: "bus-routes",
    label: "Bus routes",
    group: "transport",
    category: "poi",
    subcategory: "public-transport",
    kind: "geojson",
    file: "bus-routes.geojson",
    color: "#1d4ed8",
    defaultOn: false,
    minZoom: 10,
    description:
      "OSM route relation alignments for bus services across the Isle of Man, extracted on 2026-10-16. One feature per relation; membership is partial — a route whose outbound and return are mapped separately appears as two features. Alignments are geometry only, NOT a timetable. VERIFY against iombusandrail.im before relying on them.",
    caveats: [
      "Membership is partial: one feature per OSM route relation; a service with separate outbound/return mappings appears as two features and its ref repeats.",
      "Alignments are unverified geometry: a route may be missing, drawn along the wrong roads, or split. VERIFY against iombusandrail.im before relying on them. This is geometry, NOT a timetable.",
      "Attribution required: (c) OpenStreetMap contributors, ODbL.",
    ],
    confidence: "C",
    sourceId: "osmIOM",
    featureCount: 69,
  },
  {
    id: "postcodes",
    label: "Postcodes",
    group: "transport",
    category: "civic",
    subcategory: "addresses",
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
    category: "civic",
    subcategory: "addresses",
    kind: "geojson",
    file: "house-numbers.geojson",
    pmtiles: "tiles/house-numbers.pmtiles",
    color: "#34d399",
    defaultOn: false,
    minZoom: 14,
    description:
      "8,281 address points from OpenStreetMap: 6,845 with addr:housenumber (numbered street addresses) and 1,436 named rural/heritage properties mapped with addr:housename instead of a number. Each point is a building, entrance or standalone address node.",
    caveats: [
      "Coverage depends on OSM mapping activity. Rural and newly-built areas may be incomplete.",
      "addr:interpolation ways are not expanded — intermediate house numbers are not invented.",
      "Attribution required: (c) OpenStreetMap contributors, ODbL.",
    ],
    confidence: "C",
    sourceId: "osmIOM",
    featureCount: 8281,
  },
  {
    id: "railways",
    label: "Railways & tramways",
    group: "transport",
    category: "prow",
    subcategory: "heritage-railways",
    kind: "geojson",
    file: "railways.geojson",
    color: "#111827",
    defaultOn: false,
    minZoom: 10,
    description:
      "Rail and tram alignments from OpenStreetMap (railway=rail, light_rail, tram, narrow_gauge). Every railway on the Isle of Man is HERITAGE and seasonal — there is no mainline rail: Manx Electric Railway, Isle of Man Steam Railway, Snaefell Mountain Railway, Horse Trams, Groudle Glen Railway and the Great Laxey Mine Railway.",
    caveats: [
      "OpenStreetMap alignments, not the operators' surveyed track geometry. Lengths are as mapped and will differ from official figures.",
      "Opening dates: Manx Electric Railway 1893, Snaefell Mountain Railway 1895, Isle of Man Steam Railway 1873. The commonly repeated claim that the Snaefell railway opened in 1893 is wrong — 1893 is the Manx Electric Railway.",
      "Gauge is taken from OSM tags only where mapped; commonly cited figures (3 ft 6 in Steam, 3 ft Electric) are NOT verified against a primary source.",
      "Attribution required: (c) OpenStreetMap contributors, ODbL.",
    ],
    confidence: "B",
    sourceId: "osmIOM",
    featureCount: 284,
  },
  {
    id: "ev",
    label: "EV charging sites",
    group: "transport",
    category: "infrastructure",
    subcategory: "ev-charging",
    kind: "geojson",
    file: "ev-charging.geojson",
    color: "#10b981",
    defaultOn: false,
    minZoom: 14,
    description:
      "Electric-vehicle charging points mapped in OpenStreetMap (amenity=charging_station), with operator, socket and capacity tags where present.",
    caveats: [
      "OpenStreetMap, not Manx Utilities' own asset register. Some sites and sockets will be missing or out of date; check the operator before relying on a charge point.",
      "Attribution required: (c) OpenStreetMap contributors, ODbL.",
    ],
    confidence: "C",
    sourceId: "osmIOM",
    featureCount: 60,
  },
  {
    id: "traffic-signals",
    label: "Traffic signals & crossings",
    group: "transport",
      category: "foundational",
      subcategory: "transport-network",
    kind: "geojson",
    file: "traffic-signals.geojson",
    color: "#f59e0b",
    defaultOn: false,
    minZoom: 13,
    description:
      "Traffic signals (highway=traffic_signals) and marked crossings (highway=crossing) mapped in OpenStreetMap.",
    caveats: [
      "Community-mapped and believed to be partial; the full signals inventory is held in the Department of Infrastructure's maintenance tables and is not published as open data.",
      "The gov.im 'Live Road Information' open-data entry is BROKEN — it is bare text with no href. What it actually points at is a variable-message-sign STATUS page (12 signs, 'no message' or 'OFFLINE'), containing no congestion, speed, flow or vehicle data whatsoever.",
      "Attribution required: (c) OpenStreetMap contributors, ODbL.",
    ],
    confidence: "C",
    sourceId: "osmIOM",
    featureCount: 155,
  },

  // ==========================================================================
  // SUBSEA CABLES
  // ==========================================================================
  {
    id: "subsea-cables",
    label: "Submarine cables",
    group: "cables",
    category: "infrastructure",
    subcategory: "subsea-cables",
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
    category: "infrastructure",
    subcategory: "subsea-cables",
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

  // ==========================================================================
  // INFRASTRUCTURE
  // ==========================================================================
  {
    id: "ports",
    label: "Ports & harbours",
    group: "infrastructure",
    category: "infrastructure",
    subcategory: "ports",
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
    category: "infrastructure",
    subcategory: "ground-stations",
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
      category: "foundational",
      subcategory: "watch-features",
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
    category: "infrastructure",
    subcategory: "seamarks",
    kind: "geojson",
    file: "seamarks.geojson",
    color: "#eab308",
    defaultOn: false,
    minZoom: 10,
    description:
      "101 lights, light-vessels, beacons and buoys from OpenStreetMap, including Chicken Rock, Calf of Man, Point of Ayre and Bradda Head. Unnamed beacons are kept and flagged rather than discarded.",
    caveats: [
      "OpenStreetMap geometry, not a UKHO or Northern Lighthouse Board publication. No official seamark layer is published as open data, so OSM is the only open route.",
      "Characteristics (range, colour, period) are frequently absent or simply wrong in OSM. Do not present them as authoritative for navigation.",
      "Northern Lighthouse Board publishes NO live webcam for any Manx light. Several 'Chicken Rock webcam' results are a content-farm aggregator with invented coordinates.",
      "Attribution required: (c) OpenStreetMap contributors, ODbL.",
    ],
    confidence: "B",
    sourceId: "osmIOM",
    featureCount: 101,
  },
  {
    id: "comms-towers",
    label: "Communication towers & masts",
    group: "infrastructure",
    category: "infrastructure",
    subcategory: "telecom",
    kind: "geojson",
    file: "comms-towers.geojson",
    color: "#7c3aed",
    defaultOn: false,
    minZoom: 10,
    description:
      "OSM-tagged cell/mast and antenna structures island-wide: man_made=tower, man_made=mast and man_made=communications_tower, with the communication-specific tower:type where mapped. This is the only open route to this data — no operator mast register is published for the Isle of Man.",
    caveats: [
      "OSM community mapping, not the operators' asset register. Present-on-the-ground sites may be unmapped, and mapped sites may be decommissioned.",
      "A mast is not proof of a live transmitter: OSM records its existence, not its operational state.",
      "Attribution required: (c) OpenStreetMap contributors, ODbL.",
    ],
    confidence: "C",
    sourceId: "osmIOM",
    featureCount: 97,
  },
  {
    id: "wifi",
    label: "Places offering WiFi",
    group: "infrastructure",
    category: "infrastructure",
    subcategory: "telecom",
    kind: "geojson",
    file: "wifi.geojson",
    color: "#0ea5e9",
    defaultOn: false,
    minZoom: 13,
    description:
      "OSM-tagged internet_access=wlan/yes and amenity=wifi features: cafes, pubs, hotels and other venues a mapper has recorded as offering WiFi. No open public-WiFi hotspot register exists for the island, so this is the only open signal — thin and self-reported.",
    caveats: [
      "OSM self-reported, community-maintained. A mapped WiFi tag means a mapper once recorded access here, not that the network is live today.",
      "Mostly venues with their own WiFi, not verified municipal public hotspots.",
      "Attribution required: (c) OpenStreetMap contributors, ODbL.",
    ],
    confidence: "C",
    sourceId: "osmIOM",
    featureCount: 46,
  },

  // ==========================================================================
  // ENERGY
  // ==========================================================================
  {
    id: "offshore-wind",
    label: "Offshore wind projects",
    group: "energy",
      category: "foundational",
      subcategory: "watch-features",
    kind: "geojson",
    file: "offshore-wind.geojson",
    color: "#0ea5e9",
    defaultOn: false,
    minZoom: 5,
    description:
      "One project, and it is a refusal rather than a lease. Mooir Vannin (Ørsted, ~1.4 GW, up to 100 turbines, 6-12 nm off Maughold Head) reached the Marine Infrastructure Consent process and its application CLOSED UNCONSENTED on 9 September 2026. Nothing is operating or consented. Shown as a single grade-D indicative point at the midpoint of the published distance band. Now shown by default like every other layer — but it is grade D and a refusal, not a consented project, so read it as a recorded proposal that did not proceed.",
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
    category: "infrastructure",
    subcategory: "water",
    kind: "geojson",
    file: "reservoirs.geojson",
    color: "#0d9488",
    defaultOn: false,
    minZoom: 10,
    description:
      "Reservoirs and impounding water bodies mapped in OpenStreetMap (landuse=reservoir / water=reservoir). Manx Utilities' operational reservoirs include West Baldwin, Sulby, Clypse and Kerrowdhoo.",
    caveats: [
      "OpenStreetMap water polygons, not Manx Utilities' asset register. Outlines are as mapped and may be incomplete or approximate.",
      "Attribution required: (c) OpenStreetMap contributors, ODbL.",
    ],
    confidence: "C",
    sourceId: "osmIOM",
    featureCount: 17,
  },
  {
    id: "power",
    label: "Power stations & substations",
    group: "energy",
    category: "infrastructure",
    subcategory: "energy-grid",
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
  {
    id: "power-lines",
    label: "Power lines & transformers",
    group: "energy",
    category: "infrastructure",
    subcategory: "energy-grid",
    kind: "geojson",
    file: "power-lines.geojson",
    pmtiles: "tiles/power-lines.pmtiles",
    color: "#f97316",
    defaultOn: false,
    minZoom: 12,
    description:
      "The distribution and transmission network the substation layer deliberately omits: overhead and underground power lines (power=line/minor_line) and the towers, poles and transformers on them (power=tower/pole/transformer), from OpenStreetMap. Voltage is carried where a mapper recorded it.",
    caveats: [
      "OSM community mapping, not Manx Utilities' asset register. Routes are as drawn by contributors and are NOT a survey: they do not carry the operator's conductor size, capacity or easement data.",
      "Voltage is frequently absent. A line without a voltage tag is still a line, but it may be low voltage, 11 kV or 33 kV and this layer does not guess which.",
      "The MEA states 1,300 km of underground cable and 530 km of overhead line; this layer is whatever OSM has mapped, which is not guaranteed to add up to that total.",
      "Attribution required: (c) OpenStreetMap contributors, ODbL.",
    ],
    confidence: "C",
    sourceId: "osmIOM",
    featureCount: 4186,
  },
  {
    id: "water-works",
    label: "Water works & pumping stations",
    group: "energy",
    category: "infrastructure",
    subcategory: "water",
    kind: "geojson",
    file: "water-works.geojson",
    color: "#0891b2",
    defaultOn: false,
    minZoom: 12,
    description:
      "Manx Utilities' treatment and distribution assets where OSM maps them: water works, water towers, pumping stations, wells and covered reservoirs (man_made=water_works/water_tower/pumping_station/water_well/reservoir_covered). Complements the reservoirs layer, which draws the raw water bodies rather than the plant.",
    caveats: [
      "OSM community mapping, not Manx Utilities' asset register. Coverage is patchy and the operator's plant names are not authoritative here.",
      "A mapped pumping station or works is a location, not an operational statement: no flow, capacity or condition is represented.",
      "Attribution required: (c) OpenStreetMap contributors, ODbL.",
    ],
    confidence: "C",
    sourceId: "osmIOM",
    featureCount: 10,
  },
  {
    id: "archaeology",
    label: "Monuments & archaeology",
    group: "poi",
    category: "heritage",
    subcategory: "archaeology",
    kind: "geojson",
    file: "archaeology.geojson",
    color: "#b45309",
    defaultOn: false,
    minZoom: 13,
    description:
      "The island's recorded archaeological monuments from OpenStreetMap: archaeological sites, monuments, keeills and wayside crosses, boundary stones, standing stones, stone circles, dolmens, castles, forts, earthworks, round towers and monastic remains (historic=*). Where the Wikidata heritage layer records statutory designation, this layer records the physical monument itself.",
    caveats: [
      "OSM community mapping, not the Manx National Heritage Historic Environment Record, which is the authoritative inventory and is not published as open data.",
      "historic=* is used inconsistently, so a mapped feature may be a monument, a marker or an area centroid; read the attributes before setting out.",
      "A handful of landmarks are also mapped as tourist attractions and so appear in the tourism layer too — the same place seen as a monument and as a visitor site, not a duplicate record.",
      "*** MANY MONUMENTS STAND ON PRIVATE LAND OR PROTECTED GROUND. *** A mapped feature is a location, not a right of access. Do not trespass, and do not disturb a scheduled monument — damaging one is a criminal offence.",
      "Attribution required: (c) OpenStreetMap contributors, ODbL.",
    ],
    confidence: "C",
    sourceId: "osmIOM",
    featureCount: 281,
  },

  // ==========================================================================
  // ENVIRONMENT
  // ==========================================================================
  {
    id: "protected",
    label: "Protected areas",
    group: "environment",
      category: "foundational",
      subcategory: "environmental-baseline",
    kind: "geojson",
    file: "protected-areas.geojson",
    color: "#22c55e",
    defaultOn: false,
    minZoom: 8,
    description:
      "Protected areas from OpenStreetMap: boundary=protected_area and leisure=nature_reserve polygons, with protection_title / designation / operator tags where mapped (ASSIs, nature reserves and similar).",
    caveats: [
      "OpenStreetMap, not the official DEFA designation register. Many designated sites (ASSIs, Marine Nature Reserves, registered heathlands) are only partially mapped or missing entirely; absence here is not absence of designation.",
      "The whole-island UNESCO Biosphere designation (2016, 572 km2 land + >4,000 km2 sea) is on biosphere.im and is not published here as a machine-readable polygon.",
      "Attribution required: (c) OpenStreetMap contributors, ODbL.",
    ],
    confidence: "C",
    sourceId: "osmIOM",
    featureCount: 12,
  },
  {
    id: "hydro",
    label: "Rivers & streams",
    group: "environment",
      category: "foundational",
      subcategory: "environmental-baseline",
    kind: "geojson",
    file: "hydrography.geojson",
    color: "#38bdf8",
    defaultOn: false,
    minZoom: 11,
    description:
      "Watercourses from OpenStreetMap (waterway=river, stream, canal, drain, ditch), each carrying its name and waterway class where mapped.",
    caveats: [
      "OpenStreetMap watercourses, not the DEFA designated-watercourse dataset. Names and classes vary with local mapping activity; small drains are inconsistently mapped.",
      "Attribution required: (c) OpenStreetMap contributors, ODbL.",
    ],
    confidence: "C",
    sourceId: "osmIOM",
    featureCount: 1430,
  },
  {
    id: "marine-habitats",
    label: "Marine habitats (biogenic substrate)",
    group: "environment",
    category: "foundational",
    subcategory: "environmental-baseline",
    kind: "geojson",
    file: "marine-habitats.geojson",
    pmtiles: "tiles/marine-habitats.pmtiles",
    color: "#22d3ee",
    defaultOn: false,
    minZoom: 8,
    description:
      "Mapped biogenic-substrate records around the Isle of Man from EMODnet Seabed Habitats 2025: point observations and bed extents for Modiolus modiolus (horse mussel) beds and related biogenic habitats, clipped to the island bounding box.",
    caveats: [
      "PRESENCE-ONLY. A record means a survey mapped that habitat; an empty area means no survey reached it, NOT that the habitat is absent.",
      "CC-BY 4.0. Attribution is per-product: credit EMODnet Seabed Habitats and the originating survey named in each feature's sourceDataset.",
      "Bed extents are clipped to the island bounding box (west 4.9 W to 4.2 W, south 54.0 N to 54.45 N) and visually stop at that edge even where the seabed feature continues beyond it.",
      "Compiled from multiple surveys of differing date and method; extents and positions are indicative and uneven in coverage.",
      "Not for navigation, fisheries management, seabed tenure or marine licensing.",
    ],
    confidence: "C",
    sourceId: "emodnetHabitats",
    featureCount: 8,
  },

  // ==========================================================================
  // AVIATION
  // ==========================================================================
  {
    id: "overture-places",
    label: "Places & businesses",
    group: "poi",
    category: "poi",
    subcategory: "places",
    kind: "geojson",
    file: "overture-places.geojson",
    pmtiles: "tiles/overture-places.pmtiles",
    color: "#f97316",
    defaultOn: false,
    minZoom: 13,
    description:
      "Places and businesses from the Overture Maps Places release, filtered to the Isle of Man bounding box. Names, addresses, categories and coordinates are not verified by the OpenMannin maintainers and the registry cannot guarantee current trading status.",
    caveats: [
      "OVERTURE RELEASE DATA. This is not an official Isle of Man register. Coverage is uneven and contributors may disagree on naming, categories and open/closed status.",
      "Only records whose PRIMARY CONTRIBUTOR (sources[1] with property == '') declares the CDLA-Permissive-2.0 licence are shipped. Foursquare records carrying Apache-2.0 and AllThePlaces records carrying CC0-1.0 were deliberately excluded.",
      "A mapped place is not evidence that the business or feature exists today.",
      "The underlying coordinates are derived from each contributor's location model and may be approximate (tens to hundreds of metres).",
      "Attribution required: Overture release contributors under CDLA-Permissive-2.0. The sourceDataset property documents the originating contributor for every feature.",
    ],
    confidence: "C",
    sourceId: "overturePlaces",
    featureCount: 3482,
  },
  {
    id: "airport",
    label: "Airports & airstrips",
    group: "aviation",
      category: "foundational",
      subcategory: "aviation-monitoring",
    kind: "geojson",
    file: "airports.geojson",
    color: "#f43f5e",
    defaultOn: false,
    minZoom: 8,
    featureCount: 7,
    description:
      "Seven aerodromes, from OurAirports: Isle of Man Airport (EGNS/IOM, the only field with scheduled service), the ex-RAF fields at Andreas and Jurby, two private airstrips, Noble's Hospital heliport, and the closed Hall Caine Airport. EGNS carries three asphalt runways: 08/26 at 2,110 x 46 m, 03/21 at 1,255 x 46 m, and 17/35 at 903 x 27 m which OurAirports marks closed.",
    caveats: [
      "OurAirports is crowd-maintained. Positions are aerodrome reference points and are not independently audited; expect survey-grade accuracy on paper but no published verification.",
      "No official airport or runway dataset is published as open data — an earlier draft of this layer claimed SKYbrary and OSM geometry, which was not what the layer actually contained.",
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
    id: "tide-stations",
    label: "Tide reference stations",
    group: "surveillance",
      category: "foundational",
      subcategory: "aviation-monitoring",
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
  // POINTS OF INTEREST
  // ==========================================================================
  {
    id: "mine-infrastructure",
    label: "Mines & industrial heritage",
    group: "poi",
    category: "heritage",
    subcategory: "mine-infrastructure",
    kind: "geojson",
    file: "mine_infrastructure.geojson",
    color: "#b45309",
    defaultOn: false,
    minZoom: 13,
    description:
      "The surface evidence of the Isle of Man's industrial heritage, from OpenStreetMap: mine shafts (man_made=mineshaft), adits (man_made=adit) and mines (historic=mine / historic=mine_disused), plus the quarrying and processing remains that shared the same ground — quarries (historic=quarry), lime kilns (historic=lime_kiln / man_made=kiln), spoil heaps (man_made=spoil_heap) and water wheels (man_made=water_wheel). This is the lead, copper, zinc and silver country of Laxey, Foxdale and Snaefell, plus the many smaller workings — records no official open dataset publishes.",
    caveats: [
      "*** SAFETY — DO NOT ENTER. *** Mine shafts and adits are lethal hazards. Underground workings can be unstable, flooded, or hold bad air (low oxygen, methane, carbon dioxide). Ground around a capped or infilled shaft can collapse without warning. Treat every feature here as a hazard to avoid, not a place to visit.",
      "Positions are community mapping, not a survey. A point may mark a shaft, an adit mouth, a quarry face, a kiln, a spoil heap or an area centroid — read the attributes before going anywhere near it.",
      "No official mining or industrial-archaeology register is published as open data; Manx National Heritage holds the archaeological record. See the 'Abandoned mines' gap.",
      "Attribution required: (c) OpenStreetMap contributors, ODbL.",
    ],
    confidence: "C",
    sourceId: "osmIOM",
    featureCount: 30,
  },
  {
    id: "tholtans-ruins",
    label: "Tholtans & ruined buildings",
    group: "poi",
    category: "heritage",
    subcategory: "tholtans-ruins",
    kind: "geojson",
    file: "tholtans_ruins.geojson",
    color: "#78716c",
    defaultOn: false,
    minZoom: 14,
    description:
      "Manx tholtans — abandoned and ruinous structures — from OpenStreetMap: historic=ruins, building=ruins, ruins=yes, abandoned:building=* and disused=yes. Farmsteads, cottages, mills and derelict structures scattered across the island. Derelict mines and quarries are held in the mines & industrial heritage layer instead, so a working's remains are not counted twice.",
    caveats: [
      "STRUCTURALLY UNSAFE. A ruin is a ruin: walls and roofs may be collapsing and floors and cellars open. Do not enter.",
      "MANY THOLTANS STAND ON PRIVATE LAND. A mapped feature is a location, not a public right of access. Do not trespass.",
      "disused=yes is broad and can match non-building features a mapper has flagged disused; read the attributes rather than assuming a building.",
      "Community-mapped from OpenStreetMap; not the Manx National Heritage Historic Environment Record.",
      "Attribution required: (c) OpenStreetMap contributors, ODbL.",
    ],
    confidence: "C",
    sourceId: "osmIOM",
    featureCount: 860,
  },
  {
    id: "essential-utilities",
    label: "Essential utilities & services",
    group: "poi",
    category: "poi",
    subcategory: "amenities",
    kind: "geojson",
    file: "essential_utilities.geojson",
    color: "#0891b2",
    defaultOn: false,
    minZoom: 13,
    description:
      "Everyday essential services from OpenStreetMap: fuel stations, cash machines, banks, public toilets and public-access defibrillators (amenity=fuel/atm/bank/toilets, emergency=defibrillator).",
    caveats: [
      "Community-mapped and can be out of date — a site may have closed or a defibrillator moved. VERIFY before relying on any of these, especially in an emergency.",
      "A mapped defibrillator is not a guarantee of 24-hour public access; it may be behind a locked door. Check the access and opening_hours attributes.",
      "Branch and ATM availability changes, and free-to-use versus fee-charging is not always tagged.",
      "Attribution required: (c) OpenStreetMap contributors, ODbL.",
    ],
    confidence: "C",
    sourceId: "osmIOM",
    featureCount: 187,
  },
  {
    id: "food-drink",
    label: "Food & drink",
    group: "poi",
    category: "poi",
    subcategory: "food-drink",
    kind: "geojson",
    file: "food_drink.geojson",
    color: "#d97706",
    defaultOn: false,
    minZoom: 13,
    description:
      "Places to eat and drink from OpenStreetMap: restaurants, cafes, pubs and bars (amenity=restaurant/cafe/pub/bar), carrying cuisine, operator and opening hours where mapped.",
    caveats: [
      "Community-mapped; names, cuisines and opening hours change. VERIFY with the venue before travelling.",
      "Includes licensed bars and pubs alongside food-serving venues; the sub-type is in each feature's attributes.",
      "Attribution required: (c) OpenStreetMap contributors, ODbL.",
    ],
    confidence: "C",
    sourceId: "osmIOM",
    featureCount: 310,
  },
  {
    id: "coastal-outdoor",
    label: "Coastal & outdoor",
    group: "poi",
    category: "poi",
    subcategory: "outdoor",
    kind: "geojson",
    file: "coastal_outdoor.geojson",
    color: "#0d9488",
    defaultOn: false,
    minZoom: 12,
    description:
      "Coastal and outdoor recreation points from OpenStreetMap: slipways, viewpoints, picnic sites and car parks (leisure=slipway, tourism=viewpoint/picnic_site, amenity=parking).",
    caveats: [
      "TIDE AND WEATHER MATTER. A slipway may be unusable or submerged at some states of the tide, and coastal viewpoints and picnic sites are exposed. Check tide tables and forecasts.",
      "Car parks may be pay-and-display, time-limited or private; fees and access are not always tagged.",
      "Community-mapped; not an official access or amenities dataset — see the 'Coastal access points' gap.",
      "Attribution required: (c) OpenStreetMap contributors, ODbL.",
    ],
    confidence: "C",
    sourceId: "osmIOM",
    featureCount: 1067,
  },

  // ==========================================================================
  // LIVE FEEDS
  // ==========================================================================
  {
    id: "satellite-passes",
    label: "Satellite pass predictions",
    group: "live",
      category: "foundational",
      subcategory: "watch-features",
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
    id: "wikidata-memorials",
    label: "Wikidata memorials & monuments",
    group: "poi",
    category: "heritage",
    subcategory: "designated",
    kind: "geojson",
    file: "wikidata-memorials.geojson",
    color: "#8b5cf6",
    defaultOn: false,
    minZoom: 13,
    description:
      "Memorials, monuments, statues and war memorials recorded in Wikidata for the Isle of Man (Q9676) with an instance of monument, memorial, war memorial or statue and a coordinate. Complements the heritage layer, which is limited to items carrying a formal heritage designation, and records sites that are commemorative rather than designated buildings.",
    caveats: [
      "WIKIDATA COMMUNITY DATA, NOT AN OFFICIAL REGISTER. Coordinates are as supplied by Wikidata contributors and may be approximate; verification against an Ordnance Survey or monument survey is recommended before any visit.",
      "This layer is about memory, not current permissions. A war memorial in a road junction may be in a public highway and off-limits to vehicles but visible; a statue may be on private land. Do not trespass to inspect any memorial and verify local rules before photographing or placing material.",
      "Wikidata is searchable and incomplete. Absence here is not evidence that a memorial does not exist; some may be unlisted, mis-geolocated or unmappably small.",
      "Wikidata structured data is CC0 — no attribution or share-alike obligation.",
    ],
    confidence: "C",
    sourceId: "wikidata",
    featureCount: 12,
  },
  {
    id: "buildings",
    label: "Building footprints",
    group: "geography",
    category: "foundational",
    subcategory: "buildings",
    kind: "geojson",
    file: "buildings.geojson",
    pmtiles: "tiles/buildings.pmtiles",
    color: "#c9c2b6",
    defaultOn: false,
    minZoom: 14,
    description:
      "Building footprints across the island from OpenStreetMap, via the Overture Maps buildings theme. Every footprint carries its OSM element id and its OSM tags (name, address, purpose, operator) where mapped. Streamed as vector tiles, with building class, subtype and height where OpenStreetMap records them.",
    caveats: [
      "ODbL: attribution AND share-alike. Data (c) OpenStreetMap contributors and the Overture Maps contributors, ODbL.",
      "OpenStreetMap only. Microsoft ML roofprints were removed: they are machine-generated from aerial imagery with no element id to verify, and unverifiable geometry does not belong on an accuracy-first map. Coverage is therefore smaller, and honest, rather than padded.",
      "Every feature links to its OSM element id, so any footprint can be checked against OpenStreetMap. Absent or wrong OSM mapping will be absent or wrong here.",
      "Geometry is simplified to about 2 m for shipping; do not use this layer for land registry, planning or anything requiring cadastral accuracy.",
    ],
    confidence: "C",
    sourceId: "overtureBuildings",
    featureCount: 32794,
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
      "No official gazetteer is published as open data. A government layer named 'Field Gazetteer' contains no name field at all — its fields are PLOT, START, ACRES3D, CATEGORY, OCCUP_CURR and USECOD_CURR, making it agricultural field parcels, not a place-name index. That layer is not openly licensed and has been removed. This was previously mislabelled in OpenMannin as a 19,848-record toponymic gazetteer; the error is corrected.",
    whatWeWouldNeed:
      "A published official gazetteer service, or the Isle of Man Survey's place-name data if it is released under the OGL. Meanwhile the place-name layer is built from OpenStreetMap (1,253 distinct named places after dropping 152 node/way duplicates, ODbL), which is open and usable but is a community dataset rather than an official one.",
    contact: "mapping@gov.im",
    severity: "medium",
  },
  {
    id: "house-numbers",
    title: "House numbers",
    wanted: "Isle of Man house numbers and full street addresses as map points.",
    whyUnavailable:
      "The government LLPG address geocoder returns HTTP 403 with error GWM_0003 to anonymous callers and has no copyrightText — it is an authorised-access service. The only complete address source is OS AddressBase Islands, which is a commercial product (three-month free Data Exploration Licence). A second LLPG geocoder is exposed on the pre-production host ppmaps.gov.im. Planning-application data carries 81,232 non-null addresses but those are application sites, not a national address register.",
    whatWeWouldNeed:
      "Either authorised access to the LLPG geocoder, or an OS AddressBase Islands subscription. Until then: the Planning layer's 35,158 postcode-bearing addresses are the closest available substitute.",
    contact: "mapping@gov.im",
    severity: "high",
  },
  {
    id: "mines",
    title: "Abandoned mines",
    wanted:
      "Lead and copper mine sites, adits, shafts, spoil heaps and processing plants — the Isle of Man's signature industrial heritage.",
    whyUnavailable:
      "No official mining layer is published. Searches of the government's 564 open items for 'mine', 'mining', 'mineral', 'spoil' and 'shaft' return zero results. Manx National Heritage holds the authoritative archaeological record but its HER API returns 404 on every conventional path and it operates an Access and Charging Policy, so some reuse may be chargeable.",
    whatWeWouldNeed:
      "The Manx National Heritage HER under licence, which would add processing plants, survey-grade positions and the full documentary record. The OSM fallback is now built and shipped as the 'Mines & industrial heritage' layer — partial and community-mapped, graded C — so this gap remains only for the authoritative record. Contact iomher@mnh.im.",
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
      "Government authorisation, or a Central Registry land-boundary extract.",
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
      "Either an official harbours layer, or the Marine Operations Centre's own published positions under the OGL. OSM is a reasonable fallback provided each point is graded honestly as a community-derived harbour centroid rather than a surveyed pier head.",
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

  // --------------------------------------------------------------------------
  // Coverage that could not be independently licensed. Government map-derived
  // data is not open (the IoM OGL excludes maps and map-derived products), so
  // where a usable open source was not found the layer is recorded here rather
  // than silently dropped or relicensed.
  // --------------------------------------------------------------------------
  {
    id: "field-parcels",
    title: "Agricultural field parcels",
    wanted: "The island's agricultural field parcels with land-use category and acreage.",
    whyUnavailable:
      "The previous source was a government 'Field Gazetteer' layer (19,848 parcels). Government map-derived data is not openly licensed and has been removed. No independently licensed, complete parcel dataset was found.",
    whatWeWouldNeed:
      "DEFA to release the parcel boundaries under the OGL, or an open agricultural land-cover dataset for the island.",
    contact: "agriculture@gov.im",
    severity: "medium",
  },
  {
    id: "glens-and-trees",
    title: "Glens, registered trees and ramblage land",
    wanted: "Glen boundaries, individually registered trees and public rambling land.",
    whyUnavailable:
      "These were government map layers (22 glens, 1,199 registered trees, 7 ramblage records) and are removed because that data is not openly licensed. Partial coverage may exist in OpenStreetMap or as National Trust land but was not sufficient to rebuild the official datasets.",
    whatWeWouldNeed:
      "DEFA to release the glen, tree-register and CGMRA ramblage layers under the OGL, or a licensed data exchange.",
    contact: "mapping@gov.im",
    severity: "medium",
  },
  {
    id: "prow-network",
    title: "Public rights of way and footpaths",
    wanted: "The definitive Public Rights of Way map and the DEFA footpath network.",
    whyUnavailable:
      "The PROW, footpath, promoted-walking, cycle and pilgrimage route layers were all government mapping services and are removed. The definitive PROW map is maintained by the Department of Infrastructure in Central Registry and is not open in any reusable form.",
    whatWeWouldNeed:
      "DoI to publish the definitive PROW map under the OGL. OSM carries partial path coverage but is not the definitive map.",
    contact: "infrastructure@gov.im",
    severity: "high",
  },
  {
    id: "bus-route-alignments",
    title: "Bus route alignments",
    wanted: "Current Bus Vannin route alignments as polylines.",
    whyUnavailable:
      "The previous bus-routes layer was a 2015 government network and is removed. OSM bus route relations exist but only a fraction of stops are members, and the alignments were not extracted into a comparable layer. A new `bus-routes` layer now provides partial OSM-derived alignments (geometry only, not a timetable); VERIFY against iombusandrail.im before relying on them.",
    whatWeWouldNeed:
      "Bus Vannin / Public Transport to release current route alignments under the OGL, or a complete set of OSM route relations.",
    contact: "buses@gov.im",
    severity: "medium",
  },
  {
    id: "tt-course",
    title: "TT and Billown course infrastructure",
    wanted: "The TT Mountain Course and Billown circuit alignments and infrastructure.",
    whyUnavailable:
      "The previous layer was a government 'MotorCourse' service and is removed. No open, licensed alignment is published; the widely quoted 37.73 mile length is Wikipedia-only with no official linear referencing.",
    whatWeWouldNeed:
      "The Department for Enterprise / Motorsport to release the course alignment under the OGL.",
    contact: "motorsport@gov.im",
    severity: "low",
  },
  {
    id: "coastal-access",
    title: "Coastal access points",
    wanted: "Published access points to the Isle of Man coastline.",
    whyUnavailable:
      "This was a government map layer (40 points) and is removed because it is not openly licensed. No official open equivalent exists, but a community substitute is now built: the 'Coastal & outdoor' layer carries OpenStreetMap slipways, viewpoints, picnic sites and car parks, and slipways are the practical access points. It is community-mapped and does not reproduce the government's 40 points.",
    whatWeWouldNeed:
      "DEFA or the Marine Plan to release the official coastal access points under the OGL. Until then the OSM-derived 'Coastal & outdoor' layer is the available substitute.",
    contact: "EnvironmentalProtection@gov.im",
    severity: "low",
  },
  {
    id: "fishery-closures",
    title: "Fishery closure areas",
    wanted:
      "Legally closed fishing areas and seasonal gear restrictions in Manx waters (the 3-mile and 12-mile limits, scallop and queenie closures, and the protected areas that carry fishing restrictions).",
    whyUnavailable:
      "Marine habitats are now shipped from EMODnet (see the Marine habitats layer), but this was originally a government map layer (434 features) that bundled habitats with fishery closures and was removed because it is not openly licensed. The closure component has no open replacement: DEFA's fisheries closures are published as notices and PDFs rather than a machine-readable, licensed geometry, and the Marine Management Organisation's equivalent does not extend to Isle of Man waters.",
    whatWeWouldNeed:
      "DEFA Fisheries to publish closure areas and seasonal restrictions under the OGL as a point or polygon service, or a documented open dataset of Manx fishery closures with a licence that permits reuse.",
    contact: "EnvironmentalProtection@gov.im",
    severity: "medium",
  },
  {
    id: "ais-live",
    title: "Live AIS vessel tracking",
    wanted: "Live positions of vessels transiting Manx waters — the busiest OSINT signal there is for Douglas Bay and the Irish Sea approaches.",
    whyUnavailable:
      "There is NO free, no-key programmatic AIS source. AISStream is free but requires an API key, caps 3 connections per account AND per originating IP, prohibits direct browser connections in its own docs, and publishes no terms document — an undocumented-licence gap we will not silently build on. MarineTraffic is sales-gated and paid; Global Fishing Watch is CC BY-NC (blocks ad-supported deployment). A browser-side WebSocket client was built and evaluated on 2026-10-07, then removed, because a client shipped without a deployer-provided key would be dead code and would still lean on an undocumented licence.",
    whatWeWouldNeed: "A server-side ingest fanning one licensed connection out to clients, or a properly documented open licence from the provider.",
    severity: "medium",
  },
  {
    id: "overture-non-cdla",
    title: "Overture Maps places: non-CDL-A contributors",
    wanted: "The full mixed-licence Overture place and business layer rather than only the CDLA-Permissive-2.0 subset.",
    whyUnavailable:
      "Overture Places is mixed-licence by contributor. Foursquare records carry Apache-2.0 and AllThePlaces records carry CC0-1.0, so both were excluded rather than being relabelled as CDLA-Permissive-2.0 and shipped in overture-places.geojson.",
    whatWeWouldNeed:
      "Separate licence-clean layer(s), or per-record attribution and licence handling that preserves Apache-2.0 and CC0 obligations differently from CDLA-Permissive-2.0.",
    severity: "low",
  },
];
