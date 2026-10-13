import type { Licence, LicenceId } from "./types";

/**
 * Licence register.
 *
 * `requiresPermission: true` means the data is technically reachable but the
 * terms do not clearly grant us the use we need. Those layers render with a
 * hard warning badge in the UI rather than being silently presented as free.
 */
export const LICENCES: Record<LicenceId, Licence> = {
  "OGL-IoM": {
    id: "OGL-IoM",
    name: "Isle of Man Open Government Licence",
    url: "https://www.gov.im/about-this-site/open-government-licence/",
    commercial: true,
    requiresPermission: false,
    obligation: "Attribution to Crown copyright / Isle of Man Government. Excludes personal data, departmental logos and the Isle of Man crest.",
  },
  "OGL-IoM-DERIVED": {
    id: "OGL-IoM-DERIVED",
    name: "Crown copyright — derived open datasets (base mapping NOT included)",
    url: "https://www.gov.im/about-this-site/open-government-licence/",
    commercial: true,
    requiresPermission: false,
    obligation:
      "Crown copyright, attribution required. CRITICAL EXCLUSION: this covers the derived feature services published through the open data portal only. It does NOT cover the Isle of Man Survey base cartography, which is Crown copyright but explicitly excluded from the OGL and sold commercially. Never mix our vectors with their base tiles without a licence. Also excluded: personal data, departmental logos, the Isle of Man crest, third-party rights, patents, trademarks and designs.",
  },
  ODbL: {
    id: "ODbL",
    name: "Open Database License (OpenStreetMap)",
    url: "https://opendatacommons.org/licenses/odbl/",
    commercial: true,
    requiresPermission: false,
    obligation: "Attribution AND share-alike on derived databases. OSM data is (c) OpenStreetMap contributors.",
  },
  "CC-BY-4.0": {
    id: "CC-BY-4.0",
    name: "Creative Commons Attribution 4.0",
    url: "https://creativecommons.org/licenses/by/4.0/",
    commercial: true,
    requiresPermission: false,
    obligation: "Attribution with link to licence.",
  },
  "CC-BY-SA-2.0": {
    id: "CC-BY-SA-2.0",
    name: "Creative Commons Attribution-ShareAlike 2.0",
    url: "https://creativecommons.org/licenses/by-sa/2.0/",
    commercial: true,
    requiresPermission: false,
    obligation:
      "Attribution to the creator and ShareAlike: a derivative must carry the same licence. OpenSeaMap's rendered seamark tiles use this; the underlying data is OpenStreetMap (ODbL).",
  },
  "PUBLIC-DOMAIN": {
    id: "PUBLIC-DOMAIN",
    name: "Public domain / no known copyright",
    commercial: true,
    requiresPermission: false,
    obligation: "Attribution appreciated, not required.",
  },
  "CC0-1.0": {
    id: "CC0-1.0",
    name: "Creative Commons CC0 1.0 (public domain dedication)",
    url: "https://creativecommons.org/publicdomain/zero/1.0/",
    commercial: true,
    requiresPermission: false,
    obligation: "No rights reserved. Attribution optional.",
  },
  "PD-OURAIRPORTS": {
    id: "PD-OURAIRPORTS",
    name: "OurAirports public domain dedication",
    url: "https://ourairports.com/data/",
    commercial: true,
    requiresPermission: false,
    obligation:
      "OurAirports publishes its airport, runway and heliport tables under a public domain dedication. No attribution required, though crediting OurAirports is appreciated. Note this covers the DATA, not the website's own compiled map styling.",
  },
  COPERNICUS: {
    id: "COPERNICUS",
    name: "Copernicus / ESA open data",
    url: "https://www.copernicus.eu/en/access-data/copyright-and-licences",
    commercial: true,
    requiresPermission: false,
    obligation: "Free and full open. Attribution to Copernicus/ESA appreciated.",
  },

  "CDLA-PERMISSIVE-2.0": {
    id: "CDLA-PERMISSIVE-2.0",
    name: "Community Data License Agreement Permissive 2.0",
    url: "https://cdla.dev/permissive-2-0/",
    commercial: true,
    requiresPermission: false,
    obligation:
      "Attribution to the Overture release contributors that supplied the data. No share-alike. Verify per-record source datasets in the ingest output.",
  },
  "APACHE-2.0": {
    id: "APACHE-2.0",
    name: "Apache License 2.0",
    url: "https://www.apache.org/licenses/LICENSE-2.0",
    commercial: true,
    requiresPermission: false,
    obligation: "Copyright and licence notice plus any NOTICE file contents where present.",
  },
  "NO-LICENCE": {
    id: "NO-LICENCE",
    name: "No published licence",
    commercial: false,
    requiresPermission: true,
    obligation:
      "No terms of use, robots.txt or licence found. Absence of a licence is not a grant. Do not republish without written permission.",
  },
  UNKNOWN: {
    id: "UNKNOWN",
    name: "Licence not established",
    commercial: false,
    requiresPermission: true,
    obligation: "Verify before use.",
  },
};

export const licence = (id: LicenceId): Licence => LICENCES[id];