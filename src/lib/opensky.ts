/**
 * OpenSky state-vector parsing, as a pure function.
 *
 * WHY THIS IS A SEPARATE MODULE. OpenSky returns state vectors as POSITIONAL
 * ARRAYS whose length varies with the fields that are actually populated. The
 * documented array is 18 fields, but the anonymous tier in practice returns 17
 * with `category` missing entirely, and other fields drop out when a value is
 * unavailable. Indexing such an array blindly yields `undefined` where a number
 * is expected, which becomes `NaN` when serialised to JSON - and `NaN`
 * coordinates reach MapLibre as a marker at 0,0, off the coast of Africa,
 * silently. That failure has no symptom except a dot in the wrong ocean.
 *
 * So the parsing is separated out and unit-tested rather than exercised only
 * through a live HTTP call that needs credentials nobody has yet. The tests
 * include a real captured anonymous-tier response, because the whole risk lives
 * in the array being shorter than documented.
 *
 * Index reference (OpenSky /states/all):
 *   0 icao24          5 lon            10 track (deg)     15 velocity (m/s)
 *   1 callsign        6 lat            11 vertical rate  16 position source
 *   2 origin country  7 baro altitude  12 squawk         17 category
 *   3 time position   8 on ground      13 geo altitude   18 spi
 *   4 last contact    9 ground speed
 */

/** ADS-B / Mode-S / FLARM position source, by OpenSky index 16. */
export const POSITION_SOURCE: Record<number, string> = {
  0: "ADS-B",
  1: "ASTERIX",
  2: "MLAT",
  3: "FLARM",
};

/**
 * Numeric-or-null. The single most important helper in the OpenSky parsing.
 *
 * Anything that is not a finite number - `undefined` from a short array, `null`
 * for an absent field, `NaN`, a string - becomes `null`. Never `NaN`, and never
 * a coercion of some other type into a plausible-looking number.
 */
export function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Metres per second to knots, the unit the UI shows. */
function msToKn(v: number | null): number | null {
  return v === null ? null : Number((v * 1.94384).toFixed(1));
}

export interface AircraftFeature {
  type: "Feature";
  id: string;
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: Record<string, unknown>;
}

/**
 * One state vector -> one feature, or `null` if it has no usable position.
 *
 * Returning null rather than a placeholder point is deliberate. An aircraft
 * broadcasting a position source but no latitude and longitude is reported as
 * such by OpenSky; it has no position to draw, so it is dropped and the caller
 * can tell from `count` that it was dropped.
 */
export function toFeature(s: unknown[]): AircraftFeature | null {
  const icao24 = typeof s[0] === "string" ? s[0].trim() : null;
  const lon = num(s[5]);
  const lat = num(s[6]);

  // Without a position there is nothing to draw. Never emit 0,0.
  if (!icao24 || lon === null || lat === null) return null;

  // Category is index 17 and is routinely absent, so it goes through the same
  // guard as everything else rather than trusting the array length.
  const category = num(s[17]);
  const lastContact = num(s[4]);

  return {
    type: "Feature",
    id: `aircraft/${icao24}`,
    geometry: { type: "Point", coordinates: [lon, lat] },
    properties: {
      callsign: (typeof s[1] === "string" ? s[1].trim() : "") || icao24.toUpperCase(),
      icao24,
      originCountry: typeof s[2] === "string" ? s[2] : null,
      altitudeM: num(s[7]) ?? num(s[13]),
      baroAltitudeM: num(s[7]),
      geoAltitudeM: num(s[13]),
      onGround: s[8] === true,
      groundSpeedMs: num(s[9]),
      groundSpeedKn: msToKn(num(s[9])),
      trackDeg: num(s[10]),
      verticalRateMs: num(s[11]),
      squawk: typeof s[14] === "string" ? s[14] : null,
      positionSource: POSITION_SOURCE[num(s[16]) ?? -1] ?? null,
      /**
       * The ADS-B EMITTER category (0-20), NOT a civil/military flag. Treating
       * 1 or 14 as "military" is community folklore: most military aircraft
       * emit category 1 or 7 and would be missed by that rule.
       */
      adsbCategory: category,
      lastContact: lastContact === null ? null : new Date(lastContact * 1000).toISOString(),
      /**
       * A, because this is the aircraft's own transponder position rather than
       * an estimate or an interpolated fix.
       */
      coordGrade: "A",
      coordSource:
        "Aircraft's own ADS-B transponder, via the OpenSky Network. Self-reported and spoofable, not a surveillance authority position.",
    },
  };
}

/**
 * A whole /states/all response -> a GeoJSON FeatureCollection.
 *
 * `states` is NULL, not `[]`, when the box is empty. `?? []` here is not
 * optional politeness: without it an empty box is a TypeError, and a TypeError
 * in a route handler is a 500 rather than an empty layer.
 */
export function toFeatureCollection(body: { time?: number; states?: unknown[][] | null }) {
  const features = (body.states ?? [])
    .map((s) => (Array.isArray(s) ? toFeature(s) : null))
    .filter((f): f is AircraftFeature => f !== null);

  return {
    type: "FeatureCollection" as const,
    features,
    observedAt: body.time ? new Date(body.time * 1000).toISOString() : null,
    /** Vectors we could not draw because they carried no position. */
    dropped: (body.states ?? []).length - features.length,
  };
}