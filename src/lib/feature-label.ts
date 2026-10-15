/**
 * One label for a feature, wherever it is rendered.
 *
 * The Browse list and the map popup used to resolve a feature's name with two
 * different, narrow key lists, so the same feature could read "AS926" in the
 * popup and "(unnamed)" in the list, or show "(unnamed)" as the title while the
 * attributes underneath rendered its code, ref or operator. That is the exact
 * complaint this module exists to fix: the title and the body can no longer
 * disagree, because there is only one resolver.
 *
 * It resolves in three tiers:
 *   1. an explicit identity the ingest wrote (name, label, code, ref, ...);
 *   2. a kind derived from the feature's own tags (Footway, Stream, 30 mph
 *      limit, Lighthouse, Mine adit, ...), optionally qualified with the
 *      nearest named place when the feature is genuinely anonymous;
 *   3. the OSM id, so an anonymous feature is still traceable.
 *
 * A placeholder such as the literal "(unnamed)" an old seamark ingest wrote
 * into `name` is never treated as an identity - that is the whole bug.
 */

/** Values that are placeholders, not names. */
const PLACEHOLDERS = new Set([
  "",
  "(unnamed)",
  "unnamed",
  "unknown",
  "(unknown)",
  "n/a",
  "na",
  "none",
  "-",
  "?",
]);

/** Identity fields in preference order: a real name beats an identifier. */
const IDENTITY_KEYS = [
  "label",
  "name",
  "Name",
  "NAME",
  "title",
  "official_name",
  "alt_name",
  "short_name",
  "housename",
  "housenumber",
  "address",
  "location",
  "site",
  "code",
  "ref",
  "ref:registered_building",
  "ref:planning",
  "designation",
  "species",
  "plot",
];

const HIGHWAY: Record<string, string> = {
  footway: "Footway",
  path: "Path",
  bridleway: "Bridleway",
  cycleway: "Cycleway",
  service: "Service road",
  track: "Track",
  residential: "Residential road",
  unclassified: "Unclassified road",
  primary: "Primary road",
  secondary: "Secondary road",
  tertiary: "Tertiary road",
  trunk: "Trunk road",
  motorway: "Motorway",
  living_street: "Living street",
  pedestrian: "Pedestrian street",
  steps: "Steps",
  road: "Road",
  traffic_signals: "Traffic signals",
};

const RAILWAY: Record<string, string> = {
  rail: "Railway",
  narrow_gauge: "Narrow-gauge railway",
  light_rail: "Light rail",
  tram: "Tramway",
  station: "Railway station",
  halt: "Railway halt",
  disused: "Disused railway",
};

const WATERWAY: Record<string, string> = {
  stream: "Stream",
  river: "River",
  drain: "Drain",
  ditch: "Ditch",
  canal: "Canal",
  waterfall: "Waterfall",
};

const WATER: Record<string, string> = {
  reservoir: "Reservoir",
  lake: "Lake",
  pond: "Pond",
  basin: "Basin",
};

const LEISURE: Record<string, string> = {
  nature_reserve: "Nature reserve",
  park: "Park",
  common: "Common",
  garden: "Garden",
};

const BOUNDARY: Record<string, string> = {
  protected_area: "Protected area",
  national_park: "National park",
};

const SEAMARK: Record<string, string> = {
  lighthouse: "Lighthouse",
  light_minor: "Minor light",
  light_major: "Major light",
  beacon: "Beacon",
  buoy: "Buoy",
  light_vessel: "Light vessel",
  daymark: "Daymark",
};

const FOOT_BRIDGE_HIGHWAY = new Set(["footway", "path", "steps", "cycleway", "bridleway", "pedestrian"]);

/** First present, non-placeholder string among `keys`. */
function firstString(props: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const v = props[key];
    if (typeof v === "string" && !PLACEHOLDERS.has(v.trim().toLowerCase()) && v.trim()) {
      return v.trim();
    }
  }
  return null;
}

function mapped(table: Record<string, string>, value: unknown): string | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase();
  if (!key) return null;
  return table[key] ?? humanise(key);
}

