# Changelog

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
