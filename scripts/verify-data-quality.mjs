import fs from "node:fs";
import path from "node:path";
import { pairwiseSharedCounts } from "./lib/data-quality.mjs";

const DATA = path.join(process.cwd(), "public", "data");
const files = fs
  .readdirSync(DATA)
  .filter((f) => f.endsWith(".geojson"))
  .sort();

const byFile = {};
for (const file of files) {
  const json = JSON.parse(fs.readFileSync(path.join(DATA, file), "utf8"));
  byFile[file] = Array.isArray(json.features) ? json.features : [];
}

const rows = pairwiseSharedCounts(byFile);
console.log("OpenMannin data-quality overlap report (diagnostic)");
console.log(`  layers checked  ${files.length}`);
console.log(`  overlapping pairs ${rows.length}`);
if (rows.length === 0) {
  console.log("  OK: no exact identity or payload overlaps");
  process.exit(0);
}

for (const row of rows.slice(0, 25)) {
  console.log(`  ${row.shared.toString().padStart(6, " ")}  ${row.a}  ${row.b}`);
}
if (rows.length > 25) {
  console.log(`  ... ${rows.length - 25} more rows omitted`);
}
console.log("Report only: non-zero rows are not hard failures.");
process.exit(0);
