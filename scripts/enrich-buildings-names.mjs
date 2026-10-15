/**
 * Fill in a few missing building names by cross-referencing the local datasets
 * we already license and ship (Overture places + OSM house numbers). Called
 * after `ingest:buildings`; does NOT contact any network.
 *
 *   node --experimental-strip-types --no-warnings scripts/enrich-buildings-names.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "public", "data");
const BUILDINGS = path.join(DATA, "buildings.geojson");

function readFC(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}
function centre(geom) {
  let c = geom?.coordinates;
  let depth = 0;
  while (Array.isArray(c) && depth < 6) {
    if (typeof c[0] === "number" && typeof c[1] === "number") return [c[0], c[1]];
    c = c[0]; depth++;
  }
  return null;
}
function km(a, b) { const R=6371;const dLat=(b[1]-a[1])*Math.PI/180;const dLon=(b[0]-a[0])*Math.PI/180;const x=Math.sin(dLat/2)**2+Math.cos(a[1]*Math.PI/180)*Math.cos(b[1]*Math.PI/180)*Math.sin(dLon/2)**2; return 2*R*Math.asin(Math.sqrt(x)); }

const buildings = readFC(BUILDINGS);
const places = readFC(path.join(DATA, "overture-places.geojson"));
const numbers = readFC(path.join(DATA, "house-numbers.geojson"));

const placePts = [];
for (const f of places?.features ?? []) {
  const c = centre(f.geometry); if (!f.properties?.name || !c) continue;
  placePts.push({lon:c[0],lat:c[1],p:f.properties});
}
const numberPts = [];
for (const f of numbers?.features ?? []) {
  const c = centre(f.geometry); if (!c) continue;
  numberPts.push({lon:c[0],lat:c[1],p:f.properties});
}

let nameHits=0, addrHits=0;
for (const b of buildings.features) {
  const c = centre(b.geometry);
  if (!c) continue;
  if (!b.properties?.name) {
    // Overture public/commercial names within 15 m.
    let best=null; let bestKm=0.015;
    for (const q of placePts) {
      const d=km(c, [q.lon,q.lat]); if (d < bestKm) { bestKm=d; best=q; }
    }
    if (best) { b.properties.name = best.p.name; nameHits++; }
  }
  if (!b.properties?.housename && !b.properties?.housenumber) {
    let best=null; let bestKm=0.015;
    for (const q of numberPts) {
      const d=km(c, [q.lon,q.lat]); if (d < bestKm) { bestKm=d; best=q; }
    }
    if (best) {
      const p=best.p;
      if (p.housename) b.properties.housename = p.housename;
      if (p.housenumber) b.properties.housenumber = p.housenumber;
      if (p.street) b.properties.street = p.street;
      if (p.postcode) b.properties.postcode = p.postcode;
      if (p.city) b.properties.city = p.city;
      addrHits++;
    }
  }
}

fs.writeFileSync(BUILDINGS, JSON.stringify(buildings, null, 0) + "\n");
console.log(`enrich-buildings-names: named ${nameHits}, addressed ${addrHits} of ${buildings.features.length}`);