function humanise(value: string): string {
  const spaced = value.replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * A kind from the feature's own tags, or null when nothing describes it.
 *
 * Order matters: a speed limit outranks the road class it sits on, a bridge
 * outranks the way crossing it, and a named seamark type outranks the generic
 * `kind` field other layers also use.
 */


const BUILDING_CLASS_LABELS: Record<string, string> = {
  house: "House",
  semidetached_house: "Semi-detached house",
  detached: "Detached house",
  detached_house: "Detached house",
  terrace: "Terraced house",
  terraced: "Terraced house",
  semidetached: "Semi-detached house",
  apartments: "Apartment building",
  bungalow: "Bungalow",
  office: "Office",
  shop: "Shop",
  retail: "Retail",
  pub: "Pub",
  cafe: "Cafe",
  restaurant: "Restaurant",
  hotel: "Hotel",
  school: "School",
  hospital: "Hospital",
  church: "Church",
  chapel: "Chapel",
  warehouse: "Warehouse",
  industrial: "Industrial building",
  parking: "Car park",
  garage: "Garage",
  farm: "Farm building",
  farm_auxiliary: "Farm building",
  ruins: "Ruined building",
  ruins_of: "Ruined building",
  storage_tank: "Storage tank",
  shelter: "Shelter",
};

function buildingLabel(value: string): string {
  const key = value.trim().toLowerCase();
  return BUILDING_CLASS_LABELS[key] ?? humanise(value.trim());
}

/** Buildings carry many derived values that are not an identity (no name) but
 *  make a better row label than a blank or the literal "(unnamed)". */
function buildingDescriptor(props: Record<string, unknown>): string | null {
  const number = firstString(props, ["housenumber", "addr:housenumber"]);
  const name = firstString(props, ["housename", "addr:housename"]);
  const street = firstString(props, ["street", "addr:street", "substreet", "addr:substreet", "addr:place", "place"]);
  const place = firstString(props, ["nearestPlace"]);
  const kindish = firstString(props, ["purpose", "buildingClass", "subtype", "building", "amenity", "shop", "office", "tourism", "religion", "historic"]);
  const safeKindish = kindish && !PLACEHOLDERS.has(kindish.toLowerCase()) ? kindish : null;
  if (name && street) return `${name}, ${street}`.trim();
  if (number && street) return `${number} ${street}`.trim();
  if (safeKindish && street) return `${buildingLabel(safeKindish)} \u00b7 ${street}`;
  if (name) return name;
  if (number && place) return `${number} near ${place}`.trim();
  if (safeKindish && place) return `${buildingLabel(safeKindish)} \u00b7 ${place}`;
  if (safeKindish) return buildingLabel(safeKindish);
  if (street) return street;
  if (place) return `Footprint near ${place}`;
  const osm = typeof props.osmId === "string" ? props.osmId.trim() : "";
  if (osm) return `Feature ${osm}`;
  return null;
}

export function featureKind(props: Record<string, unknown> | null | undefined): string | null {
  if (!props) return null;

  if (props.bridge) {
    if (FOOT_BRIDGE_HIGHWAY.has(String(props.highway ?? "").toLowerCase())) return "Footbridge";
    if (props.railway) return "Railway bridge";
    if (props.highway) return "Road bridge";
    return "Bridge";
  }

  if (typeof props.maxspeed === "string" && props.maxspeed.trim()) {
    const v = props.maxspeed.trim();
    if (/^none$/i.test(v)) return "National speed limit";
    return /limit$/i.test(v) ? v : `${v} limit`;
  }

  const rail = mapped(RAILWAY, props.railway);
  if (rail) return rail;

  const waterway = mapped(WATERWAY, props.waterway);
  if (waterway) return waterway;

  const water = mapped(WATER, props.water);
  if (water) return water;

  const highway = mapped(HIGHWAY, props.highway);
  if (highway) return highway;

  const leisure = mapped(LEISURE, props.leisure);
  if (leisure) return leisure;

  const boundary = mapped(BOUNDARY, props.boundary);
  if (boundary) return boundary;

  if (props.seamarkType !== undefined || props.named !== undefined) {
    const seamark = mapped(SEAMARK, props.kind ?? props.seamarkType);
    if (seamark) return seamark;
  }

  // Charging networks carry no amenity tag in the ingest; the socket columns
  // are the tell.
  if (props.socketType2 !== undefined || props.socketChademo !== undefined || props.socketCcs !== undefined) {
    return "Charge point";
  }

  if (typeof props.kind === "string" && props.kind.trim()) {
    return humanise(props.kind.trim());
  }

  // Buildings may arrive with class/subtype/purpose tags instead of a name.
  if (typeof props.purpose === "string" && props.purpose.trim()) return buildingLabel(props.purpose.trim());
  if (typeof props.buildingClass === "string" && props.buildingClass.trim()) return buildingLabel(props.buildingClass.trim());
  if (typeof props.subtype === "string" && props.subtype.trim()) return buildingLabel(props.subtype.trim());

  // The heritage ingests write a ready-made human `type` ("Mine adit",
  // "Ruins", "Castle"). It is already cased, so use it verbatim rather than
  // running it back through humanise().
  if (typeof props.type === "string" && props.type.trim()) {
    return props.type.trim();
  }

  return null;
}

/**
 * True when a feature carries a real identity (a name, code, ref, ...) rather
 * than only a type we inferred. Used to keep anonymous "Footway"/"Stream"
 * features out of a search index, where they would be pure noise.
 */
export function hasIdentity(props: Record<string, unknown> | null | undefined): boolean {
  if (!props) return false;
  if (firstString(props, IDENTITY_KEYS)) return true;
  if (typeof props.asn === "number" && Number.isFinite(props.asn)) return true;
  if (typeof props.regNo === "string" && props.regNo.trim()) return true;
  return false;
}

/**
 * A human label for a feature. Never returns a placeholder an ingest wrote in;
 * falls back through kind, nearest place and finally the OSM id.
 */
export function resolveFeatureLabel(props: Record<string, unknown> | null | undefined): string {
  if (!props) return "(unnamed)";

  const identity = firstString(props, IDENTITY_KEYS);
  if (identity) return identity;

  if (typeof props.asn === "number" && Number.isFinite(props.asn)) return `AS${props.asn}`;
  if (typeof props.regNo === "string" && props.regNo.trim()) return `Reg. ${props.regNo.trim()}`;

  // A registered-holder string is a weak fallback: it is a description of the
  // owner, not the feature's name.
  const holder = firstString(props, ["holder", "asName"]);
  if (holder) return holder;

  const isBuilding = props.buildingClass !== undefined || typeof props.osmId === "string" || props.enrichedBy === "osm-overpass" || (typeof props.sourceDataset === "string" && /buildings/i.test(props.sourceDataset));
  const descriptor = isBuilding ? buildingDescriptor(props) : null;
  if (descriptor && !PLACEHOLDERS.has(descriptor.toLowerCase()) && descriptor !== "(unnamed)") return descriptor;

  const kind = featureKind(props);
  if (kind) {
    const place = typeof props.nearestPlace === "string" ? props.nearestPlace.trim() : "";
    if (place && !PLACEHOLDERS.has(place.toLowerCase())) return `${kind} near ${place}`;
    return kind;
  }

  const osm = typeof props.osm === "string" ? props.osm.trim() : "";
  if (osm) return `Feature ${osm}`;

  return "(unnamed)";
}
