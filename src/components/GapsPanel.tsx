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
  high: { label: "high", className: "bg-danger/10 text-danger" },
  medium: { label: "medium", className: "bg-warn/10 text-warn" },
  low: { label: "low", className: "bg-raised text-ink-3" },
} as const;

export function GapsPanel({ gaps }: { gaps: Gap[] }) {
  return (
    <div className="scroll-thin h-full overflow-y-auto md:pb-16">
      <div className="border-b border-line px-3 py-2.5">
        <h2 className="text-sm font-semibold text-ink">What is not on this map</h2>
        <p className="mt-1 text-[12px] leading-snug text-ink-3">
          {gaps.length} things a reader might reasonably expect, and the honest reason for each.
        </p>
      </div>

      {gaps.map((gap) => {
        const sev = SEVERITY[gap.severity];
        return (
          <details key={gap.id} data-gap={gap.id} className="group border-b border-line-soft">
            <summary className="flex cursor-pointer list-none items-start gap-2 px-3 py-2.5 hover:bg-raised/50">
              <span className="flex-1 text-[13px] text-ink">{gap.title}</span>
              <span className={`chip shrink-0 ${sev.className}`}>{sev.label}</span>
            </summary>

            <div className="space-y-2 px-3 pb-3 text-[12px] leading-relaxed text-ink-2">
              <div>
                <span className="text-ink-3">Wanted: </span>
                {gap.wanted}
              </div>
              <div>
                <span className="text-ink-3">Why not: </span>
                {gap.whyUnavailable}
              </div>
              <div>
                <span className="text-ink-3">What would fix it: </span>
                {gap.whatWeWouldNeed}
              </div>
              {gap.contact && (
                <div>
                  <span className="text-ink-3">Ask: </span>
                  <a href={`mailto:${gap.contact}`} className="link">
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