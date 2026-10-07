# Sources and licences

OpenMannin renders only data that can be traced to a source, a licence and a confidence grade. This register is generated from the same TypeScript registers the app renders (`src/lib/layers.ts`, `src/lib/sources.ts`, `src/lib/licences.ts`), so the file, the UI and this document cannot drift apart.

## Non-open government map data is not used

This project does **not** ingest, cache, trace or derive anything from government maps or map-derived products. The IoM Open Government Licence explicitly **excludes maps and map-derived products** ([OGL](https://www.gov.im/about-this-site/open-government-licence/), [maps exclusion](https://www.gov.im/about-this-site/terms-and-conditions/maps/)), and the Isle of Man Survey base cartography is sold commercially. All island-wide vector coverage is built from independently licensed sources — principally OpenStreetMap (ODbL) and Wikidata (CC0). Coverage that could not be independently sourced is recorded as a gap rather than relicensed.

## Licence register (12)

| Licence | Commercial | Permission required | Obligation |
| --- | --- | --- | --- |
| Isle of Man Open Government Licence ([link](https://www.gov.im/about-this-site/open-government-licence/)) | yes | no | Attribution to Crown copyright / Isle of Man Government. Excludes personal data, departmental logos and the Isle of Man crest. |
| Crown copyright — derived open datasets (base mapping NOT included) ([link](https://www.gov.im/about-this-site/open-government-licence/)) | yes | no | Crown copyright, attribution required. CRITICAL EXCLUSION: this covers the derived feature services published through the open data portal only. It does NOT cover the Isle of Man Survey base cartography, which is Crown copyright but explicitly excluded from the OGL and sold commercially. Never mix our vectors with their base tiles without a licence. Also excluded: personal data, departmental logos, the Isle of Man crest, third-party rights, patents, trademarks and designs. |
| Open Database License (OpenStreetMap) ([link](https://opendatacommons.org/licenses/odbl/)) | yes | no | Attribution AND share-alike on derived databases. OSM data is (c) OpenStreetMap contributors. |
| Creative Commons Attribution 4.0 ([link](https://creativecommons.org/licenses/by/4.0/)) | yes | no | Attribution with link to licence. |
| Creative Commons Attribution-NonCommercial 4.0 ([link](https://creativecommons.org/licenses/by-nc/4.0/)) | no | no | Attribution. Non-commercial use only — blocks monetised deployment. |
| Public domain / no known copyright | yes | no | Attribution appreciated, not required. |
| Creative Commons CC0 1.0 (public domain dedication) ([link](https://creativecommons.org/publicdomain/zero/1.0/)) | yes | no | No rights reserved. Attribution optional. |
| OurAirports public domain dedication ([link](https://ourairports.com/data/)) | yes | no | OurAirports publishes its airport, runway and heliport tables under a public domain dedication. No attribution required, though crediting OurAirports is appreciated. Note this covers the DATA, not the website's own compiled map styling. |
| Copernicus / ESA open data ([link](https://www.copernicus.eu/en/access-data/copyright-and-licences)) | yes | no | Free and full open. Attribution to Copernicus/ESA appreciated. |
| OpenStreetMap tile usage policy ([link](https://operations.osmfoundation.org/policies/tiles/)) | yes | yes | Requires distinctive User-Agent, >=7 day caching, Referer preserved. Forbids bulk downloading and prefetching. OSM may block without notice. |
| No published licence | no | yes | No terms of use, robots.txt or licence found. Absence of a licence is not a grant. Do not republish without written permission. |
| Licence not established | no | yes | Verify before use. |

## Source register (33)

| Source | Publisher | Licence | Last checked |
| --- | --- | --- | --- |
| [Isle of Man Survey — Digital Map Data](https://www.gov.im/about-the-government/departments/infrastructure/mapping/) | Isle of Man Government — Isle of Man Survey | UNKNOWN | 2026-10-04 |
| [OpenStreetMap — WikiProject Isle of Man](https://www.openstreetmap.org/wiki/WikiProject_Isle_of_Man) | OpenStreetMap contributors | ODbL | 2026-10-04 |
| [Wikidata](https://www.wikidata.org/) | Wikimedia Foundation / Wikidata community | CC0-1.0 | 2026-10-06 |
| [Isle of Man Government web publication](https://www.gov.im/) | Isle of Man Government | OGL-IoM | 2026-10-04 |
| [FindMyBus.im live vehicle feed (SignalR)](https://www.findmybus.im/) | Isle of Man Public Transport / Bus Vannin | NO-LICENCE | 2026-10-04 |
| [The OpenSky Network REST API](https://openskynetwork.github.io/opensky-api/rest.html) | OpenSky Network / ETH Zurich | UNKNOWN | 2026-10-04 |
| [CelesTrak orbital elements](https://celestrak.org/) | CelesTrak (GP data by TLE) | PUBLIC-DOMAIN | 2026-10-04 |
| [AISStream.io](https://aisstream.io/) | AISStream (Voltron / vtex.ai) | NO-LICENCE | 2026-10-04 |
| [Global Fishing Watch API v3](https://globalfishingwatch.org/) | Global Fishing Watch Foundation | CC-BY-NC-4.0 | 2026-10-04 |
| [Open-Meteo weather and marine API](https://open-meteo.com/) | Open-Meteo | CC-BY-4.0 | 2026-10-04 |
| [Manx Utilities asset disclosures](https://www.manxutilities.im/) | Manx Utilities | OGL-IoM | 2026-10-04 |
| [Submarine Cable Map / TeleGeography](https://www.submarinecablemap.com/) | TeleGeography | CC-BY-4.0 | 2026-10-04 |
| [Atlantic-Cable.com cable history](https://atlantic-cable.com/) | Atlantic Cable (Steven Roberts / Bill Glover) | UNKNOWN | 2026-10-04 |
| [Nuclear Decommissioning Authority / Sellafield Ltd](https://www.gov.uk/government/publications/nuclear-decommissioning-authority-annual-report-and-accounts-2025-to-2026) | UK Nuclear Decommissioning Authority | OGL-IoM | 2026-10-04 |
| [Manx Marine Environmental Assessment (MMEA), 2nd edition](https://www.gov.im/media/1363407/ch-21-physical-environment.pdf) | Isle of Man Government | OGL-IoM | 2026-10-04 |
| [OpenStreetMap seamarks survey](https://wiki.openstreetmap.org/wiki/Seamark) | OpenStreetMap contributors | ODbL | 2026-10-04 |
| [OpenStreetMap harbour and marine infrastructure](https://wiki.openstreetmap.org/wiki/Tag:seamark%3Dharbour) | OpenStreetMap contributors | ODbL | 2026-10-04 |
| [OpenStreetMap power infrastructure](https://wiki.openstreetmap.org/wiki/Key:power) | OpenStreetMap contributors | ODbL | 2026-10-04 |
| [OurAirports airport and runway tables](https://ourairports.com/data/) | OurAirports | PD-OURAIRPORTS | 2026-10-04 |
| [OSPAR Commission / Beaufort's Dyke records](https://www.ospar.org/) | OSPAR Secretariat | PUBLIC-DOMAIN | 2026-10-04 |
| [Mooir Vannin project documentation](https://cdn.orsted.com/-/media/www/docs/corp/uk/im/240214mooirvanninsummaryreportv60-08654899a-1.pdf) | Ørsted | PUBLIC-DOMAIN | 2026-10-04 |
| [The Crown Estate offshore wind leasing](https://www.thecrownestate.co.uk/our-business/marine/offshore-wind/morgan-offshore-wind-site) | The Crown Estate | PUBLIC-DOMAIN | 2026-10-04 |
| [Spaceman teleport / aql Space Services](https://spaceman.im/) | aql (formerly BlueWave Communications) | PUBLIC-DOMAIN | 2026-10-04 |
| [OpenTopoMap tiles](https://opentopomap.org/) | OpenTopoMap (based on OpenStreetMap, SRTM) | CC-BY-4.0 | 2026-10-04 |
| [OpenFreeMap / OpenMapTiles](https://openfreemap.org/) | OpenFreeMap | ODbL | 2026-10-04 |
| [EMODnet Bathymetry](https://emodnet.ec.europa.eu/en/bathymetry) | EMODnet / European Commission | CC-BY-4.0 | 2026-10-04 |
| [Esri World Imagery basemap](https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer) | Esri / Maxar / Earthstar Geographics | UNKNOWN | 2026-10-04 |
| [RIPEstat data API](https://stat.ripe.net/) | RIPE NCC | NO-LICENCE | 2026-10-04 |
| [Companies Registry — public company search](https://services.gov.im/ded/services/companiesregistry/companysearch.iom) | Isle of Man Government — Department of Economic Affairs | OGL-IoM | 2026-10-04 |
| [Isle of Man Financial Services Authority registers](https://www.iomfsa.im/registers/) | Isle of Man FSA | OGL-IoM | 2026-10-04 |
| [OpenMannin compilation](https://github.com/) | OpenMannin | OGL-IoM | 2026-10-04 |
| [Isle of Man Government public webcams](https://www.gov.im/webcams/) | Isle of Man Government (images.gov.im) | OGL-IoM | 2026-10-04 |
| [UK Met Office DataHub](https://datahub.metoffice.gov.uk/) | UK Met Office | CC-BY-4.0 | 2026-10-04 |

## Layers by source

### geography

| Layer | Source | Licence | Grade | Features |
| --- | --- | --- | --- | --- |
| Place names (`toponyms`) | osmIOM | ODbL | B | 1253 |
| Heritage-designated places (`heritage`) | wikidata | CC0-1.0 | C | 319 |

### trails

| Layer | Source | Licence | Grade | Features |
| --- | --- | --- | --- | --- |
| Road network (`roads`) | osmIOM | ODbL | B | 21239 |
| Bridges (`bridges`) | osmIOM | ODbL | C | 557 |
| Speed limits (`speedlimits`) | osmIOM | ODbL | C | 4207 |

### transport

| Layer | Source | Licence | Grade | Features |
| --- | --- | --- | --- | --- |
| Bus stops (`bus-stops`) | osmIOM | ODbL | C | 732 |
| Postcodes (`postcodes`) | osmIOM | ODbL | C | 1414 |
| House numbers (`house-numbers`) | osmIOM | ODbL | C | 6949 |
| Railways & tramways (`railways`) | osmIOM | ODbL | B | 284 |
| EV charging sites (`ev`) | osmIOM | ODbL | C | 60 |
| Traffic signals & crossings (`traffic-signals`) | osmIOM | ODbL | C | 155 |

### cables

| Layer | Source | Licence | Grade | Features |
| --- | --- | --- | --- | --- |
| Submarine cables (`subsea-cables`) | osmSeamarks | ODbL | B | 5 |
| Cable landings (`cable-landings`) | mea | OGL-IoM | C | 4 |
| Historic & remnant cables (`historic-cables`) | atlanticcable | UNKNOWN | C | 4 |

### infrastructure

| Layer | Source | Licence | Grade | Features |
| --- | --- | --- | --- | --- |
| Ports & harbours (`ports`) | osmHarbours | ODbL | B | 27 |
| Satellite ground stations (`satellite`) | spaceman | PUBLIC-DOMAIN | B | 2 |
| Chemical & ordnance dumpsites (`dumpsites`) | ospar | PUBLIC-DOMAIN | B | 2 |
| Lighthouses & seamarks (`lighthouses`) | osmIOM | ODbL | B | 106 |
| IP networks & ASNs (`networks`) | ripestat | NO-LICENCE | A | 27 |

### energy

| Layer | Source | Licence | Grade | Features |
| --- | --- | --- | --- | --- |
| Offshore wind projects (`offshore-wind`) | orsted | PUBLIC-DOMAIN | D | 1 |
| Reservoirs & water (`reservoirs`) | osmIOM | ODbL | C | 17 |
| Power stations & substations (`power`) | osmPower | ODbL | B | 107 |

### environment

| Layer | Source | Licence | Grade | Features |
| --- | --- | --- | --- | --- |
| Protected areas (`protected`) | osmIOM | ODbL | C | 13 |
| Rivers & streams (`hydro`) | osmIOM | ODbL | C | 1430 |

### aviation

| Layer | Source | Licence | Grade | Features |
| --- | --- | --- | --- | --- |
| Airports & airstrips (`airport`) | ourairports | PD-OURAIRPORTS | B | 7 |

### surveillance

| Layer | Source | Licence | Grade | Features |
| --- | --- | --- | --- | --- |
| Public webcams (`webcams`) | webcamsGov | OGL-IoM | B | 10 |
| Tide reference stations (`tide-stations`) | mea | OGL-IoM | A | 6 |

### live

| Layer | Source | Licence | Grade | Features |
| --- | --- | --- | --- | --- |
| Live vehicles (bus, steam train, tram, horse tram) (`live-transit`) | findmybus | NO-LICENCE | A | live/blocked |
| Live aircraft (`live-flights`) | opensky | UNKNOWN | A | live/blocked |
| Satellite pass predictions (`satellite-passes`) | celestrak | PUBLIC-DOMAIN | C | live/blocked |
| Live vessels (AIS) (`live-vessels`) | aisstream | NO-LICENCE | C | live/blocked |
| Weather & sea state (`weather`) | openmeteo | CC-BY-4.0 | A | live/blocked |

## Gaps (22)

Coverage that could not be sourced under a usable licence. Rendered in the app as a first-class panel.

| Gap | Severity | Why unavailable |
| --- | --- | --- |
| Official national place-name gazetteer (`gazetteer`) | medium | No official gazetteer is published as open data. A government layer named 'Field Gazetteer' contains no name field at all — its fields are PLOT, START, ACRES3D, CATEGORY, OCCUP_CURR and USECOD_CURR, making it agricultural field parcels, not a place-name index. That layer is not openly licensed and has been removed. This was previously mislabelled in OpenMannin as a 19,848-record toponymic gazetteer; the error is corrected. |
| House numbers (`house-numbers`) | high | The government LLPG address geocoder returns HTTP 403 with error GWM_0003 to anonymous callers and has no copyrightText — it is an authorised-access service. The only complete address source is OS AddressBase Islands, which is a commercial product (three-month free Data Exploration Licence). A second LLPG geocoder is exposed on the pre-production host ppmaps.gov.im. Planning-application data carries 81,232 non-null addresses but those are application sites, not a national address register. |
| Abandoned mines (`mines`) | high | No official mining layer is published. Searches of the government's 564 open items for 'mine', 'mining', 'mineral', 'spoil' and 'shaft' return zero results. Manx National Heritage holds the authoritative archaeological record but its HER API returns 404 on every conventional path and it operates an Access and Charging Policy, so some reuse may be chargeable. |
| CCTV and ANPR camera locations (`cameras`) | high | Nobody publishes it. Neither the Constabulary, nor DoI, nor any local authority has ever released a camera count, location list or retention schedule. Ramsey Borough Council's own FOI response references a camera map that is absent from the released PDF, and a second FOI gives purchase and maintenance costs with no count or locations. The Chief Constable's Annual Report 2024/25 contains none. The DoI CCTV policy page self-contradicts on retention (10 days in the FAQ vs 'usually in the region of one month' elsewhere) and was last updated 24 May 2017. |
| Parish and sheading boundaries (`boundaries`) | medium | The IoM publishes no authoritative open boundary dataset. The official local authority map is a PDF (cartography, not GIS). The 17-parish / 6-sheading model is standard and well attested, but not published as open data. |
| Traffic counts (`traffic-counts`) | medium | There is no transport section at all in Isle of Man in Numbers 2025 — all 112 sheets were checked. The only transport-adjacent figures are registered aircraft, the shipping registry, road accidents and driving tests. The gov.im 'Live Road Information' open data entry is a broken link to a variable-message-sign status page with no flow data. TomTom one.network returns 401/503/403 on every API probe. |
| Census 2021 boundaries and tables (`census`) | medium | Both 2021 Census PDFs promise tables on the open data Society page, but the only machine-readable files published are the 2016 tables. No 2021 CSV/XLSX and no official boundary shapefile or GeoJSON exist. |
| Bathymetry (`bathymetry`) | medium | UKHO operates a Data Exploration Licence that is revocable, non-transferable, limited to specified uses and expires after 12 months. The relevant CDI record (survey HI705, IoM to Liverpool Bay) is metadata only and explicitly 'beyond the 12 NM boundary'. There is no free authoritative alternative. |
| Critical National Infrastructure register (`cni`) | low | The National Infrastructure Security Bill is still a Bill. The consultation-stage reference guide lists 19 proposed sectors but is policy material, not a designation instrument. No competent authority exists yet and no public asset register exists. |
| MOD land (`mod`) | low | No current MOD-owned or MOD-leased land was identified anywhere. GOV.UK lists the 1939 Jurby Air Gunnery and Bombing Range byelaws but records them as LAPSED. Jurby airfield today is general aviation. The only military presence is Military Aid to the Civil Community, which is a reciprocal UK arrangement, not Manx land. |
| Aquaculture sites (`aquaculture`) | medium | Repeated searches found no reliable inventory. Searches surfaced unrelated Maine lease data and Bangor University wild-fishery pages instead. Note the IoM holds exclusive fishing rights only within the first 3 nm, and commercial fishing inside the territorial sea needs BOTH a UK and an IoM licence. |
| Nuclear facilities (verified absent from the Isle of Man) (`nuclear`) | low | THERE ISN'T ONE. This layer previously asserted Sellafield, Calder Hall and THORP at grade A with three features. Those sites are real but are on the Cumbrian coast roughly 32 miles (52 km) from the Isle of Man and outside Manx territorial waters entirely — an earlier draft put them at 22 km, which is wrong. No nuclear facility of any kind exists on the island. The risk is real but it is a regional external, not a local asset, so plotting it on an Isle of Man infrastructure map asserted a jurisdiction that does not exist. DEFA's Radioactivity Monitoring reports and the Tynwald PP 2023/33 papers both describe only ambient monitoring of radionuclides arriving by airfall and sea, with no local facility. What remains relevant — Sellafield's Magnox Swarf Storage Silo retrievals and the live GDF siting process (Mid Copeland and South Copeland candidates) — is UK domestic policy recorded in those documents, not Isle of Man infrastructure. |
| Satellite ground stations and GNSS reference stations (`satellite-stations`) | low | The one site with a published position is the Spaceman teleport (aql Space Services) at 54.1390 N, 4.4951 W, about 2 km east of Douglas, chosen for low horizon clutter and separately allocated spectrum, with dark fibre into the aql UK network. That single coordinate is quotable, but the layer as a whole cannot be completed honestly: Starlink is licensed on the island via a BlueWave partnership and appears only on third-party dish trackers with no operator-confirmed coordinate; Arqiva's 'Chalfont' teleport is in Buckinghamshire and NOT on the island despite being widely misstated as such; and no OneWeb, Galileo or BeiDou ground infrastructure has been located either way. Publishing one confident pin next to a layer title that implies a network would overstate what is known. |
| Ports and harbours (`ports`) | medium | The harbour list is not in doubt — Douglas, Peel, Port Erin, Port St Mary, Ramsey, Laxey, Castletown and Derbyhaven — and the Marine Operations Centre on the second floor of the Sea Terminal in Douglas is the authority. What is missing is a published, machine-readable, licensed set of positions. OSM does carry harbour and pier features, but they are community-mapped and an earlier Overpass query for waste-site features returned nothing usable, so OSM coverage of IoM harbour infrastructure has not been verified as sufficient. The IoM does not publish a harbours GeoJSON or point service, and MMEA's harbour material is descriptive text plus restricted Admiralty chart extracts. |
| Power stations and substations (`power`) | medium | The inventory is documented but the coordinates are not publishable. MMEA Chapter 6 states there are NINE PRIMARY SUBSTATIONS and that Manx Utilities runs three independent supply chains (natural gas, liquid fuel, electricity imports) and three power stations, with about 1,300 km of underground cable and 530 km of overhead line. Manx Utilities' own asset disclosures do not publish substation or power station positions, and MMEA's Figure 2 major asset map is an image from which coordinates cannot be taken. Guessing positions from a figure would be exactly the kind of fabricated precision this project exists to avoid. The nearby OSM substation nodes have not been confirmed to correspond to the nine primary substations and should not be substituted on the assumption that they do. |
| Agricultural field parcels (`field-parcels`) | medium | The previous source was a government 'Field Gazetteer' layer (19,848 parcels). Government map-derived data is not openly licensed and has been removed. No independently licensed, complete parcel dataset was found. |
| Glens, registered trees and ramblage land (`glens-and-trees`) | medium | These were government map layers (22 glens, 1,199 registered trees, 7 ramblage records) and are removed because that data is not openly licensed. Partial coverage may exist in OpenStreetMap or as National Trust land but was not sufficient to rebuild the official datasets. |
| Public rights of way and footpaths (`prow-network`) | high | The PROW, footpath, promoted-walking, cycle and pilgrimage route layers were all government mapping services and are removed. The definitive PROW map is maintained by the Department of Infrastructure in Central Registry and is not open in any reusable form. |
| Bus route alignments (`bus-route-alignments`) | medium | The previous bus-routes layer was a 2015 government network and is removed. OSM bus route relations exist but only a fraction of stops are members, and the alignments were not extracted into a comparable layer. |
| TT and Billown course infrastructure (`tt-course`) | low | The previous layer was a government 'MotorCourse' service and is removed. No open, licensed alignment is published; the widely quoted 37.73 mile length is Wikipedia-only with no official linear referencing. |
| Coastal access points (`coastal-access`) | low | This was a government map layer (40 points) and is removed because it is not openly licensed. No independently licensed equivalent was found. |
| Marine habitats and fishery closures (`marine-habitats`) | medium | This was a government map layer (434 features) and is removed because it is not openly licensed. Some layers of this type exist in EMODnet (CC-BY 4.0) but no ingest has been built for them yet. |
