/**
 * Rendering helpers for a feature's attributes.
 *
 * Shared by the map popup (FeaturePopup) and the Browse detail card so a
 * feature reads identically in both. The Browse card previously had its own
 * hardcoded field list that had drifted from the data, so most layers showed
 * a bare title and nothing else; both now render whatever the feature carries.
 */

/** Attribute keys that are plumbing rather than content. */
export const HIDDEN_KEYS = new Set([
  "id",
  "dataset",
  "kind",
  "source",
  "page",
  "note",
  "coordSource",
]);

/** Hard cap on a formatted value, so one huge nested property cannot fill a card. */
export const MAX_VALUE_CHARS = 400;

export function humanise(key: string): string {
  const spaced = key.replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function truncate(s: string): string {
  return s.length > MAX_VALUE_CHARS ? `${s.slice(0, MAX_VALUE_CHARS)}…` : s;
}

/**
 * Render a property value as readable text.
 *
 * `String(v)` is correct for strings, numbers and booleans and wrong for
 * everything else: an array of objects came out as "[object Object],…".
 * Arrays of primitives join with ", "; objects flatten to "key: value" pairs,
 * recursively, then truncate.
 */
export function formatValue(v: unknown, depth = 0): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (depth > 3) return "[…]";

  if (Array.isArray(v)) {
    if (v.length === 0) return "(empty list)";
    const parts = v.map((item) => formatValue(item, depth + 1)).filter((s) => s !== "");
    return truncate(parts.join(", "));
  }

  if (typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>).filter(
      ([, val]) => val !== null && val !== undefined && val !== "",
    );
    if (entries.length === 0) return "(no values)";
    return truncate(
      entries.map(([k, val]) => `${k}: ${formatValue(val, depth + 1)}`).join(", "),
    );
  }

  return String(v);
}
