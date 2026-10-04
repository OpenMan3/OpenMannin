import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

/**
 * Deploy health check.
 *
 * Exists because the worst failure mode for this app is SILENT. The MapLibre
 * worker, the ingest output and the API routes can all be missing or broken
 * while the page still returns 200 and still paints a basemap - the worker
 * failure hid every data layer for an entire debugging session. A load
 * balancer reporting "healthy" tells you none of that.
 *
 * So this reports the things that actually matter:
 *   - the MapLibre worker is present and non-empty (no data layers without it)
 *   - the ingest produced data, and how much
 *   - which live feeds are enabled, since three of the five are gated on
 *     credentials and are EXPECTED to be off
 *
 * `ok` is deliberately only about the map being usable. A missing AIS key does
 * not make the deploy unhealthy, because the map is still correct without it -
 * it just says so out loud instead of pretending.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATA = path.join(process.cwd(), "public", "data");
const WORKER = path.join(process.cwd(), "public", "maplibre-gl-worker.mjs");

export async function GET() {
  const problems: string[] = [];
  const warnings: string[] = [];

  // 1. The worker. Without it MapLibre cannot process GeoJSON, so every data
  //    layer silently disappears while the basemap still renders.
  let workerOk = false;
  try {
    workerOk = fs.statSync(WORKER).size > 1000;
  } catch {
    problems.push("maplibre worker missing - run `npm run copy:worker`. All data layers will be invisible.");
  }

  // 2. Ingest output.
  let layers = 0;
  let features = 0;
  let absent: string[] = [];
  try {
    const m = JSON.parse(fs.readFileSync(path.join(DATA, "manifest.json"), "utf8"));
    absent = m.absent ?? [];
    for (const v of Object.values<{ features?: number }>(m.layers ?? {})) {
      if (!v || typeof v !== "object") continue;
      layers++;
      features += v.features ?? 0;
    }
    if (!layers) problems.push("manifest lists no layers - run `npm run ingest:all`.");
    if (absent.length) problems.push(`${absent.length} layer(s) have no data: ${absent.join(", ")}`);
  } catch {
    problems.push("public/data/manifest.json missing - run `npm run ingest:all`.");
  }

  // 3. Live feeds. Gated ones are a warning, never a failure.
  const live = {
    satellitePasses: true, // public domain, always available
    ais: Boolean(process.env.AISSTREAM_API_KEY),
  };
  if (!live.ais) {
    warnings.push(
      "AISSTREAM_API_KEY not set - /api/marine returns 503 by design. AISStream is graded NO-LICENCE.",
    );
  }
  if (!process.env.OPENSKY_CLIENT_ID) {
    warnings.push(
      "OPENSKY_CLIENT_ID not set - no aircraft route. OpenSky requires written agreement for operational use.",
    );
  }

  const ok = problems.length === 0;
  return NextResponse.json(
    {
      ok,
      worker: workerOk,
      layers,
      features,
      absent,
      live,
      problems,
      warnings,
    },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}