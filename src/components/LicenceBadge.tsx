/**
 * Licence badge.
 *
 * One place decides what colour a licence is: green for the open licences this
 * project deliberately restricts itself to, red for anything ambiguous. The
 * transparency panel, the feature popup and the layer detail drawer all render
 * the same badge so a reader never sees the same licence described two ways.
 */

const LICENCE_CLASS: Record<string, string> = {
  "OGL-IoM": "bg-ok/10 text-ok",
  "OGL-IoM-DERIVED": "bg-ok/10 text-ok",
  ODbL: "bg-ok/10 text-ok",
  "CC-BY-4.0": "bg-ok/10 text-ok",
  "PUBLIC-DOMAIN": "bg-ok/10 text-ok",
  "CC0-1.0": "bg-ok/10 text-ok",
  "PD-OURAIRPORTS": "bg-ok/10 text-ok",
  COPERNICUS: "bg-ok/10 text-ok",
  "NO-LICENCE": "bg-danger/10 text-danger",
  UNKNOWN: "bg-danger/10 text-danger",
};

export function LicenceBadge({ id }: { id: string }) {
  return (
    <span className={`chip font-mono ${LICENCE_CLASS[id] ?? "bg-danger/10 text-danger"}`}>
      {id}
    </span>
  );
}
