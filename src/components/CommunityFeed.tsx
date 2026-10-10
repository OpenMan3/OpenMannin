"use client";

/**
 * Community intelligence feed — a terminal-style log of what the OSM crowd
 * changed in the island over the last 24 hours, ODbL.
 *
 * No open news or notice-board feed exists for this island (gov.im's site is
 * WAF-walled, Manx Radio publishes no licence, and RSS itself sends no CORS
 * headers), so this panel shows the one genuinely open and continuously
 * refreshed island-scoped signal instead: recent OpenStreetMap edits inside
 * the Isle of Man bounding box, newest first, each linking back to the
 * object. It is not verified against a ground truth — it is the crowd.
 *
 * The tab bar hosts it inside "Sources" as the embedded "Recent OpenStreetMap
 * Activity" section; it can also stand alone as a full-height panel.
 */

import { useEffect, useState } from "react";
import {
  fetchCommunity,
  COMMUNITY_POLL_MS,
  type CommunityResult,
} from "@/lib/feeds/community-client";

export function CommunityFeed({ embedded = false }: { embedded?: boolean }) {
  const [result, setResult] = useState<CommunityResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const r = await fetchCommunity();
      if (!cancelled) setResult(r);
    }
    void load();
    const t = setInterval(load, COMMUNITY_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  if (embedded) {
    return (
      <section className="border-t border-line-soft px-3 py-2.5">
        <h3 className="label mb-2">Recent OpenStreetMap Activity</h3>
        {result?.failure && (
          <div className="mb-2 rounded-md border border-danger/30 bg-danger/5 p-2.5 font-mono text-[12px] text-danger">
            {result.failure}
          </div>
        )}
        <div className="space-y-1.5 font-mono text-[11px]">
          {result?.items.map((item) => (
            <div key={item.ref + item.timestamp} className="flex gap-2">
              <span className="shrink-0 text-accent">[{item.stamp ?? "—"}]</span>
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 flex-1 break-words text-ink-2 hover:text-ink hover:underline"
              >
                {item.ref} — {item.headline} · by {item.user}
              </a>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-snug text-ink-3">
          OpenStreetMap edits in the Isle of Man, refreshed every 5 min via the public Overpass
          API (ODbL) — what the crowd mapped recently, not verified ground truth.
        </p>
      </section>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-line px-3 py-2.5">
        <h2 className="text-sm font-semibold text-ink">Community feed</h2>
        <p className="mt-1 text-[12px] leading-snug text-ink-3">
          {result?.feedTitle ?? "OpenStreetMap edits · Isle of Man"} · refreshed every 5 min
        </p>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {result?.failure && (
          <div className="mb-2 rounded-md border border-danger/30 bg-danger/5 p-2.5 font-mono text-[12px] text-danger">
            {result.failure}
          </div>
        )}
        <div className="space-y-1.5 font-mono text-[11px]">
          {result?.items.map((item) => (
            <div key={item.ref + item.timestamp} className="flex gap-2">
              <span className="shrink-0 text-accent">[{item.stamp ?? "—"}]</span>
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 flex-1 break-words text-ink-2 hover:text-ink hover:underline"
              >
                {item.ref} — {item.headline} · by {item.user}
              </a>
            </div>
          ))}
        </div>
      </div>

      <div className="shrink-0 border-t border-line px-3 py-2 text-[11px] leading-snug text-ink-3">
        <p>
          Source: OpenStreetMap (ODbL), via the public Overpass API — what the crowd mapped
          recently, not verified ground truth. No official open notice-board feed exists for
          &ldquo;the community&rdquo; on this island; this is the closest open signal.
        </p>
      </div>
    </div>
  );
}