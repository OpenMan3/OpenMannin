/**
 * Generate SOURCES.md from the TypeScript registers the app renders.
 *
 * The licence register, source register, per-layer feature counts and the
 * gap list all live in `src/lib/*.ts`. This script projects them into a human
 * readable Markdown catalogue, so the shipped document cannot drift from the
 * data the UI actually shows.
 *
 *   node --experimental-strip-types scripts/build-sources.mjs
 */

import { writeFileSync } from "node:fs";
import { LAYERS, GAPS } from "../src/lib/layers.ts";
import { SOURCES } from "../src/lib/sources.ts";
import { LICENCES } from "../src/lib/licences.ts";

const OUT = "SOURCES.md";

const groups = {};
for (const l of LAYERS) (groups[l.group] ??= []).push(l);

const lines = [];
lines.push("# Sources and licences");
lines.push("");
lines.push(
  "OpenMannin renders only data that can be traced to a source, a licence and a confidence grade. This register is generated from the same TypeScript registers the app renders (`src/lib/layers.ts`, `src/lib/sources.ts`, `src/lib/licences.ts`), so the file, the UI and this document cannot drift apart.",
);
lines.push("");
lines.push("## Non-open government map data is not used");
lines.push("");
lines.push(
  "This project does **not** ingest, cache, trace or derive anything from government maps or map-derived products. The IoM Open Government Licence explicitly **excludes maps and map-derived products** ([OGL](https://www.gov.im/about-this-site/open-government-licence/), [maps exclusion](https://www.gov.im/about-this-site/terms-and-conditions/maps/)), and the Isle of Man Survey base cartography is sold commercially. All island-wide vector coverage is built from independently licensed sources — principally OpenStreetMap (ODbL) and Wikidata (CC0). Coverage that could not be independently sourced is recorded as a gap rather than relicensed.",
);
lines.push("");
lines.push(`## Licence register (${Object.keys(LICENCES).length})`);
lines.push("");
lines.push("| Licence | Commercial | Permission required | Obligation |");
lines.push("| --- | --- | --- | --- |");
for (const l of Object.values(LICENCES)) {
  lines.push(
    `| ${l.name}${l.url ? ` ([link](${l.url}))` : ""} | ${l.commercial ? "yes" : "no"} | ${l.requiresPermission ? "yes" : "no"} | ${l.obligation.replace(/\|/g, "\\|")} |`,
  );
}
lines.push("");
lines.push(`## Source register (${Object.keys(SOURCES).length})`);
lines.push("");
lines.push("| Source | Publisher | Licence | Last checked |");
lines.push("| --- | --- | --- | --- |");
for (const s of Object.values(SOURCES)) {
  lines.push(`| [${s.name}](${s.url}) | ${s.publisher} | ${s.licence} | ${s.lastChecked} |`);
}
lines.push("");
lines.push("## Layers by source");
lines.push("");
for (const [g, ls] of Object.entries(groups)) {
  lines.push(`### ${g}`);
  lines.push("");
  lines.push("| Layer | Source | Licence | Grade | Features |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const l of ls) {
    const s = SOURCES[l.sourceId];
    lines.push(
      `| ${l.label} (\`${l.id}\`) | ${l.sourceId} | ${s?.licence ?? "?"} | ${l.confidence} | ${l.featureCount ?? "live/blocked"} |`,
    );
  }
  lines.push("");
}
lines.push(`## Gaps (${GAPS.length})`);
lines.push("");
lines.push("Coverage that could not be sourced under a usable licence. Rendered in the app as a first-class panel.");
lines.push("");
lines.push("| Gap | Severity | Why unavailable |");
lines.push("| --- | --- | --- |");
for (const g of GAPS) {
  lines.push(
    `| ${g.title} (\`${g.id}\`) | ${g.severity} | ${String(g.whyUnavailable).replace(/\|/g, "\\|")} |`,
  );
}
lines.push("");

writeFileSync(OUT, lines.join("\n"));
console.log(`wrote ${OUT}: ${lines.length} lines`);
