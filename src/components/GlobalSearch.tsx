"use client";

/**
 * Search every layer at once.
 *
 * The per-layer Browse panel answers "find something in this layer"; this
 * answers "where is X, whichever layer it is in". It reads the compact
 * identity-only index (build-search-index.mjs), loads it lazily on the first
 * keystroke, and jumps the map to the chosen feature.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { loadSearchIndex, searchIndex, type SearchIndex, type SearchResult } from "@/lib/search-index";
import { SearchIcon } from "./Icons";

export function GlobalSearch({
  onSelect,
}: {
  onSelect: (layerId: string, lon: number, lat: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState<SearchIndex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!query.trim() || index) return;
    let cancelled = false;
    loadSearchIndex()
      .then((idx) => !cancelled && setIndex(idx))
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [query, index]);

  const results = useMemo<SearchResult[]>(
    () => (index ? searchIndex(index, query) : []),
    [index, query],
  );

  useEffect(() => setActive(0), [query]);

  // Close the results when focus leaves the whole control.
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // The mobile top bar opens the drawer and asks the search box to take focus.
  useEffect(() => {
    const onFocusSearch = () => {
      inputRef.current?.focus();
      setOpen(true);
    };
    window.addEventListener("openmannin:focus-search", onFocusSearch);
    return () => window.removeEventListener("openmannin:focus-search", onFocusSearch);
  }, []);

  const choose = (r: SearchResult) => {
    onSelect(r.layerId, r.lon, r.lat);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && results[active]) {
      e.preventDefault();
      choose(results[active]);
    }
  };

  const showResults = open && query.trim().length >= 2;

  return (
    <div ref={rootRef} className="relative">
      <div className="group relative">
        <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3 group-focus-within:text-accent" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search all layers…"
          aria-label="Search across all layers"
          className="w-full rounded-full bg-panel py-3 pl-11 pr-4 text-[13px] text-ink placeholder:text-ink-3 shadow-[0_4px_20px_rgba(0,0,0,0.15)] transition-shadow focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
      </div>

      {showResults && (
        <div className="scroll-thin absolute z-30 mt-2 w-full overflow-hidden rounded-2xl bg-panel shadow-[0_8px_32px_rgba(0,0,0,0.18)]">
          {error && <p className="p-3 text-[12px] text-danger">Search index failed: {error}</p>}
          {!error && !index && <p className="p-3 text-[12px] text-ink-3">Loading index…</p>}
          {!error && index && results.length === 0 && (
            <p className="p-3 text-[12px] text-ink-3">No matches.</p>
          )}
          {results.map((r, i) => (
            <button
              key={`${r.layerId}-${r.label}-${i}`}
              type="button"
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(r)}
              className={`flex w-full items-baseline justify-between gap-2 px-4 py-2.5 text-left text-[12px] ${
                i === active
                  ? "bg-raised text-accent"
                  : "text-ink hover:bg-raised/60"
              }`}
            >
              <span className="min-w-0 flex-1 truncate">{r.label}</span>
              <span className="shrink-0 text-[10px] text-ink-3">{r.layerLabel}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
