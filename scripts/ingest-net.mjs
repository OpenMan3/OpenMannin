/**
 * Ingest the Isle of Man ASN / IP-space index.
 *
 * Why this is not just "look up a few ASNs by hand":
 *
 * An earlier attempt assumed the Isle of Man had a handful of well-known
 * networks and guessed the numbers. Every guess was wrong. AS31421 and
 * AS205388 are unannounced or belong to unrelated holders; RIPEstat's
 * `country-asns` call, run without `lod`, returns only a count and reads as
 * "zero" if you are not careful, which is exactly the kind of quiet wrong
 * answer that ends up published.
 *
 * So: ask the RIR who is actually registered to country IM, then ask BGP what
 * they currently announce. Nothing here is guessed.
 *
 *   RIPEstat country-asns (lod=1)  -> the authoritative ASN set for IM
 *   RIPEstat as-overview           -> holder name, announcement status
 *   RIPEstat announced-prefixes    -> live BGP table, v4 + v6
 *
 * RIPE Database's own search API is deliberately not used. Its
 * `query-string` + `type-filter` combination rejects every attribute search
 * tried here with ERROR:115, including plain `country:GB`, so it is not a
 * usable discovery path. RIPEstat covers the same ground and answers.
 *
 * Output:
 *   public/data/networks.geojson    one Point per ASN, for the map
 *   public/data/prefix-index.json   compact index for the IP lookup tool
 *   public/data/_ingest-net-report.json
 *
 * Caveat carried into the UI: an ASN's *registered* country is IM, but its
 * announced prefixes are wherever the operator actually routes traffic. Those
 * are frequently not in the Isle of Man, and a point on the map marks the
 * operator, never the geolocation of a prefix.
 */

import { getJson, writeJSON, sleep } from "./lib/fetch.mjs";

const RIPESTAT = "https://stat.ripe.net/data";
const OUT_DIR = "public/data";

/**
 * Anchors we can justify from a registered address, not a guess.
 * Anything not listed falls back to Douglas town centre at grade C.
 */
const ANCHORS = {
  // RIPE organisation record: "Isle of Man Business Park, Cooil Rd, Braddan".
  // Coordinates are the Manx Utilities HQ building on that same Business Park.
  13122: { lon: -4.53358, lat: 54.15328, grade: "B", label: "Isle of Man Business Park, Braddan" },
};

const DOUGLAS = { lon: -4.4814, lat: 54.1509, grade: "C", label: "Douglas (approximate)" };

/** Pull ASN numbers out of RIPEstat's set notation, e.g. {AsnSingle(13122),AsnSingle(44481)}. */
function parseAsnSet(value) {
  if (typeof value !== "string") return [];
  return [...value.matchAll(/AsnSingle\((\d+)\)/g)].map((m) => Number(m[1]));
}

function addressCount(prefix) {
  const [addr, lenStr] = prefix.split("/");
  const len = Number(lenStr);
  if (!Number.isInteger(len)) return 0;
  if (addr.includes(":")) return 2 ** Math.max(0, 128 - len);
  return 2 ** Math.max(0, 32 - len);
}

async function fetchAsnList() {
  const url = `${RIPESTAT}/country-asns/data.json?resource=IM&lod=1`;
  const body = await getJson(url);
  const country = body?.data?.countries?.[0];
  if (!country) throw new Error(`country-asns returned no country block for IM`);

  const routed = parseAsnSet(country.routed);
  const nonRouted = parseAsnSet(country.non_routed);
  const registered = country?.stats?.registered ?? routed.length + nonRouted.length;

  if (!routed.length && !nonRouted.length) {
    // Guards against the "zero" trap that started this file.
    throw new Error(
      "RIPEstat returned no ASNs for IM. Refusing to write an empty index that " +
        "looks like a successful result.",
    );
  }

  return { routed, nonRouted, registered, queryTime: body?.data?.query_time ?? null };
}

async function fetchOverview(asn) {
  const body = await getJson(`${RIPESTAT}/as-overview/data.json?resource=AS${asn}`);
  const d = body?.data ?? {};
  return {
    holder: (d.holder || "").trim(),
    announced: d.announced === true,
    blockName: d?.block?.name ?? "",
    blockDesc: d?.block?.desc ?? "",
    blockResource: d?.block?.resource ?? "",
  };
}

/**
 * as-overview's `holder` field is the aut-num as-name glued to the holder name
 * ("MANX-AS Manx Telecom Trading Ltd"), which is ambiguous to split on spaces.
 * Ask the whois records for the real `as-name` key instead of guessing.
 */
async function fetchAsName(asn) {
  try {
    const body = await getJson(`${RIPESTAT}/whois/data.json?resource=AS${asn}`);
    const records = body?.data?.records ?? [];
    for (const group of records) {
      for (const r of group) {
        if (r.key === "asname" && r.value) return String(r.value).trim();
      }
    }
  } catch {
    // A missing aut-num is not fatal; as-overview's holder is still usable.
  }
  return "";
}

async function fetchAnnounced(asn) {
  try {
    const body = await getJson(`${RIPESTAT}/announced-prefixes/data.json?resource=AS${asn}`);
    const rows = body?.data?.prefixes ?? [];
    return rows.map((r) => r.prefix).filter(Boolean).sort();
  } catch (err) {
    if (err.message?.includes("HTTP 404")) return [];
    throw err;
  }
}

