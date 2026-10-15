/**
 * Heritage tag classification for the expanded OSM industrial-heritage ingest.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * OpenMannin's heritage coverage is split across three layers by OSM tag, and
 * the tags overlap: a feature can be a `building=ruins` AND an
 * `historic=archaeological_site`, or a `historic=quarry` AND `ruins=yes`.
 * When the three ingests each query their own tags independently, the same
 * OSM element ships in two files — the exact silent duplication
 * verify-registry asserts stays at zero.
 *
 * So the expanded ingest runs ONE combined Overpass query and then assigns
 * every element to exactly one owner here, by priority. That makes the three
 * output layers disjoint BY CONSTRUCTION rather than by hope. The mapping is a
 * pure function so the assignment rules are unit-tested, not buried in the
 * fetch loop.
 *
 * Ownership priority (first match wins):
 *   1. mine         — mines, shafts, adits, quarrying and kiln/industrial tags
 *   2. archaeology  — recorded monuments, keeills, castles, forts, crosses
 *   3. ruins        — tholtans, ruined/abandoned buildings, disused features
 */

/** `man_made=*` values that belong to the industrial-heritage (mine) layer. */
export const INDUSTRIAL_MAN_MADE = new Set([
  "mineshaft",
  "adit",
  "kiln",
  "water_wheel",
  "spoil_heap",
]);

/** `historic=*` values that belong to the industrial-heritage (mine) layer. */
export const INDUSTRIAL_HISTORIC = new Set([
  "mine",
  "mine_disused",
  "mine_shaft",
  "quarry",
  "lime_kiln",
]);

/** `historic=*` values that belong to the monuments & archaeology layer. */
export const MONUMENT_HISTORIC = new Set([
  "archaeological_site",
  "wayside_cross",
  "boundary_stone",
  "city_gate",
  "castle",
  "fort",
  "monastery",
  "tomb",
  "dolmen",
  "stone_circle",
  "standing_stone",
  "round_tower",
  "earthwork",
  "keill",
  "monument",
]);

/** The three output layers, and the data file each writes. */
export const HERITAGE_LAYERS = {
  mine: "mine_infrastructure.geojson",
  archaeology: "archaeology.geojson",
  ruins: "tholtans_ruins.geojson",
};

/**
 * Which layer owns this element's tags, or null when nothing claims it.
 *
 * The order encodes the ownership boundary the registry enforces: a derelict
 * mine is industrial heritage before it is a ruin, and a ruined chapel that is
 * a scheduled monument is archaeology before it is a ruin.
 */
export function assignLayer(tags = {}) {
  const manMade = tags.man_made;
  const historic = tags.historic;

  if (manMade && INDUSTRIAL_MAN_MADE.has(manMade)) return "mine";
  if (historic && INDUSTRIAL_HISTORIC.has(historic)) return "mine";

  if (historic && MONUMENT_HISTORIC.has(historic)) return "archaeology";
  // Keeills are usually tagged historic=archaeological_site + archaeological_site=keill
  // (or "keeil"). Catch the site-type tag too in case historic is absent.
  if (tags.archaeological_site === "keill" || tags.archaeological_site === "keeil") {
    return "archaeology";
  }

  if (historic === "ruins") return "ruins";
  if (tags.building === "ruins") return "ruins";
  if (tags.ruins === "yes") return "ruins";
  if (tags["abandoned:building"]) return "ruins";
  if (historic === "building") return "ruins";
  if (tags.disused === "yes") return "ruins";

  return null;
}

function humanise(value) {
  const spaced = String(value).replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const MONUMENT_TYPE = {
  archaeological_site: "Archaeological site",
  wayside_cross: "Wayside cross",
  boundary_stone: "Boundary stone",
  city_gate: "City gate",
  castle: "Castle",
  fort: "Fort",
  monastery: "Monastery",
  tomb: "Tomb",
  dolmen: "Dolmen",
  stone_circle: "Stone circle",
  standing_stone: "Standing stone",
  round_tower: "Round tower",
  earthwork: "Earthwork",
  keill: "Keeill",
  monument: "Monument",
};

/**
 * The human `type` shown for a feature and, when it has no name, used as its
 * label. Kept deterministic from the same tags that assigned the layer.
 */
export function classify(layer, tags = {}) {
  if (layer === "mine") {
    if (tags.man_made === "mineshaft" || tags.historic === "mine_shaft") return "Mine shaft";
    if (tags.man_made === "adit") return "Mine adit";
    if (tags.historic === "lime_kiln") return "Lime kiln";
    if (tags.man_made === "kiln") return "Kiln";
    if (tags.man_made === "water_wheel") return "Water wheel";
    if (tags.man_made === "spoil_heap") return "Spoil heap";
    if (tags.historic === "quarry") return "Quarry";
    if (tags.historic === "mine_disused") return "Disused mine";
    if (tags.historic === "mine") return "Mine";
    return "Industrial heritage";
  }

  if (layer === "archaeology") {
    if (tags.historic && MONUMENT_TYPE[tags.historic]) return MONUMENT_TYPE[tags.historic];
    if (tags.archaeological_site) return humanise(tags.archaeological_site);
    return "Monument";
  }

  // ruins
  if (tags.ruins === "yes" || tags.historic === "ruins" || tags.building === "ruins") {
    return "Ruins";
  }
  if (tags["abandoned:building"]) return "Abandoned building";
  if (tags.historic === "building") return "Historic building";
  if (tags.disused === "yes" || tags.disused) return "Disused feature";
  return "Derelict feature";
}

export const SHAFT_SAFETY =
  "DANGER — mine shaft. Do NOT enter: workings can be unstable, flooded or hold bad air (low oxygen, methane, carbon dioxide), and the ground around a capped shaft can collapse. Keep clear.";
export const ADIT_SAFETY =
  "DANGER — mine adit. Do NOT enter: bad air, roof collapse and flooding are real hazards in any underground working. Keep clear of the entrance.";

/** A per-feature hazard warning, for the features that earn one. */
export function safetyWarning(tags = {}) {
  if (tags.man_made === "mineshaft" || tags.historic === "mine_shaft") return SHAFT_SAFETY;
  if (tags.man_made === "adit") return ADIT_SAFETY;
  return undefined;
}

/**
 * Drop within-layer duplicates: two features at the same coordinate with the
 * same type. This catches a node and a way for the same feature when their
 * centres coincide exactly; differing centres (the usual node-outside-building
 * case) are left alone rather than merged on a guess. Prefers a named copy.
 */
export function dedupeByPoint(features) {
  const byKey = new Map();
  let dropped = 0;
  for (const f of features) {
    const [lon, lat] = f.geometry.coordinates;
    const key = `${f.properties.type}|${Number(lon).toFixed(5)},${Number(lat).toFixed(5)}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, f);
      continue;
    }
    dropped += 1;
    if (!existing.properties.name && f.properties.name) byKey.set(key, f);
  }
  return { features: [...byKey.values()], dropped };
}
