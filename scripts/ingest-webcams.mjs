/**
 * Isle of Man government webcams.
 *
 * The image URLs below were read off the live pages at
 * https://www.gov.im/webcams/ on 2026-10-04, not guessed. This matters: an
 * earlier draft assumed tidy filenames like /webcams/north.jpg, and every one
 * of those was wrong. The real paths are per-camera and inconsistent
 * (bungalow3.jpg, ed_tower.jpg, Ramsey_00001.jpg, PortErin.jpg), and the
 * listing page only exposes /webcams/thumbnails/Desktop/<name>.jpg, so the
 * full-size URL has to come from each camera's own detail page.
 *
 * This script deliberately does NOT fetch the images.
 *
 * images.gov.im sits behind an AWS WAF that answers non-browser clients with a
 * 269-byte text/html proof-of-work challenge and HTTP 200. A naive fetch would
 * "succeed", cache the challenge page, and look like it had verified ten live
 * cameras. Real browsers get the JPEG, so the URLs are correct; we just cannot
 * validate them from a script, and we should not pretend otherwise.
 *
 * Coordinates are graded honestly:
 *   B - matched to an OpenStreetMap feature of the expected type
 *       (marina, pier, breakwater, bay), read from Overpass on 2026-10-04
 *   C - approximate landmark position. The publisher does not publish
 *       coordinates for these cameras.
 *
 * No attempt is made to geolocate cameras from their imagery.
 */

import { writeJSON } from "./lib/fetch.mjs";

const OUT = "public/data/webcams.geojson";
const LISTING = "https://www.gov.im/webcams/";

/**
 * slug        path segment on gov.im/webcams/, used to build the source page
 * image       full-size JPEG, verified against the detail page
 * grade       coordinate confidence
 * source      how the coordinate was obtained
 */
const CAMERAS = [
  {
    slug: "bungalow-a18-north",
    name: "The Bungalow — A18 north",
    image: "https://images.gov.im/webcams/bungalow3.jpg",
    lon: -4.458,
    lat: 54.2577,
    grade: "C",
    coordSource: "Approximate: A18 summit area at the Bungalow.",
    note: "1920x1080 infrared. Northward view over the Snaefell summit road.",
  },
  {
    slug: "bungalow-a18-south",
    name: "The Bungalow — A18 south",
    image: "https://images.gov.im/webcams/bungalow1.jpg",
    lon: -4.458,
    lat: 54.2577,
    grade: "C",
    coordSource: "Approximate: A18 summit area at the Bungalow.",
    note: "1920x1080 infrared. Southward view down the mountain.",
  },
  {
    slug: "bungalow-laxey-valley",
    name: "The Bungalow — Laxey valley",
    image: "https://images.gov.im/webcams/bungalow2.jpg",
    lon: -4.458,
    lat: 54.2577,
    grade: "C",
    coordSource: "Approximate: A18 summit area at the Bungalow.",
    note: "1920x1080 infrared. Looking down the Laxey valley.",
  },
  {
    slug: "castletown-bay",
    name: "Castletown Bay",
    image: "https://images.gov.im/webcams/Castletown_Bay.jpg",
    lon: -4.64079,
    lat: 54.06703,
    grade: "B",
    coordSource: "OSM natural=bay 'Castletown Bay'.",
    note: "",
  },
  {
    slug: "douglas-marina",
    name: "Douglas Marina",
    image: "https://images.gov.im/webcams/douglas_00001.jpg",
    lon: -4.48041,
    lat: 54.14735,
    grade: "B",
    coordSource: "OSM leisure=marina 'Douglas Marina'.",
    note: "",
  },
  {
    slug: "douglas-outer-harbour",
    name: "Douglas Outer Harbour (King Edward VIII Pier)",
    image: "https://images.gov.im/webcams/ed_tower.jpg",
    lon: -4.47225,
    lat: 54.14675,
    grade: "B",
    coordSource: "OSM man_made=pier 'King Edward VIII Pier'.",
    note: "File is named ed_tower.jpg after the pier's tower.",
  },
  {
    slug: "douglas-promenade",
    name: "Douglas Promenade",
    image: "https://images.gov.im/webcams/DTL_00001.jpg",
    lon: -4.46813,
    lat: 54.16432,
    grade: "C",
    coordSource:
      "Approximate: Nominatim resolved this query to a tram node on the promenade, not the promenade itself.",
    note: "",
  },
  {
    slug: "peel-breakwater",
    name: "Peel Breakwater",
    image: "https://images.gov.im/webcams/peel_00001.jpg",
    lon: -4.69622,
    lat: 54.22768,
    grade: "B",
    coordSource: "OSM man_made=breakwater at Peel (unnamed in OSM).",
    note: "",
  },
  {
    slug: "port-erin-bay",
    name: "Port Erin Bay",
    image: "https://images.gov.im/webcams/PortErin.jpg",
    lon: -4.7185,
    lat: 54.0846,
    grade: "C",
    coordSource: "Approximate: Port Erin harbour and bay.",
    note: "",
  },
  {
    slug: "ramsey",
    name: "Ramsey Harbour",
    image: "https://images.gov.im/webcams/Ramsey_00001.jpg",
    lon: -4.3815,
    lat: 54.3215,
    grade: "C",
    coordSource: "Approximate: Ramsey harbour, north-east town.",
    note: "",
  },
];

