/**
 * OpenMannin core types.
 *
 * The central design constraint of this project: every feature rendered on the
 * map must be traceable to a source, a licence and a confidence grade. A layer
 * without provenance is a rumour.
 */

export type LicenceId =
  | "OGL-IoM"
  | "OGL-IoM-DERIVED"
  | "ODbL"
  | "CC-BY-4.0"
  | "CC-BY-NC-4.0"
  | "PUBLIC-DOMAIN"
  | "PD-OURAIRPORTS"
  | "COPERNICUS"
  | "OS-TM-POLICY"
  | "NO-LICENCE"
  | "UNKNOWN";

export interface Licence {
  id: LicenceId;
  name: string;
  url?: string;
  /** Commercial reuse permitted under the stated terms? */
  commercial: boolean;
  /**
   * True where the technical access is free but the *terms* do not clearly
   * grant the use we need. These layers are rendered but flagged in the UI.
   */
  requiresPermission: boolean;
  /** One-line obligation the publisher must satisfy. */
  obligation: string;
}

/**
 * Evidence grade for a given feature or layer.
 *
 * A - Primary. Operator, regulator or government publication, fetched and read.
 * B - Corroborated. Two or more independent secondary sources agree.
 * C - Single source / inferred. Plausible, unconfirmed.
 * D - Disputed or contradicted by a better source. Rendered only if requested.
 */
export type Confidence = "A" | "B" | "C" | "D";

export interface Source {
  id: string;
  name: string;
  publisher: string;
  url: string;
  licence: LicenceId;
  /** ISO date this source was last checked by hand. */
  lastChecked: string;
  notes?: string;
}

export type LayerGroup =
  | "geography"
  | "transport"
  | "trails"
  | "infrastructure"
  | "cables"
  | "energy"
  | "environment"
  | "aviation"
  | "surveillance"
  | "live"
  | "gaps";

export type LayerKind =
  /** Static GeoJSON produced by an ingest script into /public/data */
  | "geojson"
  /** Served live from an ArcGIS REST endpoint, no API key */
  | "arcgis"
  /** Polled from our own API route (which proxies the upstream) */
  | "live"
  /** A placeholder documenting a source that exists but we cannot consume */
  | "blocked";

export interface LayerDef {
  id: string;
  label: string;
  group: LayerGroup;
  kind: LayerKind;
  /** Path under /data, for kind === "geojson" */
  file?: string;
  /** ArcGIS or upstream URL, for kind === "arcgis" */
  endpoint?: string;
  /** MapLibre layer id to query on click, when it differs from `id` */
  pickLayer?: string;
  color: string;
  /** Render as a dashed line (subsea cables, approximate alignments) */
  dashed?: boolean;
  defaultOn: boolean;
  minZoom?: number;
  description: string;
  /** Anything that would mislead a reader of this layer. Rendered in the UI. */
  caveats?: string[];
  confidence: Confidence;
  sourceId: string;
  /** Feature count at ingest time, if known. */
  featureCount?: number;
}

/** A gap: something that is NOT on the map, and why. */
export interface Gap {
  id: string;
  title: string;
  wanted: string;
  whyUnavailable: string;
  whatWeWouldNeed: string;
  contact?: string;
  severity: "high" | "medium" | "low";
}

// ---------------------------------------------------------------------------
// Runtime feed shapes
// ---------------------------------------------------------------------------

export interface Aircraft {
  icao24: string;
  callsign: string;
  originCountry: string;
  lon: number;
  lat: number;
  baroAltM: number | null;
  geoAltM: number | null;
  groundSpeedMs: number | null;
  trackDeg: number | null;
  verticalRateMs: number | null;
  onGround: boolean;
  /** ADS-B emitter category. 0-20. NOT a civil/military flag. */
  category: number | null;
}

export type TransitKind = "bus" | "school-bus" | "steam-train" | "tram" | "horse-tram";

export interface TransitVehicle {
  id: string;
  lat: number;
  lon: number;
  headingDeg: number | null;
  kind: TransitKind;
  label: string;
  /** Server-reported position timestamp. */
  at: string;
  /** Raw pipe-delimited record, kept for auditing a guess at fields 1/2/7. */
  raw: string;
}

export interface Vessel {
  mmsi: string;
  lat: number;
  lon: number;
  sogKn: number | null;
  cogDeg: number | null;
  headingDeg: number | null;
  /** 0 = under way using engine, 1-3 = manoeuvring etc, 15 = undefined */
  navStatus: number | null;
  shipType: number | null;
  at: string;
}

export interface FeedStatus {
  ok: boolean;
  /** Present when ok === false. */
  error?: string;
  /** Age of the upstream data in seconds, where the publisher states it. */
  ageSeconds?: number;
  /** Set when the upstream feed is configured but not permitted for our use. */
  blockedReason?: string;
  source: string;
  fetchedAt: string;
}