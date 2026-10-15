# Changelog

## [0.3.9] - 2026-10-15
### Fixed
- `scripts/lib/pmtiles-writer.mjs` wrote a single root directory containing every tile entry. The browser PMTiles reader fetches only the first 16 KiB of an archive to read the header *and the root directory*, so any layer whose compressed root crossed that line would not open at all: roads (root 24,780 B) and footpaths (17,562 B) rendered nothing, while the smaller archives were fine. The writer now emits the leaf-directory form of the spec: the root holds one run-length-0 entry per leaf, one leaf per 1024-tile chunk. Every root is now 64 B or less (roads 64 B, footpaths 59 B on the current data). A second bug in the same rewrite wrote `offset: 0` for every leaf because the offset cursor advanced *after* the entry map was built; leaf offsets are now cumulative. All seven archives were rebuilt and every tile decompresses. `scripts/lib/pmtiles-writer.test.mjs` (new) guards both: distinct leaf offsets, and a full reader round-trip of a multi-leaf archive plus a small single-leaf one.

### Changed
- The buildings layer now ships **OpenStreetMap only**, enforced in `scripts/ingest-buildings.mjs`. Only OSM records carry an OSM element id that can be checked against the live database; the 13,506 Microsoft ML roofprints in the Overture theme are machine-generated from aerial imagery with no id to verify and are now dropped (`dropped unverifiable`). The layer goes from 46,106 to 32,794 features, all with `osmId` — smaller and honest rather than padded. `overture-buildings-licence.mjs` still keeps both contributors at the licence level (both are ODbL); a new doc comment makes clear that licence-clean is not the same as verifiable, and the accuracy policy lives in the ingest, not the licence map.
- Replaced `scripts/enrich-buildings-names.mjs` with `scripts/enrich-buildings-addresses.mjs` (and the `enrich:buildings` script). The old pass copied a nearby Overture place name onto any building within 15 m, which had injected a misplaced POI name — "Snaefell Mountain", sitting at 54.155 in Douglas though the real summit is ~11 km north — onto unrelated Woodbourne Road buildings. Addresses are now filled only by strict point-in-polygon containment of OSM address nodes against a grid index, multiples are left blank rather than guessed, and filled values carry `addressSource: "osm-address-node"`. Unnamed buildings stay unnamed: no generic "Building" identity is invented and no name is copied from a neighbouring feature.
- Buildings are drawn as an outlined footprint: a lighter fill (0.28) under a darker fixed outline (`#6b7280`, width 1.4) instead of the faint registry-coloured line that disappeared against the basemap. `addPaintLayers` now honours an optional `lineColor`.
- Layer and source wording updated for the OSM-only building data (`src/lib/layers.ts` description, caveats and `featureCount: 32794`; `src/lib/sources.ts` notes; `src/lib/feature-label.ts` no longer treats `sourceDataset: "Microsoft ML Buildings"` as a building).

### Data
- Refreshed buildings, manifest, health report, search index and all seven PMTiles archives. Buildings: 32,794 features (1,888 named; 7,534 carrying an OSM address, plus 275 filled by containment; 151 left ambiguous). Every layer was checked to render: all registry layers register their style layers with no sync warnings, and a probe that flew to each layer's own data confirmed every layer draws features (the single live layer, satellite passes, has no static file by design).

## [0.3.8] - 2026-10-15
### Fixed
- `ingest:all` was missing three of its own producers: `ingest:buildings` (building footprints), `ingest:habitats` (marine habitats) and `ingest:wikidata-memorials` (Wikidata memorials) each had an npm script but were never chained, so the documented refresh command (`npm run ingest:all && npm run build`) silently left three layers — including two PMTiles-backed ones — on whatever data was committed when they were added. All three are now chained, before `annotate:nearest` so they get `nearestPlace` enrichment too.
- `scripts/ingest-overture-places.mjs` ended with a stray `PY` on line 142 after `await main()`, which threw a `ReferenceError` the moment it finished. The script wrote its file, exited 1, and because `ingest:all` is an `&&` chain, that aborted everything after it — `ingest:buildings`, `ingest:habitats`, `wifi`, `update`, `parishes`, `annotate:nearest` and the derived artefacts. It had been there since `146dd66a`, so the whole Overture-plus refresh path had been broken. The whole `ingest:all` chain now parses clean.
- Provenance stamping was not part of the pipeline. `verify-registry.mjs` requires every data file to carry `licenceId`, `sourceId` and `licenceUrl` resolved from the registers, but only 5 of the ingest scripts write them; the other 13 shipped files were right because someone stamped them by hand once. Re-running the pipeline rewrote those blocks back to the incomplete shape and failed 13 checks. `scripts/stamp-provenance.mjs` (new, `npm run stamp:provenance`) now closes that gap before the derived artefacts are built: it fills only the register-derived keys a file is missing and never overwrites what an ingest wrote, so layers like `airports` keep pointing `source` at OurAirports' own CSV with its `sourceVerified` stamp.
- `build:sources` now runs in `ingest:all`. `SOURCES.md` is generated from the same registers as the app, but nothing regenerated it after a refresh, so its per-layer feature counts silently drifted.

### Changed
- Nine `featureCount` values were re-baselined against the refreshed data, and the two layer descriptions that quote a count were corrected with them: roads 12020 to 12023, footpaths 9265 to 9266, house numbers 8396 to 8287 (6851 numbered addresses and 1436 named rural/heritage properties), hydro 1422 to 1430, Overture places 3483 to 3488, EV charging 59 to 60, lighthouses 102 to 101, protected areas 13 to 12, food & drink 308 to 310.
- `scripts/smoke-live.mjs` was stale against the layer registry: it asserted that the satellite passes layer is default-on and toggled a `live-flights` layer that no longer exists. It failed on load regardless of network. The header now describes the single default-off live layer, step 1 asserts the source is absent at load, and the dead on-hold-layer step is gone. The check also now expands the sidebar before toggling — the desktop drawer starts collapsed and its checkboxes are `inert`, so a click on one does nothing at all — and waits for the feed's first poll (30 s out by design in `src/lib/feeds/backoff.ts`, because on a static host the browser talks to CelesTrak directly and the interval IS the rate limit). Feature counts wait for `isSourceLoaded` rather than reading a source whose tiles have not landed, which answers 0 for a healthy layer. The toggle-on/off/on regression it actually guards, plus the layer-set and console checks, are unchanged. It stays manual, not in CI.

### Data
- Full `ingest:all` refresh: every GeoJSON, the search index, manifest, health report (43 layers, 93,311 features, 0 problems) and the PMTiles archives were rebuilt. The inherited provenance is the full register-resolved block on all 43 files.

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

## Unreleased

- Fixed building footprints failing to render: vector-tile (PMTiles) paint layers now declare `source-layer`, which was missing and caused MapLibre to reject every building layer as invalid.
- Enriched building footprints from OpenStreetMap tags (name, purpose, address, operator, heritage/RB reference, wiki/data, architect, levels, material) while keeping the ODbL licence map; enrichment matched 32,786 of 46,106 footprints by OSM element id.
- Building labels now coalesce name → purpose → subtype → building class, and unnamed buildings fall through to nearest-place context. Search keeps only named-property features.
