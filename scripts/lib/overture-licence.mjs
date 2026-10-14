/**
 * Overture licence classifications.
 */

export const OVERTURE_ALLOWED_LICENCE = "CDLA-Permissive-2.0";

export const OVERTURE_LICENCE_MAP = Object.freeze({
  "meta::CDLA-Permissive-2.0": "keep",
  "Microsoft::CDLA-Permissive-2.0": "keep",
  "PinMeTo::CDLA-Permissive-2.0": "keep",
  "DAC::CDLA-Permissive-2.0": "keep",
  "AllThePlaces::CC0-1.0": "exclude",
  "Foursquare::Apache-2.0": "exclude",
});

export class OvertureLicenceError extends Error {
  constructor(message) {
    super(message);
    this.name = "OvertureLicenceError";
  }
}

function values(recordOrDataset, explicitLicence) {
  if (typeof recordOrDataset === "string") {
    return { dataset: recordOrDataset, licence: explicitLicence ?? null };
  }
  if (recordOrDataset && typeof recordOrDataset === "object") {
    const r = recordOrDataset;
    return {
      dataset:
        r.sourceDataset ??
        r.dataset ??
        r.sourceDatasetName ??
        r.contributorDataset ??
        r.source ??
        null,
      licence:
        r.sourceLicense ??
        r.sourceLicence ??
        r.licence ??
        r.license ??
        r.originLicence ??
        r.originLicense ??
        explicitLicence ??
        null,
    };
  }
  return { dataset: null, licence: null };
}

export function classifyOvertureRecord(recordOrDataset, explicitLicence) {
  const { dataset, licence } = values(recordOrDataset, explicitLicence);
  const ds = dataset == null ? "" : String(dataset).trim();
  const lc = licence == null ? "" : String(licence).trim();

  if (ds === "") {
    const message = "record is missing a contributor dataset";
    return {
      status: "error",
      action: "error",
      keep: false,
      reason: "missing-dataset",
      error: message,
      message,
      dataset: ds,
      licence: lc,
    };
  }
  if (lc === "") {
    const message = `contributor ${ds} declared no licence`;
    return {
      status: "error",
      action: "error",
      keep: false,
      reason: "missing-licence",
      error: message,
      message,
      dataset: ds,
      licence: lc,
    };
  }
  const key = `${ds}::${lc}`;
  const mapped = OVERTURE_LICENCE_MAP[key];
  if (mapped === undefined) {
    const message = `unknown Overture contributor/licence pair: ${key}`;
    return {
      status: "error",
      action: "error",
      keep: false,
      reason: "unknown-contributor",
      error: message,
      message,
      dataset: ds,
      licence: lc,
    };
  }
  if (mapped === "keep") {
    if (lc !== OVERTURE_ALLOWED_LICENCE) {
      const message = `mapped Overture contributor ${ds} is marked keep but not CDLA-Permissive-2.0: ${lc}`;
      return {
        status: "error",
        action: "error",
        keep: false,
        reason: "unknown-contributor",
        error: message,
        message,
        dataset: ds,
        licence: lc,
      };
    }
    return {
      status: "keep",
      action: "keep",
      keep: true,
      reason: "allowed-licence",
      error: null,
      message: null,
      dataset: ds,
      licence: lc,
    };
  }
  return {
    status: "exclude",
    action: "exclude",
    keep: false,
    reason: "excluded-licence",
    error: null,
    message: `excluded Overture contributor: ${key}`,
    dataset: ds,
    licence: lc,
  };
}

export function summariseOvertureRecords(rows) {
  const out = {
    total: 0,
    kept: 0,
    excluded: 0,
    errors: [],
    excludedCounts: new Map(),
    contributors: new Set(),
  };
  for (const row of rows ?? []) {
    out.total += 1;
    const decision = classifyOvertureRecord(row);
    if (decision.action === "error") {
      out.errors.push(decision.message);
    } else if (decision.action === "keep") {
      out.kept += 1;
      out.contributors.add(decision.dataset);
    } else {
      out.excluded += 1;
      const key = `${decision.dataset}::${decision.licence}`;
      out.excludedCounts.set(key, (out.excludedCounts.get(key) ?? 0) + 1);
    }
  }
  if (out.errors.length > 0) {
    throw new OvertureLicenceError(out.errors.join("\n"));
  }
  return out;
}

export function summarizeOvertureRecords(rows) {
  return summariseOvertureRecords(rows);
}

export const classifyOvertureContributor = classifyOvertureRecord;
export const classifyOvertureLicense = classifyOvertureRecord;
export const classifyOvertureLicence = classifyOvertureRecord;
export const decideOvertureLicense = classifyOvertureRecord;
export const decideOvertureLicence = classifyOvertureRecord;
export const overtureLicenseDecision = classifyOvertureRecord;
export const overtureLicenceDecision = classifyOvertureRecord;
export const inspectOvertureRecord = classifyOvertureRecord;
export const recordDecision = classifyOvertureRecord;
export default classifyOvertureRecord;
