/**
 * Reader-facing layer taxonomy.
 *
 * `category` is the coarse theme and `subcategory` the drawer inside it. This
 * is navigation, not the register: LayerGroup remains the stable key used by
 * SOURCES.md and the ingest provenance, and is untouched here.
 *
 * Order is explicit rather than alphabetical, because a reader should meet
 * "Public rights of way" before "Heritage railways", and the island's heritage
 * before its points of interest.
 */

import type { LayerCategory, LayerSubcategory } from "./types";

export const CATEGORY_ORDER: LayerCategory[] = [
  "foundational",
  "heritage",
  "prow",
  "infrastructure",
  "civic",
  "poi",
];

export const CATEGORY_LABELS: Record<LayerCategory, string> = {
  foundational: "Foundational context",
  heritage: "Heritage",
  prow: "Rights of way & trails",
  infrastructure: "Infrastructure",
  civic: "Civic & addresses",
  poi: "Points of interest",
};

export const CATEGORY_BLURBS: Record<LayerCategory, string> = {
  foundational: "Base geography, transport status, monitoring and major hazard context.",
  heritage: "Designated places, tholtans, mines and archaeology.",
  prow: "Footpaths, bridleways, green lanes, trails and heritage rail.",
  infrastructure: "Grid, telecoms, EV, water, ports and subsea infrastructure.",
  civic: "Boundaries, addresses and emergency services.",
  poi: "Food, amenities, outdoor sites, tourism and transport.",
};

/** The drawers inside each theme, in the order they should be met. */
export const SUBCATEGORY_ORDER: Record<LayerCategory, LayerSubcategory[]> = {
  foundational: [
    "place-names",
    "transport-network",
    "environmental-baseline",
    "buildings",
    "aviation-monitoring",
    "watch-features",
  ],
  heritage: ["designated", "mine-infrastructure", "tholtans-ruins", "archaeology"],
  prow: ["rights-of-way", "trails", "heritage-railways"],
  infrastructure: [
    "energy-grid",
    "telecom",
    "ev-charging",
    "water",
    "ports",
    "ground-stations",
    "seamarks",
    "subsea-cables",
  ],
  civic: ["boundaries", "addresses", "emergency-services"],
  poi: [
    "food-drink",
    "amenities",
    "public-transport",
    "services",
    "outdoor",
    "tourism",
    "worship",
    "places",
  ],
};

export const SUBCATEGORY_LABELS: Record<LayerSubcategory, string> = {
  "place-names": "Place names",
  "transport-network": "Transport network",
  "environmental-baseline": "Environmental baseline",
  buildings: "Building footprints",
  "aviation-monitoring": "Aviation & monitoring",
  "watch-features": "Hazard and feasibility context",
  designated: "Designated places",
  "mine-infrastructure": "Mines & industrial heritage",
  "tholtans-ruins": "Tholtans & ruined buildings",
  archaeology: "Monuments & archaeology",
  "rights-of-way": "Public rights of way",
  trails: "Long-distance trails",
  "heritage-railways": "Heritage railways",
  "energy-grid": "Energy grid",
  telecom: "Telecoms & masts",
  "ev-charging": "EV charging",
  water: "Water supply",
  ports: "Ports & harbours",
  "ground-stations": "Satellite ground stations",
  seamarks: "Lighthouses & seamarks",
  "subsea-cables": "Subsea cables & landings",
  boundaries: "Boundaries",
  addresses: "Addresses",
  "emergency-services": "Emergency services",
  "food-drink": "Food & drink",
  amenities: "Amenities & utilities",
  "public-transport": "Public transport",
  services: "Health & education",
  outdoor: "Coastal & outdoor",
  tourism: "Tourism",
  worship: "Places of worship",
  places: "Places & businesses",
};

/**
 * Sort subcategories present in a category: the curated order first, then any
 * drawer not listed (so a new layer is never silently dropped from the tree).
 */
export function orderSubcategories(
  category: LayerCategory,
  present: LayerSubcategory[],
): LayerSubcategory[] {
  const rank = SUBCATEGORY_ORDER[category];
  const known = present
    .filter((s) => rank.includes(s))
    .sort((a, b) => rank.indexOf(a) - rank.indexOf(b));
  const unknown = present.filter((s) => !rank.includes(s));
  return [...known, ...unknown];
}
