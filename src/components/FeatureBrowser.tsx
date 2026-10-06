"use client";

/**
 * Browse and cycle through the features of a layer.
 *
 * The map is a click-to-pick surface, and that is hopeless for a layer of
 * hundreds of anonymous members: registered buildings (338 footprints) and
 * registered trees (1,199 points) have no visible label, so finding one means
 * hunting by eye. This panel flips the interaction - list the features, search
 * them, step through them with the arrow keys/buttons - and the map flies to
 * each one in turn. The amber browse marker (see MapView sinkHighlight) paints
 * the current feature on top of whatever else is enabled, so the item you are
 * on is never ambiguous.
 *
 * It is a pure "read the public/data file" tool: nothing here is live and no
 * upstream is contacted. The data is the same GeoJSON the map already caches.
 */

import { useMemo, useRef, useState } from "react";
import type { LayerDef } from "@/lib/types";
import { layersWithFiles } from "@/lib/layer-data";
import { indexFeatures, type BrowseEntry } from "@/lib/feature-index";

/** Fields worth a labelled row in the detail card, in display order. */
const DETAIL_KEYS = [
  "stopNo",
  "naptan",
  "locality",
  "shelter",
  "services",
  "regNo",
  "grade",
  "species",
  "description",
  "plan1987",
];
/** Rows rendered before the count-overflow note; the list is searchable. */
const MAX_LIST_ROWS = 250;

const DATE_KEYS = new Set(["dateRegistered", "dateCertified", "surveyDate"]);

