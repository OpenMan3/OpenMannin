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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LayerDef } from "@/lib/types";
import { layersWithFiles } from "@/lib/layer-data";
import { indexFeatures, type BrowseEntry } from "@/lib/feature-index";
import { formatValue, humanise, HIDDEN_KEYS } from "@/lib/feature-format";
import { windowRange } from "@/lib/virtual-list";

/**
 * Fixed height of every list row, in pixels (see the row <li> below). The
 * windowing maths needs one known height, so rows are a single truncated line
 * rather than free-flowing text.
 */
const ROW_HEIGHT = 30;
/** Rows rendered above and below the viewport, to hide fast scrolling. */
const OVERSCAN = 8;
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
  layerId,
  onLayerChange,
  query,
  onQueryChange,
  pos,
  onPosChange,
}: {
  layers: LayerDef[];
  enabled: Set<string>;
  onEnsureEnabled: (id: string) => void;
  onLocate: (lon: number, lat: number) => void;
  /** Currently selected layer (lifted to survive unmount/remount). */
  layerId: string;
  onLayerChange: (id: string) => void;
  /** Current filter text (lifted to survive unmount/remount). */
  query: string;
  onQueryChange: (q: string) => void;
  /** Current list position (lifted to survive unmount/remount). */
  pos: number;
  onPosChange: (p: number) => void;
}) {
  const withFiles = useMemo(() => layersWithFiles(layers), [layers]);
  const [entries, setEntries] = useState<BrowseEntry[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(0);

  const def = withFiles.find((l) => l.id === layerId) ?? null;

  const list = useMemo(() => {
    if (!entries) return [];
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => e.search.includes(q));
  }, [entries, query]);

  const selected = list.length > 0 ? list[Math.min(pos, list.length - 1)] : null;

  // Window the list to the visible rows (plus overscan) so a layer of 860
  // ruins mounts ~20 nodes, not 860, and the filter box stays responsive.
  const range = windowRange({
    total: list.length,
    rowHeight: ROW_HEIGHT,
    scrollTop,
    viewportHeight: viewport,
    overscan: OVERSCAN,
  });
  const visibleRows = list.slice(range.start, range.end);

  // Load layer data when layerId changes (runs on mount and when tab is reopened).
  useEffect(() => {
    if (!layerId) {
      setEntries(null);
      setTotal(null);
      return;
    }
    const layer = withFiles.find((l) => l.id === layerId);
    if (!layer) return;
    let cancelled = false;
    setLoading(true);
    void loadLayerFile(layer).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (result.error) {
        setError(result.error);
      } else {
        setEntries(result.entries ?? []);
        setTotal(result.entries?.length ?? 0);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [layerId, withFiles]);

  // Measure the list viewport so the window knows how many rows fit. Re-runs
  // when the panel (and so the <ul>) mounts or unmounts.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const measure = () => setViewport(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [def]);

  // A new filter or layer means a different list: start it from the top so the
  // window does not open onto blank space.
  const resetScroll = useCallback(() => {
    setScrollTop(0);
    if (listRef.current) listRef.current.scrollTop = 0;
  }, []);

  const chooseLayer = (id: string) => {
    onLayerChange(id);
    onPosChange(0);
    onQueryChange("");
    setError(null);
    setEntries(null);
    setTotal(null);
    resetScroll();
    if (!id) return;
    const layer = withFiles.find((l) => l.id === id);
    if (!layer) return;
    // Browsing a layer implies seeing it: footprints cannot be recognised when
    // the layer underneath is switched off.
    if (!enabled.has(id)) onEnsureEnabled(id);
    // Loading is handled by the effect above.
  };

  // Scroll a list position into view. Works whether or not the row is
  // currently mounted, which it may not be: the window only renders the
  // visible slice, so the active row has to be scrolled to by pixel offset.
  const reveal = (index: number) => {
    const el = listRef.current;
    if (!el) return;
    const top = index * ROW_HEIGHT;
    const bottom = top + ROW_HEIGHT;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight;
  };

  const goTo = (e: BrowseEntry | null) => {
    if (!e) return;
    onLocate(e.lon, e.lat);
    window.dispatchEvent(
      new CustomEvent("openmannin:highlight-feature", { detail: { geometry: e.geometry } }),
    );
  };

  const step = (delta: number) => {
    if (list.length === 0) return;
    const next = (pos + delta + list.length) % list.length;
    onPosChange(next);
    reveal(next);
    goTo(list[next]);
  };

  const selectRow = (e: BrowseEntry) => {
    const idx = list.findIndex((x) => x.index === e.index);
    const next = idx < 0 ? 0 : idx;
    onPosChange(next);
    reveal(next);
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

  return (
    <div className="flex h-full min-h-0 flex-col p-3">
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
                onQueryChange(e.target.value);
                onPosChange(0);
                resetScroll();
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
            onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
            className="scroll-thin mt-2 min-h-0 flex-1 overflow-y-auto rounded-md border border-line md:pb-16"
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
            {!loading && range.topPad > 0 && <li aria-hidden style={{ height: range.topPad }} />}
            {visibleRows.map((e) => (
              <li key={e.index} style={{ height: ROW_HEIGHT }}>
                <button
                  type="button"
                  onClick={() => selectRow(e)}
                  className={`block h-full w-full truncate px-2.5 text-left text-[12px] leading-[30px] ${
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
            {!loading && range.bottomPad > 0 && (
              <li aria-hidden style={{ height: range.bottomPad }} />
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