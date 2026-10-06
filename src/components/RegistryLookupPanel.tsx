"use client";

/**
 * Companies Registry lookup.
 *
 * This builds a link to the official search and nothing else. It does not fetch
 * company records, hold a dataset, or proxy the Registry. That is not a
 * limitation we should engineer around:
 *
 *   - filed documents, accounts and confirmation statements are behind an
 *     account and payment;
 *   - registered director and secretary details are likewise gated;
 *   - robots.txt is served by an F5 WAF that rejects non-browser clients, so
 *     crawl permission cannot even be established.
 *
 * Linking keeps the user in control of what they look at and inside the terms.
 * Mirroring the free fields would put a Crown-copyright database copy on this
 * site for no benefit.
 */

import { useState } from "react";
import {
  CENTRAL_REGISTRY_URL,
  FSA_REGISTERS_URL,
  registryLookup,
  type RegistryLookup,
} from "@/lib/company-registry";

const EXAMPLES = [
  { label: "Manx Telecom Trading Ltd", value: "Manx Telecom" },
  { label: "by number (005629V)", value: "005629V" },
];

export function RegistryLookupPanel() {
  const [value, setValue] = useState("");
  const [result, setResult] = useState<RegistryLookup | null>(null);

  const submit = (raw: string) => {
    setValue(raw);
    setResult(registryLookup(raw));
  };

  return (
    <div className="space-y-3 p-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(value);
        }}
        className="flex gap-1.5"
      >
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          required
          placeholder="company name or number, e.g. 005629V"
          aria-label="Company name or number"
          className="min-w-0 flex-1 rounded border border-[#1e2a35] bg-[#0b0f14] px-2 py-1.5 text-xs text-[#d7e3ec] placeholder:text-[#7d8f9d] focus:border-[#35c9d4] focus:outline-none"
        />
        <button
          type="submit"
          className="rounded bg-[#35c9d4] px-3 py-1.5 text-xs font-semibold text-[#06121a]"
        >
          Search
        </button>
      </form>

      <div className="flex flex-wrap gap-1">
        {EXAMPLES.map((ex) => (
          <button
            key={ex.value}
            type="button"
            onClick={() => submit(ex.value)}
            className="rounded border border-[#1e2a35] px-1.5 py-0.5 text-[10px] text-[#7d8f9d] hover:border-[#35c9d4] hover:text-[#35c9d4]"
          >
            {ex.label}
          </button>
        ))}
      </div>

      {result && (
        <div className="space-y-2 rounded border border-[#1e2a35] bg-[#0d141a] p-2 text-xs">
          <a
            href={result.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block break-all rounded bg-[#12283a] p-2 text-[#35c9d4] hover:underline"
          >
            Search the official register for &ldquo;{result.input}&rdquo; ↗
          </a>

          <div className="text-[#7d8f9d]">
            Searching by {result.mode === "number" ? "company number" : "name"}
            {result.mode === "number" && !result.recognisedNumber && (
              <span className="text-[#fbbf24]">
                {" "}
                — that is not a valid IoM company number, which is six digits and a letter. The
                Registry will return nothing.
              </span>
            )}
          </div>

          <div>
            <div className="mb-1 font-semibold text-[#34d399]">Free, no account needed</div>
            <ul className="list-disc space-y-0.5 pl-4 text-[#9fb0bd]">
              {result.freeFields.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>

          <div>
            <div className="mb-1 font-semibold text-[#fbbf24]">Requires an account and payment</div>
            <ul className="list-disc space-y-0.5 pl-4 text-[#9fb0bd]">
              {result.gatedFields.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="space-y-1 border-t border-[#1e2a35] pt-2 text-[11px] leading-relaxed text-[#7d8f9d]">
        <p>
          We link rather than scrape. No company data is copied, cached or republished here, so
          nothing on this page depends on the Registry changing or withdrawing access.
        </p>
        <p className="flex flex-wrap gap-x-3">
          <a
            href={CENTRAL_REGISTRY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#35c9d4] hover:underline"
          >
            Newer central registry portal ↗
          </a>
          <a
            href={FSA_REGISTERS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#35c9d4] hover:underline"
          >
            FSA regulated-entity registers ↗
          </a>
        </p>
        <p className="text-[#7d8f9d]">
          A company in the Registry is not necessarily regulated, and an FSA-regulated entity is
          not necessarily an incorporated company. They are separate registers.
        </p>
      </div>
    </div>
  );
}