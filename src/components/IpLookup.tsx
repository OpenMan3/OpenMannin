"use client";

/**
 * IP to Isle of Man network lookup.
 *
 * Runs entirely client-side against /data/prefix-index.json using the
 * longest-prefix-match in src/lib/ip-lookup.ts. There is no API route and no
 * server round trip: the index is a few kilobytes, so there is nothing to gain
 * from proxying it and a visitor's query never leaves the browser. That is a
 * deliberate privacy property, not an optimisation.
 */

import { useEffect, useMemo, useState } from "react";
import {
  lookup,
  addressCount,
  networkLabel,
  type PrefixIndex,
  type PrefixEntry,
} from "@/lib/ip-lookup";

const SAMPLES = ["195.10.105.1", "2a01:6a00::1", "89.107.0.1", "8.8.8.8"];

export function IpLookup() {
  const [index, setIndex] = useState<PrefixIndex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/data/prefix-index.json");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as PrefixIndex;
        if (!cancelled) setIndex(json);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "failed to load index");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const result = useMemo(() => {
    if (!index || !submitted) return null;
    return lookup(index, submitted);
  }, [index, submitted]);

  if (error) {
    return <p className="p-3 text-xs text-[#f87171]">Could not load the prefix index: {error}</p>;
  }

  return (
    <div className="space-y-3 p-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(query.trim());
        }}
        className="flex gap-1.5"
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="195.10.105.1 or 2a01:6a00::1"
          aria-label="IP address or CIDR"
          className="min-w-0 flex-1 rounded border border-[#1e2a35] bg-[#0b0f14] px-2 py-1.5 font-mono text-xs text-[#d7e3ec] placeholder:text-[#6b7f8c] focus:border-[#35c9d4] focus:outline-none"
        />
        <button
          type="submit"
          disabled={!index}
          className="rounded bg-[#35c9d4] px-3 py-1.5 text-xs font-semibold text-[#06121a] disabled:opacity-40"
        >
          Look up
        </button>
      </form>

      <div className="flex flex-wrap gap-1">
        {SAMPLES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              setQuery(s);
              setSubmitted(s);
            }}
            className="rounded border border-[#1e2a35] px-1.5 py-0.5 font-mono text-[10px] text-[#7d8f9d] hover:border-[#35c9d4] hover:text-[#35c9d4]"
          >
            {s}
          </button>
        ))}
      </div>

      {result && !result.found && (
        <div className="rounded border border-[#3a2a12] bg-[#1a1408] p-2 text-xs">
          <span className="font-mono text-[#d7e3ec]">{result.addressText}</span> — {result.reason}
        </div>
      )}

      {result?.found && result.entry && (
        <div className="space-y-2 rounded border border-[#1e2a35] bg-[#0d141a] p-2 text-xs">
          <div>
            <span className="text-[#7d8f9d]">Address </span>
            <span className="font-mono text-[#d7e3ec]">{result.addressText}</span>
          </div>
          <div>
            <span className="text-[#7d8f9d]">Operator </span>
            <span className="text-[#d7e3ec]">{networkLabel(result.entry.network)}</span>
          </div>
          <div>
            <span className="text-[#7d8f9d]">ASN </span>
            <a
              href={`https://stat.ripe.net/data/as-overview/data.json?resource=AS${result.entry.network.asn}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[#35c9d4] hover:underline"
            >
              AS{result.entry.network.asn}
            </a>
            {result.entry.network.routed ? null : (
              <span className="ml-1 text-[#fbbf24]">(not routed)</span>
            )}
          </div>
          <div>
            <span className="text-[#7d8f9d]">Prefix </span>
            <span className="font-mono text-[#d7e3ec]">{result.entry.cidr}</span>
            <span className="ml-1 text-[#7d8f9d]">
              ({addressCount(result.entry).toLocaleString()} addresses)
            </span>
          </div>

          {result.allMatches.length > 1 && (
            <div>
              <span className="text-[#7d8f9d]">
                {result.allMatches.length} IoM prefixes contain this address:
              </span>
              <ul className="mt-1 space-y-0.5">
                {result.allMatches.slice(0, 6).map((e: PrefixEntry) => (
                  <li key={e.cidr} className="font-mono text-[11px] text-[#9fb0bd]">
                    {e.cidr} <span className="text-[#6b7f8c]">AS{e.network.asn}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {index && (
        <div className="space-y-1 border-t border-[#1e2a35] pt-2 text-[11px] leading-relaxed text-[#7d8f9d]">
          <p>
            {index.registeredAsnCount} ASNs are registered to country IM;{" "}
            {index.networks.length} of them announce {countPrefixes(index)} prefixes.
          </p>
          <p>
            This answers which Isle of Man registered operator announces a prefix containing an
            address. It does not geolocate the address or identify a subscriber, and your query is
            not sent anywhere.
          </p>
          {index.unannounced.length > 0 && (
            <p>
              {index.unannounced.length} registered ASNs announce nothing and appear on the map
              without an address space.
            </p>
          )}
          <p className="text-[#6b7f8c]">Data: RIPEstat, {index.ripestatQueryTime ?? "unknown"}.</p>
        </div>
      )}
    </div>
  );
}

function countPrefixes(index: PrefixIndex): number {
  return index.networks.reduce((n, x) => n + x.prefixes.length, 0);
}