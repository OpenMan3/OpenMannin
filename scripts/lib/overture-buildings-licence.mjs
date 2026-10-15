/**
 * Overture Buildings licence classifications.
 *
 * The places ingest and the buildings ingest do NOT share a licence map. The
 * places theme is dominated by CDLA-Permissive-2.0 contributors; the buildings
 * theme over the Isle of Man is entirely ODbL-1.0 — OpenStreetMap and
 * Microsoft ML Buildings — and ODbL carries an attribution AND share-alike
 * obligation that CDLA does not. Keeping the two maps separate stops a
 * buildings contributor from being silently accepted under the places rules.
 *
 * This module answers a LICENCE question only. Both contributors are ODbL and
 * therefore licence-keep. What actually ships is a separate ACCURACY decision,
 * made in scripts/ingest-buildings.mjs: only OpenStreetMap records are kept,
 * because they carry an OSM element id and can be verified; Microsoft ML
 * roofprints cannot be checked and are dropped. Do not fold that policy in
 * here — a contributor being licence-clean is not the same as being verifiable.
 *
 * Unknown contributors/licenses are hard errors, not silent drops.
 */

export const OVERTURE_BUILDINGS_ALLOWED_LICENCE = "ODbL-1.0";

export const OVERTURE_BUILDINGS_LICENCE_MAP = Object.freeze({
  "OpenStreetMap::ODbL-1.0": "keep",
  "Microsoft ML Buildings::ODbL-1.0": "keep",
});

export class OvertureBuildingsLicenceError extends Error {
  constructor(message) {
    super(message);
    this.name = "OvertureBuildingsLicenceError";
  }
}

function values(recordOrDataset, explicitLicence) {
  if (typeof recordOrDataset === "string") {
    return { dataset: recordOrDataset, licence: explicitLicence ?? null };
  }
  if (recordOrDataset && typeof recordOrDataset === "object") {
    const r = recordOrDataset;
    return {
      dataset: r.sourceDataset ?? r.dataset ?? r.source ?? null,
      licence: r.sourceLicense ?? r.sourceLicence ?? r.licence ?? r.license ?? explicitLicence ?? null,
    };
  }
  return { dataset: null, licence: null };
}

export function classifyBuildingRecord(recordOrDataset, explicitLicence) {
  const { dataset, licence } = values(recordOrDataset, explicitLicence);
  const ds = dataset == null ? "" : String(dataset).trim();
  const lc = licence == null ? "" : String(licence).trim();

  if (ds === "") {
    const message = "building record is missing a contributor dataset";
    return { status: "error", action: "error", keep: false, reason: "missing-dataset", error: message, message, dataset: ds, licence: lc };
  }
  if (lc === "") {
    const message = `building contributor ${ds} declared no licence`;
    return { status: "error", action: "error", keep: false, reason: "missing-licence", error: message, message, dataset: ds, licence: lc };
  }
  const key = `${ds}::${lc}`;
  const mapped = OVERTURE_BUILDINGS_LICENCE_MAP[key];
  if (mapped === undefined) {
    const message = `unknown Overture buildings contributor/licence pair: ${key}`;
    return { status: "error", action: "error", keep: false, reason: "unknown-contributor", error: message, message, dataset: ds, licence: lc };
  }
  if (mapped === "keep") {
    if (lc !== OVERTURE_BUILDINGS_ALLOWED_LICENCE) {
      const message = `mapped buildings contributor ${ds} is marked keep but not ${OVERTURE_BUILDINGS_ALLOWED_LICENCE}: ${lc}`;
      return { status: "error", action: "error", keep: false, reason: "unknown-contributor", error: message, message, dataset: ds, licence: lc };
    }
    return { status: "keep", action: "keep", keep: true, reason: "allowed-licence", error: null, message: null, dataset: ds, licence: lc };
  }
  return { status: "exclude", action: "exclude", keep: false, reason: "excluded-licence", error: null, message: `excluded Overture buildings contributor: ${key}`, dataset: ds, licence: lc };
}

export function summariseBuildingRecords(rows) {
  const out = { total: 0, kept: 0, excluded: 0, errors: [], excludedCounts: new Map(), contributors: new Set() };
  for (const row of rows ?? []) {
    out.total += 1;
    const decision = classifyBuildingRecord(row);
    if (decision.action === "error") out.errors.push(decision.message);
    else if (decision.action === "keep") {
      out.kept += 1;
      out.contributors.add(decision.dataset);
    } else {
      out.excluded += 1;
      const key = `${decision.dataset}::${decision.licence}`;
      out.excludedCounts.set(key, (out.excludedCounts.get(key) ?? 0) + 1);
    }
  }
  if (out.errors.length > 0) throw new OvertureBuildingsLicenceError(out.errors.join("\n"));
  return out;
}
