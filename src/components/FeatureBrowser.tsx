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
import { formatValue, humanise, HIDDEN_KEYS } from "@/lib/feature-format";

/** Rows rendered before the count-overflow note; the list is searchable. */
const MAX_LIST_ROWS = 250;
/** Attribute rows shown in the detail card before an overflow note. */
const MAX_DETAIL_ROWS = 14;

const DATE_KEYS = new Set(["dateRegistered", "dateCertified", "surveyDate"]);

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
  active = true,
}: {
  layers: LayerDef[];
  enabled: Set<string>;
  onEnsureEnabled: (id: string) => void;
  onLocate: (lon: number, lat: number) => void;
  active?: boolean;
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
    return entries.filter((e) => e.search.includes(q));
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

  // The detail card renders whatever the feature carries, hidden plumbing
  // aside, rather than a hardcoded field list that drifts from the data.
  const detail = useMemo(() => {
    const props = selected?.properties;
    if (!props) return [];
    return Object.entries(props).filter(
      ([k, v]) => !HIDDEN_KEYS.has(k) && v !== null && v !== undefined && v !== "",
    );
  }, [selected]);

  const panelStyle: React.CSSProperties = active
    ? {}
    : { visibility: "hidden", position: "absolute", pointerEvents: "none", inset: 0 };

  return (
    <div className="flex h-full min-h-0 flex-col p-3" style={panelStyle}>
      <label className="block label">
        Feature browser
        <select
          value={layerId}
          onChange={(e) => chooseLayer(e.target.value)}
          className="field mt-1"
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
            <p className="mt-2 rounded-md border border-danger/40 bg-danger/10 px-2 py-1.5 text-[12px] text-danger">
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
              placeholder="Filter by name, street, ref…"
              aria-label="Filter features"
              className="field min-w-0 flex-1"
            />
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label="Previous feature"
                className="btn !px-2.5 !py-1.5 text-sm leading-none"
                disabled={!selected}
              >
                &#9664;
              </button>
              <button
                type="button"
                onClick={() => step(1)}
                aria-label="Next feature"
                className="btn !px-2.5 !py-1.5 text-sm leading-none"
                disabled={!selected}
              >
                &#9654;
              </button>
            </div>
          </div>

          <div className="mt-1.5 text-[11px] text-ink-3">
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
            className="scroll-thin mt-2 min-h-0 flex-1 overflow-y-auto rounded-md border border-line"
          >
            {loading && <li className="p-2.5 text-[12px] text-ink-3">Loading…</li>}
            {!loading && list.length === 0 && (
              <li className="p-2.5 text-[12px] text-ink-3">
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
                  className={`w-full truncate px-2.5 py-1.5 text-left text-[12px] ${
                    selected?.index === e.index
                      ? "bg-raised text-accent"
                      : "text-ink hover:bg-raised/50"
                  }`}
                  title={e.label}
                >
                  {e.label}
                </button>
              </li>
            ))}
            {!loading && query.trim() === "" && total !== null && total > MAX_LIST_ROWS && (
              <li className="px-2.5 py-1.5 text-[11px] text-ink-3">
                Showing {MAX_LIST_ROWS.toLocaleString()} of {total.toLocaleString()} — filter to
                narrow.
              </li>
            )}
          </ul>

          {selected && (
            <div className="scroll-thin mt-2 max-h-40 shrink-0 overflow-y-auto rounded-md border border-line bg-panel p-2.5 text-[12px]">
              <div className="truncate font-semibold text-ink">{selected.label}</div>
              {detail.slice(0, MAX_DETAIL_ROWS).map(([k, v]) => (
                <div key={k} className="flex gap-2 py-0.5">
                  <span className="w-24 shrink-0 text-ink-3">{humanise(k)}</span>
                  <span className="min-w-0 flex-1 break-words text-ink">
                    {DATE_KEYS.has(k) ? formatDate(v) : formatValue(v)}
                  </span>
                </div>
              ))}
              {detail.length > MAX_DETAIL_ROWS && (
                <p className="mt-1 text-[11px] text-ink-3">
                  Showing {MAX_DETAIL_ROWS} of {detail.length} attributes.
                </p>
              )}
              {typeof selected.properties?.url === "string" && selected.properties.url !== "" && (
                <a
                  href={selected.properties.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="link mt-1 inline-block break-all"
                >
                  Official record ↗
                </a>
              )}
              {typeof selected.properties?.surveyNote === "string" &&
                selected.properties.surveyNote.trim() !== "" && (
                  <div className="flex gap-2 py-0.5">
                    <span className="w-24 shrink-0 text-ink-3">Survey note</span>
                    <span className="min-w-0 flex-1 break-words text-ink-2">
                      {selected.properties.surveyNote}
                    </span>
                  </div>
                )}
              <p className="mt-1 text-[11px] text-ink-3">
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