async function main() {
  const { routed, nonRouted, registered, queryTime } = await fetchAsnList();
  const asns = [...new Set([...routed, ...nonRouted])].sort((a, b) => a - b);
  const routedSet = new Set(routed);

  console.log(`IM registered ASNs: ${registered} (routed ${routed.length}, not routed ${nonRouted.length})`);

  const networks = [];
  const failures = [];

  for (const asn of asns) {
    let overview;
    try {
      overview = await fetchOverview(asn);
    } catch (err) {
      failures.push({ asn, stage: "as-overview", error: err.message });
      continue;
    }

    // Only ask BGP for prefixes where BGP says there are any.
    const prefixes = overview.announced ? await fetchAnnounced(asn) : [];
    const anchor = ANCHORS[asn] ?? DOUGLAS;

    const v4 = prefixes.filter((p) => !p.includes(":"));
    const v6 = prefixes.filter((p) => p.includes(":"));

    const asName = await fetchAsName(asn);

    networks.push({
      asn,
      asName,
      holder: overview.holder,
      routed: routedSet.has(asn),
      announced: overview.announced,
      prefixCount: prefixes.length,
      v4Count: v4.length,
      v6Count: v6.length,
      addressCount: prefixes.reduce((n, p) => n + addressCount(p), 0),
      prefixes,
      anchor: { lon: anchor.lon, lat: anchor.lat },
      anchorGrade: anchor.grade,
      anchorLabel: anchor.label,
      blockResource: overview.blockResource,
      blockName: overview.blockName,
      blockDesc: overview.blockDesc,
    });

    await sleep(120);
  }

  // --- networks.geojson: one marker per registered operator -----------------
  const fc = {
    type: "FeatureCollection",
    features: networks.map((n) => ({
      type: "Feature",
      id: n.asn,
      geometry: { type: "Point", coordinates: [n.anchor.lon, n.anchor.lat] },
      properties: {
        asn: n.asn,
        asName: n.asName,
        holder: n.holder,
        routed: n.routed,
        announced: n.announced,
        prefixCount: n.prefixCount,
        addressCount: n.addressCount,
        anchorGrade: n.anchorGrade,
        anchorLabel: n.anchorLabel,
        blockName: n.blockName,
        ripestat: `https://stat.ripe.net/data/as-overview/data.json?resource=AS${n.asn}`,
      },
    })),
  };

  // --- prefix-index.json: what the IP lookup tool reads ---------------------
  const index = {
    generated: new Date().toISOString(),
    country: "IM",
    ripestatQueryTime: queryTime,
    source: {
      name: "RIPEstat",
      url: "https://stat.ripe.net/",
      licence: "NO-LICENCE",
      note: "RIPE NCC data is free to use with attribution; no formal open licence is published for RIPEstat output.",
    },
    registeredAsnCount: registered,
    networkCount: networks.length,
    networks: networks
      .filter((n) => n.prefixCount > 0)
      .map((n) => ({
        asn: n.asn,
        holder: n.holder,
        asName: n.asName,
        routed: n.routed,
        prefixCount: n.prefixCount,
        prefixes: n.prefixes,
      })),
    unannounced: networks
      .filter((n) => n.prefixCount === 0)
      .map((n) => ({ asn: n.asn, holder: n.holder, routed: n.routed })),
  };

  const bytesFc = writeJSON(`${OUT_DIR}/networks.geojson`, fc);
  const bytesIdx = writeJSON(`${OUT_DIR}/prefix-index.json`, index);

  const routedNetworks = networks.filter((n) => n.routed);
  const totalPrefixes = networks.reduce((s, n) => s + n.prefixCount, 0);
  const totalV4 = networks.reduce((s, n) => s + n.v4Count, 0);
  const totalV6 = networks.reduce((s, n) => s + n.v6Count, 0);

  writeJSON(
    `${OUT_DIR}/_ingest-net-report.json`,
    {
      generated: index.generated,
      ripestatQueryTime: queryTime,
      registeredAsns: registered,
      networksWritten: networks.length,
      routedNetworks: routedNetworks.length,
      totalPrefixes,
      totalV4Prefixes: totalV4,
      totalV6Prefixes: totalV6,
      networks: networks.map((n) => ({
        asn: n.asn,
        holder: n.holder,
        routed: n.routed,
        announced: n.announced,
        prefixes: n.prefixCount,
        anchorGrade: n.anchorGrade,
      })),
      failures,
      caveats: [
        "ASN country of registration is IM; announced prefixes are wherever the operator routes, often outside the Isle of Man.",
        "Map markers show the operator anchor, not the location of any prefix or subscriber.",
        `${networks.length - Object.keys(ANCHORS).length} markers use a Douglas town-centre fallback anchor at grade C because no registered street address was available.`,
      ],
      bytes: { "networks.geojson": bytesFc, "prefix-index.json": bytesIdx },
    },
    { pretty: true },
  );

  console.log(`  networks.geojson    ${networks.length} markers, ${(bytesFc / 1024).toFixed(1)} KB`);
  console.log(`  prefix-index.json   ${index.networks.length} with prefixes, ${(bytesIdx / 1024).toFixed(1)} KB`);
  console.log(`  prefixes            ${totalPrefixes} (v4 ${totalV4}, v6 ${totalV6})`);
  console.log(`  failures            ${failures.length}`);
  for (const n of routedNetworks.filter((x) => x.prefixCount > 0)) {
    console.log(`    AS${String(n.asn).padEnd(7)} ${n.holder.slice(0, 42).padEnd(42)} ${n.prefixCount}`);
  }
}

main().catch((err) => {
  console.error("ingest-net failed:", err.message);
  process.exitCode = 1;
});