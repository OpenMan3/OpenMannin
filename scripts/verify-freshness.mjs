import fs from "node:fs";
import path from "node:path";
import { SOURCES } from "../src/lib/sources.ts";

const ROOT = process.cwd();
const DATA = path.join(ROOT, "public", "data");
const SOURCE_MAX_AGE_DAYS = 45;
const DATA_MAX_AGE_DAYS = 120;
const TODAY = new Date();

function dayAge(isoLike) {
  const ms = Date.parse(isoLike);
  if (!Number.isFinite(ms)) return null;
  return Math.floor((TODAY.getTime() - ms) / (24 * 60 * 60 * 1000));
}

const sourceWarnings = [];
for (const [id, source] of Object.entries(SOURCES)) {
  const age = dayAge(source.lastChecked);
  if (age === null || age > SOURCE_MAX_AGE_DAYS) {
    sourceWarnings.push({ id, lastChecked: source.lastChecked ?? null, age });
  }
}

const dataWarnings = [];
for (const file of fs.readdirSync(DATA).filter((f) => f.endsWith(".geojson")).sort()) {
  try {
    const json = JSON.parse(fs.readFileSync(path.join(DATA, file), "utf8"));
    const generated = json?.properties?.generated;
    const age = dayAge(generated);
    if (age === null || age > DATA_MAX_AGE_DAYS) {
      dataWarnings.push({ file, generated: generated ?? null, age });
    }
  } catch {
    dataWarnings.push({ file, generated: null, age: null });
  }
}

console.log("OpenMannin freshness report");
console.log(`  source age limit  ${SOURCE_MAX_AGE_DAYS} days`);
console.log(`  data age limit    ${DATA_MAX_AGE_DAYS} days`);
console.log(`  stale sources     ${sourceWarnings.length}`);
console.log(`  stale data files  ${dataWarnings.length}`);
if (sourceWarnings.length || dataWarnings.length) {
  console.log("Aged entries (warning only):");
  for (const row of sourceWarnings) {
    console.log(`  source ${row.id} lastChecked=${row.lastChecked ?? "MISSING"} age=${row.age ?? "INVALID"}`);
  }
  for (const row of dataWarnings) {
    console.log(`  data   ${row.file} generated=${row.generated ?? "MISSING"} age=${row.age ?? "INVALID"}`);
  }
}

process.exit(0);
