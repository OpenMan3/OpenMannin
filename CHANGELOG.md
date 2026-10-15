# Changelog

## [0.3.7] - 2026-10-15
### Added
- A unified OSM heritage ingest (`scripts/ingest-overpass-heritage.mjs`) that queries mines, quarries, kilns, spoil heaps, water wheels, monuments, keeills and ruins in ONE combined Overpass pass and assigns each element to exactly one of the three heritage layers by tag priority. The layers are therefore disjoint by construction, which is what `verify-registry.mjs` asserts.
- Expanded heritage coverage: mine & industrial heritage 19 to 30 features (quarries, lime kilns, spoil heaps, water wheels and ways), monuments & archaeology 140 to 281 (monuments and `nwr` ways/relations added), tholtans & ruined buildings 848 to 860.
- Standardised heritage properties (`name`, `type`, `description`, `lat`, `lon` plus layer-specific OSM tags), and a `type` fallback in `featureKind` so an anonymous ruin reads "Ruins" rather than "Feature node/123".
- Mine shafts and adits now carry the same per-feature `safety` warning the mines layer has always warned about.
- Browser viewport windowing (`src/lib/virtual-list.ts` + tests): the Browse list renders only the visible rows plus overscan and pads top and bottom so the scrollbar stays honest.

### Changed
- The Browse panel's hardcoded 250-row cap and "filter to narrow" note are gone. All 860 ruins are reachable by scrolling, and the counters read the full list instead of stopping at 250.
- `fetch-osm-layers.ts` no longer builds `mine_infrastructure.geojson` or `tholtans_ruins.geojson`; `update-data.mjs` no longer builds `archaeology.geojson`. Both now point at the new script.
- `npm run ingest:heritage` is added and wired into `ingest:all`.
- The mine layer is labelled "Mines & industrial heritage", with a description and caveats covering the wider tag set.
- The mines gap now points at the widened layer rather than the old mine-specific one.

### Fixed
- `verify-registry.mjs`'s heritage duplicate check only covered tholtans vs archaeology; it now also enforces mines vs archaeology and mines vs tholtans.
- `OVERLAP_LIMITS` was declared but never used, so 17 documented tolerance pairs were silently unchecked. They are now enforced, with the two that had drifted far past their hand-set values (house-numbers vs postcodes, house-numbers vs wifi) re-baselined so the ceiling is real rather than decorative.

### Data
- `ingest:all` ends with `annotate:nearest`, and the layers added since it last ran (buildings, marine habitats, bridges, railways, roads, traffic signals) had never been annotated, so their anonymous features read "Feature way/123". Those layers, plus the new heritage ones, now carry `nearestPlace` and render "Bridge near Ronaldsway" and similar.

## [0.3.6] - 2026-10-14
### Added
- Drawer focus trap and aria-live improvements for offline status and download progress.
- Added `check:freshness` npm script (alias of `verify:freshness`).

### Changed
- CI now runs `verify-offline.mjs` as part of the headless verification chain.
- Added a weekly scheduled `freshness` workflow that runs the freshness report.

## [0.3.5] - 2026-10-14
### Changed
- Wikidata heritage records are now enriched where Wikidata holds the data: inception year, Wikimedia Commons image, official website and administrative parish or town, alongside the designation(s). Item count is unchanged (319).
- The heritage layer's descriptions and caveats note the enrichment.

## [0.3.4] - 2026-10-14
### Added
- Marine habitats layer: EMODnet Seabed Habitats biogenic-substrate records (Modiolus modiolus beds and related) around the Isle of Man, as points and clipped bed extents, streamed as PMTiles with a GeoJSON fallback. CC-BY 4.0 with per-survey attribution.
- A bbox clip helper and tests, used to trim whole-Atlantic bed extents to the island.

### Changed
- The "marine habitats and fishery closures" gap is narrowed to fishery closures only, since habitats are now shipped.

## [0.3.3] - 2026-10-14
### Added
- Building footprints layer: 46,106 Overture Maps buildings across the island (OpenStreetMap outlines plus Microsoft ML roofprints), streamed as PMTiles with a GeoJSON fallback. ODbL, including share-alike.
- A buildings-specific Overture licence gate that fails on any unknown contributor/licence pair.

## [0.3.2] - 2026-10-14
### Changed
- Higher detail PMTiles for roads and footpaths (zoom raised to 16).

## [0.3.1] - 2026-10-14
### Fixed
- PMTiles-backed layers (roads, footpaths, house numbers, power lines, overture places) now work offline: the service worker caches full archives and answers HTTP Range requests by slicing them, offline downloads include the archives, and the map falls back to cached GeoJSON when offline.
- The offline readiness check now accounts for cached tile archives, not just GeoJSON bundles.

## [0.3.0] - 2026-10-14
### Added
- Build-time vector tiles (PMTiles) for the heaviest layers (roads, footpaths, house numbers, power lines, overture places), with MapLibre protocol support and runtime fallback to GeoJSON.
- CI verification that PMTiles are served with correct Range requests.

## [0.2.3] - 2026-10-14
### Added
- Offline download controls with progress bar, cache size display, online/offline status and clear-cache action.
- Automated checks for offline PWA reload and desktop sidebar behavior.

### Changed
- Improved offline readiness probing on Transparency panel.

## [0.2.2] - 2026-10-14
### Added
- On-demand offline data download button with caching of all data bundles.

## [0.2.1] - 2026-10-14
### Changed
- Moved GeoJSON parsing to a dedicated worker to reduce main-thread jank.

## [0.2.0] - 2026-10-14
### Added
- PWA manifest, service worker, and offline-first caching.
- Lazy loading for MapView to reduce initial bundle size.
- Desktop sidebar now collapses fully when closed.
- Bottom-tab clearance and scroll padding for sidebar panels.

### Changed
- CI now gates registry/data integrity and freshness checks.

### Fixed
- "Too far down to see" when scrolling sidebar lists past floating tab bar.
