import { NextResponse } from "next/server";

/**
 * Live AIS vessel positions around the Isle of Man, via AISStream.
 *
 * WHY A SERVER PROXY AND NOT A BROWSER SOCKET. AISStream explicitly prohibits
 * direct browser connections, and caps you at 3 connections per account *and* 3
 * per originating IP. That cap is the reason for this file's whole shape: one
 * upstream socket held here, fanned out internally to every connected viewer.
 * A browser-per-socket design would both breach their terms and exhaust the cap
 * after three visitors.
 *
 * LICENCE STATUS - READ THIS BEFORE ENABLING. AISStream is graded NO-LICENCE in
 * src/lib/sources.ts. It publishes no terms document, no SLA and no replay
 * policy, so there is nothing granting commercial or operational use. Absence
 * of a prohibition is not a grant. The route therefore refuses to run unless
 * AISSTREAM_API_KEY is set, which is the deliberate act of saying "I have
 * permission". Do not set it to make the warning go away.
 *
 * Position accuracy: AIS is self-reported and routinely wrong by a few hundred
 * metres. It is a clue, not a chart. A 3.5 m cargo ship's GPS antenna is often
 * in the bow, and the reported position is whatever the crew's equipment says.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Bounding box around the island: south, west, north, east. */
const BBOX = "54.02,-4.85,54.45,-4.30";

const AISSTREAM = "wss://stream.aisstream.io/v0/stream";
/** aisstream requires permessage-deflate; uncompressed connections are capped. */
const WS_SUBPROTOCOL = "aisstream.com.bin.raw";

/** How long a client may wait for a fresh upstream frame before giving up. */
const FRESH_MS = 30_000;

type Position = {
  lon: number;
  lat: number;
  sog?: number;
  cog?: number;
  name?: string;
  mmsi?: string;
  type?: string;
};

let upstream: WebSocket | null = null;
let latest: Position[] = [];
let lastFrame = 0;
let connecting: Promise<void> | null = null;

const VESSEL_TYPES: Record<number, string> = {
  20: "Wing in ground",
  30: "Fishing",
  31: "Tug",
  33: "Dredger",
  34: "Dive vessel",
  35: "Naval",
  36: "Sailing",
  37: "Pleasure craft",
  40: "High speed craft",
  50: "Pilot",
  51: "Search and rescue",
  52: "Tug",
  53: "Port tender",
  55: "Law enforcement",
  58: "Medical",
  60: "Passenger",
  70: "Cargo",
  80: "Tanker",
};

/** Pull the useful numbers out of an AIS PositionReport. */
function decode(msg: any): Position | null {
  const p = msg?.PositionReport ?? msg?.PositionReportClassA ?? msg?.PositionReportClassB;
  if (!p) return null;
  const lon = Number(p.Longitude);
  const lat = Number(p.Latitude);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;

  const meta = msg?.MetaData ?? {};
  const type = VESSEL_TYPES[Number(p.Type)] ?? null;
  const name: string | undefined =
    meta.ShipName || meta.Name || meta.vesselName?.value || undefined;

  return {
    lon,
    lat,
    sog: Number.isFinite(Number(p.SpeedOverGround)) ? Number(p.SpeedOverGround) : undefined,
    cog: Number.isFinite(Number(p.CourseOverGround)) ? Number(p.CourseOverGround) : undefined,
    name: name?.trim() || undefined,
    mmsi: meta.UserID || meta.MMSI || undefined,
    type: type ?? undefined,
  };
}

function handleFrame(raw: string) {
  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    return;
  }
  const positions: Position[] = [];
  for (const m of payload?.Message?.PositionReport ? [payload.Message] : []) {
    const d = decode(m);
    if (d) positions.push(d);
  }
  // Their envelope can also batch under different keys depending on the
  // subscription; keep anything position-shaped we can read.
  if (!positions.length && Array.isArray(payload?.Message)) {
    for (const m of payload.Message) {
      const d = decode(m);
      if (d) positions.push(d);
    }
  }
  if (!positions.length) return;

  latest = positions;
  lastFrame = Date.now();
}

async function ensureUpstream(key: string) {
  if (upstream && upstream.readyState <= 1) return;
  if (connecting) return connecting;

  connecting = new Promise<void>((resolve, reject) => {
    const url =
      `${AISSTREAM}?api_key=${encodeURIComponent(key)}` +
      `&format=json&BoundingBox=${BBOX}`;
    const ws = new WebSocket(url, [WS_SUBPROTOCOL]);

    const fail = (e: Error) => {
      try { ws.close(); } catch {}
      upstream = null;
      connecting = null;
      reject(e);
    };

    ws.onopen = () => {
      upstream = ws;
      connecting = null;
      resolve();
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") handleFrame(ev.data);
      else if (ev.data instanceof ArrayBuffer) handleFrame(new TextDecoder().decode(ev.data));
    };
    ws.onerror = () => fail(new Error("aisstream upstream socket error"));
    ws.onclose = () => {
      upstream = null;
      connecting = null;
    };
  });

  return connecting;
}

export async function GET() {
  const key = process.env.AISSTREAM_API_KEY;
  if (!key) {
    return NextResponse.json(
      {
        error: "not-enabled",
        reason:
          "AISSTREAM_API_KEY is not set. AISStream is graded NO-LICENCE and publishes no terms document, so this route refuses to run until you have permission and set the key.",
        source: "aisstream",
        licence: "NO-LICENCE",
      },
      { status: 503 },
    );
  }

  try {
    await ensureUpstream(key);
  } catch (e) {
    return NextResponse.json(
      { error: "upstream-unavailable", reason: (e as Error).message, source: "aisstream" },
      { status: 502 },
    );
  }

  const stale = Date.now() - lastFrame > FRESH_MS;
  const fc = {
    type: "FeatureCollection",
    properties: {
      source: "aisstream",
      licence: "NO-LICENCE",
      generated: new Date().toISOString(),
      count: latest.length,
      stale,
      caveat:
        "AIS is self-reported and routinely wrong by a few hundred metres. A clue, not a chart.",
    },
    features: latest.map((p) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.lon, p.lat] },
      properties: {
        name: p.name ?? null,
        mmsi: p.mmsi ?? null,
        vesselType: p.type ?? null,
        sog: p.sog ?? null,
        cog: p.cog ?? null,
        coordGrade: "C",
        coordSource: "Self-reported on-board AIS transponder, via AISStream.",
      },
    })),
  };

  return NextResponse.json(fc, {
    headers: { "Cache-Control": "no-store" },
  });
}