const CAVEATS = [
  "SNAPSHOT JPEG ONLY. No MJPEG, HLS or RTSP stream is published. You get a still image, not video.",
  "NO COORDINATES ARE PUBLISHED by the government. Four pins are matched to same-typed OSM features (grade B); six are approximate landmark positions (grade C) and may be tens of metres out.",
  "images.gov.im answers non-browser clients with an AWS WAF proof-of-work challenge and HTTP 200, so the URLs could not be machine-verified. They were read from each camera's gov.im detail page. In a real browser they return JPEG.",
  "No CORS headers, so <img> works but canvas pixel readback is blocked. Cache-Control is no-cache, so cache-bust yourself.",
  "Hotlinking works and there is no referrer check, but the OGL covers the TEXT. There is no published grant for third-party reuse of the IMAGES specifically. Email harbours@gov.im before shipping.",
  "Cameras are published for public interest in traffic and conditions. Do not attempt to geolocate private premises from them.",
];

function main() {
  const features = CAMERAS.map((cam, i) => ({
    type: "Feature",
    id: cam.slug,
    geometry: {
      type: "Point",
      coordinates: [Number(cam.lon.toFixed(5)), Number(cam.lat.toFixed(5))],
    },
    properties: {
      id: cam.slug,
      name: cam.name,
      image: cam.image,
      page: `${LISTING}${cam.slug}/`,
      coordGrade: cam.grade,
      coordSource: cam.coordSource,
      note: cam.note,
      kind: "snapshot-jpeg",
    },
  }));

  const fc = {
    type: "FeatureCollection",
    name: "webcams",
    properties: {
      generated: new Date().toISOString(),
      source: "https://www.gov.im/webcams/",
      sourceVerified: "2026-10-04",
      licence: "OGL-IoM",
      caveats: CAVEATS,
      imagesNotMachineVerified:
        "AWS WAF returns an HTTP 200 HTML challenge to non-browser clients; these scripts cannot confirm the JPEGs resolve.",
    },
    features,
  };

  const bytes = writeJSON(OUT, fc, { pretty: true });
  const graded = CAMERAS.filter((c) => c.grade === "B").length;
  console.log(`  webcams.geojson  ${features.length} cameras, ${graded} grade-B coords, ${(bytes / 1024).toFixed(1)} KB`);
  for (const c of CAMERAS) console.log(`    [${c.grade}] ${c.name}`);
}

main();