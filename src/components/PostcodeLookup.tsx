"use client";

/**
 * Postcode lookup with prefix autosuggest and nearby feature listing.
 *
 * Loads a compact postcode index (code + centroid) for instant client-side
 * prefix matching. On selection, flies the map to the postcode centroid and
 * lists nearby bus stops (with their services) from the bus-stops layer.
 *
 * The index is ~50 KB of JSON — small enough to ship statically and search
 * without a network round trip.
 */

import { useEffect, useMemo, useRef, useState } from "react";

interface PostcodeEntry {
  code: string;
  lon: number;
  lat: number;
  count: number;
}

interface BusStop {
  label: string;
  lon: number;
  lat: number;
  services: string[] | null;
  stopNo: string | null;
  naptan: string | null;
}

/** Haversine metres between two lon/lat points. */
function metres([lon1, lat1]: [number, number], [lon2, lat2]: [number, number]) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const MAX_SUGGESTIONS = 12;
const NEARBY_RADIUS_M = 400;
const MAX_NEARBY = 20;

export function PostcodeLookup({
  onLocate,
}: {
  onLocate: (lon: number, lat: number) => void;
}) {
  const [index, setIndex] = useState<PostcodeEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<PostcodeEntry | null>(null);
  const [nearby, setNearby] = useState<BusStop[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/data/postcodes-index.json");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as PostcodeEntry[];
        if (!cancelled) setIndex(json);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "failed to load index");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const suggestions = useMemo(() => {
    if (!index || !query.trim()) return [];
    const q = query.trim().toUpperCase();
    return index.filter((e) => e.code.startsWith(q)).slice(0, MAX_SUGGESTIONS);
  }, [index, query]);

  const select = (entry: PostcodeEntry) => {
    setSelected(entry);
    setQuery(entry.code);
    setShowSuggestions(false);
    onLocate(entry.lon, entry.lat);
    // Load nearby bus stops
    void loadNearby(entry);
  };

  const loadNearby = async (entry: PostcodeEntry) => {
    try {
      const res = await fetch("/data/bus-stops.geojson");
      if (!res.ok) return;
      const fc = await res.json();
      const stops: BusStop[] = [];
      for (const f of fc.features ?? []) {
        const c = f.geometry?.coordinates;
        if (!c) continue;
        const d = metres([entry.lon, entry.lat], c);
        if (d <= NEARBY_RADIUS_M) {
          const p = f.properties ?? {};
          stops.push({
            label: p.label ?? "Unnamed stop",
            lon: c[0],
            lat: c[1],
            services: p.services ?? null,
            stopNo: p.stopNo ?? null,
            naptan: p.naptan ?? null,
          });
        }
      }
      stops.sort(
        (a, b) =>
          metres([entry.lon, entry.lat], [a.lon, a.lat]) -
          metres([entry.lon, entry.lat], [b.lon, b.lat]),
      );
      setNearby(stops.slice(0, MAX_NEARBY));
    } catch {
      setNearby([]);
    }
  };

  if (error) {
    return <p className="p-3 text-xs text-[#f87171]">Could not load postcode index: {error}</p>;
  }

  return (
    <div className="space-y-3 p-3">
      <div className="relative">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowSuggestions(true);
            setSelected(null);
            setNearby([]);
          }}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => {
            blurTimer.current = setTimeout(() => setShowSuggestions(false), 150);
          }}
          placeholder="Type a postcode…"
          aria-label="Postcode search"
          className="w-full rounded border border-[#1e2a35] bg-[#0b0f14] px-2 py-1.5 text-sm text-[#d7e3ec] placeholder:text-[#6b7f8c] focus:border-[#35c9d4] focus:outline-none"
        />
        {showSuggestions && suggestions.length > 0 && (
          <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded border border-[#1e2a35] bg-[#0d141a] shadow-xl">
            {suggestions.map((s) => (
              <li key={s.code}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    select(s);
                  }}
                  className="flex w-full items-center justify-between px-2 py-1.5 text-left text-xs text-[#d7e3ec] hover:bg-[#12283a]"
                >
                  <span className="font-mono">{s.code}</span>
                  <span className="text-[10px] text-[#6b7f8c]">
                    {s.count} address{s.count === 1 ? "" : "es"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {selected && (
        <div className="rounded border border-[#1e2a35] bg-[#0d141a] p-3 text-xs">
          <div className="mb-1 font-mono text-sm font-semibold text-[#d7e3ec]">{selected.code}</div>
          <div className="text-[#7d8f9d]">
            {selected.count} address{selected.count === 1 ? "" : "es"} in OSM
          </div>
          <div className="mt-1 text-[10px] text-[#6b7f8c]">
            {selected.lon.toFixed(5)}, {selected.lat.toFixed(5)}
          </div>

          {nearby.length > 0 && (
            <div className="mt-3">
              <div className="mb-1 text-[10px] tracking-wide text-[#7d8f9d] uppercase">
                Nearby bus stops ({nearby.length})
              </div>
              <ul className="space-y-1">
                {nearby.map((stop, i) => (
                  <li key={i} className="flex items-start justify-between gap-2 text-[11px]">
                    <span className="min-w-0 flex-1 truncate text-[#d7e3ec]">{stop.label}</span>
                    {stop.services && stop.services.length > 0 && (
                      <span className="shrink-0 text-[#35c9d4]">{stop.services.join(", ")}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {nearby.length === 0 && (
            <p className="mt-2 text-[10px] text-[#6b7f8c]">No bus stops within {NEARBY_RADIUS_M} m.</p>
          )}
        </div>
      )}

      {!selected && (
        <p className="text-[10px] leading-relaxed text-[#6b7f8c]">
          Start typing a postcode (e.g. IM1, IM4 3) to see suggestions. Selecting one flies the map to
          its centroid and lists nearby bus stops.
        </p>
      )}
    </div>
  );
}