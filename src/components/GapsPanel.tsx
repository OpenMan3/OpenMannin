"use client";

/**
 * Documented gaps.
 *
 * A map that only shows what it has is quietly misleading. This panel states
 * what is missing, why, and what it would take to get it — so a reader can tell
 * the difference between "there is nothing there" and "we could not get it".
 */

import type { Gap } from "@/lib/types";

const SEVERITY = {
  high: { label: "high", className: "bg-[#3a1414] text-[#f87171]" },
  medium: { label: "medium", className: "bg-[#3a2a12] text-[#fbbf24]" },
  low: { label: "low", className: "bg-[#16232e] text-[#7d8f9d]" },
} as const;

export function GapsPanel({ gaps }: { gaps: Gap[] }) {
  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="border-b border-[#1e2a35] px-3 py-2">
        <h2 className="text-sm font-semibold">What is not on this map</h2>
        <p className="mt-1 text-[11px] leading-snug text-[#7d8f9d]">
          {gaps.length} things a reader might reasonably expect, and the honest reason for each.
        </p>
      </div>

      {gaps.map((gap) => {
        const sev = SEVERITY[gap.severity];
        return (
          <details key={gap.id} data-gap={gap.id} className="group border-b border-[#131b23]">
            <summary className="flex cursor-pointer list-none items-start gap-2 px-3 py-2 hover:bg-[#0d141a]">
              <span className="flex-1 text-[13px] text-[#d7e3ec]">{gap.title}</span>
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${sev.className}`}>
                {sev.label}
              </span>
            </summary>

            <div className="space-y-2 px-3 pb-3 pl-5 text-[11px] leading-relaxed text-[#9fb0bd]">
              <div>
                <span className="text-[#7d8f9d]">Wanted: </span>
                {gap.wanted}
              </div>
              <div>
                <span className="text-[#7d8f9d]">Why not: </span>
                {gap.whyUnavailable}
              </div>
              <div>
                <span className="text-[#7d8f9d]">What would fix it: </span>
                {gap.whatWeWouldNeed}
              </div>
              {gap.contact && (
                <div>
                  <span className="text-[#7d8f9d]">Ask: </span>
                  <a
                    href={`mailto:${gap.contact}`}
                    className="text-[#35c9d4] hover:underline"
                  >
                    {gap.contact}
                  </a>
                </div>
              )}
            </div>
          </details>
        );
      })}
    </div>
  );
}