# Changelog

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

## [0.3.0] - 2026-10-14
### Added
- Build-time vector tiles (PMTiles) for the heaviest layers (roads, footpaths, house numbers, power lines, overture places), with MapLibre protocol support and runtime fallback to GeoJSON.
- CI verification that PMTiles are served with correct Range requests.