function humanise(key: string): string {
  const spaced = key.replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function formatDate(v: unknown): string {
  if (typeof v === "number" && Number.isFinite(v)) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return String(v);
}

export function FeatureBrowser({
  layers,
  enabled,
  onEnsureEnabled,
  onLocate,
}: {
  layers: LayerDef[];
  enabled: Set<string>;
  onEnsureEnabled: (id: string) => void;
  onLocate: (lon: number, lat: number) => void;
}) {
  const withFiles = useMemo(() => layersWithFiles(layers), [layers]);
  const [layerId, setLayerId] = useState<string>("");
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<BrowseEntry[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pos, setPos] = useState(0);
  const listRef = useRef<HTMLUListElement | null>(null);
  const rowRefs = useRef<Map<number, HTMLLIElement>>(new Map());

  const def = withFiles.find((l) => l.id === layerId) ?? null;

  const list = useMemo(() => {
    if (!entries) return [];
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => e.label.toLowerCase().includes(q));
  }, [entries, query]);

  const selected = list.length > 0 ? list[Math.min(pos, list.length - 1)] : null;

  const chooseLayer = (id: string) => {
    setLayerId(id);
    setPos(0);
    setQuery("");
    setError(null);
    setEntries(null);
    setTotal(null);
    rowRefs.current.clear();
    if (!id) return;
    const layer = withFiles.find((l) => l.id === id);
    if (!layer) return;
    // Browsing a layer implies seeing it: footprints cannot be recognised when
    // the layer underneath is switched off.
    if (!enabled.has(id)) onEnsureEnabled(id);
    setLoading(true);
    void loadLayerFile(layer).then((result) => {
      setLoading(false);
      if (result.error) {
        setError(result.error);
        return;
      }
      setEntries(result.entries ?? []);
      setTotal(result.entries?.length ?? 0);
    });
  };

  const goTo = (e: BrowseEntry | null) => {
    if (!e) return;
    onLocate(e.lon, e.lat);
    window.dispatchEvent(
      new CustomEvent("openmannin:highlight-feature", { detail: { geometry: e.geometry } }),
    );
    // Keep the active row visible while stepping through a long list.
    requestAnimationFrame(() => {
      const row = rowRefs.current.get(e.index);
      row?.scrollIntoView({ block: "nearest" });
    });
  };

  const step = (delta: number) => {
    if (list.length === 0) return;
    const next = (pos + delta + list.length) % list.length;
    setPos(next);
    goTo(list[next]);
  };

  const selectRow = (e: BrowseEntry) => {
    const idx = list.findIndex((x) => x.index === e.index);
    setPos(idx < 0 ? 0 : idx);
    goTo(e);
  };

  const shrink = (value: unknown): string => {
    const list = Array.isArray(value) ? value.map((v) => String(v)).join(", ") : value;
    const s = String(list ?? "");
    return s.length > 120 ? `${s.slice(0, 120)}…` : s;
  };

  return (
    <div className="flex h-full min-h-0 flex-col p-3">
      <label className="block text-[10px] tracking-wide text-[#7d8f9d] uppercase">
        Feature browser
        <select
          value={layerId}
          onChange={(e) => chooseLayer(e.target.value)}
          className="mt-1 block w-full rounded border border-[#1e2a35] bg-[#0d141a] px-1.5 py-1 text-xs text-[#d7e3ec] focus:border-[#35c9d4] focus:outline-none"
          aria-label="Layer to browse"
        >
          <option value="">Select a layer…</option>
          {withFiles.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      </label>

      {def && (
        <>
          {error && (
            <p className="mt-2 rounded border border-[#f87171]/40 bg-[#3a1418] px-2 py-1 text-[11px] text-[#fca5a5]">
              {error}
            </p>
          )}
          <div className="mt-2 flex items-center gap-2">
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPos(0);
              }}
              placeholder="Filter by name or location…"
              aria-label="Filter features"
              className="min-w-0 flex-1 rounded border border-[#1e2a35] bg-[#0b0f14] px-2 py-1 text-xs text-[#d7e3ec] placeholder:text-[#6b7f8c] focus:border-[#35c9d4] focus:outline-none"
            />
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label="Previous feature"
                className="rounded border border-[#1e2a35] bg-[#0d141a] px-2.5 py-1 text-sm leading-none text-[#d7e3ec] hover:border-[#35c9d4] disabled:opacity-40"
                disabled={!selected}
              >
                &#9664;
              </button>
              <button
                type="button"
                onClick={() => step(1)}
                aria-label="Next feature"
                className="rounded border border-[#1e2a35] bg-[#0d141a] px-2.5 py-1 text-sm leading-none text-[#d7e3ec] hover:border-[#35c9d4] disabled:opacity-40"
                disabled={!selected}
              >
                &#9654;
              </button>
            </div>
          </div>

          <div className="mt-1.5 text-[10px] text-[#6b7f8c]">
            {total !== null && !loading && (
              <span>
                {list.length.toLocaleString()} feature{list.length === 1 ? "" : "s"}
                {query.trim() ? ` matching “${query.trim()}”` : ` of ${total.toLocaleString()}`}
                {" · "}
              </span>
            )}
            {loading ? "Loading…" : selected ? `${pos + 1} / ${list.length}` : "—"}
          </div>

          <ul
            ref={listRef}
            className="scroll-thin mt-2 min-h-0 flex-1 overflow-y-auto rounded border border-[#1e2a35]"
          >
            {loading && <li className="p-2 text-[11px] text-[#6b7f8c]">Loading…</li>}
            {!loading && list.length === 0 && (
              <li className="p-2 text-[11px] text-[#6b7f8c]">
                {total === 0
                  ? "This layer has no features with coordinates."
                  : query.trim()
                    ? "No matches."
                    : "Nothing to show."}
              </li>
            )}
            {list.slice(0, MAX_LIST_ROWS).map((e) => (
              <li key={e.index} ref={(el) => { if (el) rowRefs.current.set(e.index, el); }}>
                <button
                  type="button"
                  onClick={() => selectRow(e)}
                  className={`w-full truncate px-2 py-1 text-left text-[11px] ${
                    selected?.index === e.index
                      ? "bg-[#12283a] text-[#35c9d4]"
                      : "text-[#d7e3ec] hover:bg-[#0d141a]"
                  }`}
                  title={e.label}
                >
                  {e.label}
                </button>
              </li>
            ))}
            {!loading && query.trim() === "" && total !== null && total > MAX_LIST_ROWS && (
              <li className="px-2 py-1 text-[10px] text-[#6b7f8c]">
                Showing {MAX_LIST_ROWS.toLocaleString()} of {total.toLocaleString()} — filter to
                narrow.
              </li>
            )}
          </ul>

          {selected && (
            <div className="scroll-thin mt-2 max-h-40 shrink-0 overflow-y-auto rounded border border-[#1e2a35] bg-[#0d141a] p-2 text-[11px]">
              <div className="truncate font-semibold text-[#d7e3ec]">{selected.label}</div>
              {DETAIL_KEYS.map((k) => {
                const v = selected.properties?.[k];
                if (v === undefined || v === null || v === "") return null;
                return (
                  <div key={k} className="flex gap-2 py-0.5">
                    <span className="w-24 shrink-0 text-[#7d8f9d]">{humanise(k)}</span>
                    <span className="min-w-0 flex-1 break-words text-[#d7e3ec]">
                      {DATE_KEYS.has(k) ? formatDate(v) : shrink(v)}
                    </span>
                  </div>
                );
              })}
              {typeof selected.properties?.url === "string" && selected.properties.url !== "" && (
                <a
                  href={selected.properties.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-block break-all text-[#35c9d4] hover:underline"
                >
                  Official record ↗
                </a>
              )}
              {typeof selected.properties?.surveyNote === "string" &&
                selected.properties.surveyNote.trim() !== "" && (
                  <div className="flex gap-2 py-0.5">
                    <span className="w-24 shrink-0 text-[#7d8f9d]">Survey note</span>
                    <span className="min-w-0 flex-1 break-words text-[#9fb0bd]">
                      {selected.properties.surveyNote}
                    </span>
                  </div>
                )}
              <p className="mt-1 text-[10px] text-[#6b7f8c]">
                {selected.lon.toFixed(5)}, {selected.lat.toFixed(5)}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

async function loadLayerFile(
  layer: LayerDef & { file: string },
): Promise<{ entries?: BrowseEntry[]; error?: string }> {
  try {
    const { loadLayer } = await import("@/lib/layer-data");
    const fc = await loadLayer(layer.file);
    return { entries: indexFeatures(fc) };
  } catch (err) {
    return { error: (err as Error).message };
  }
}