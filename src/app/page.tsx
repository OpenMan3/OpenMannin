"use client";

import { useCallback, useState } from "react";
import { GAPS, LAYERS } from "@/lib/layers";
import { MapView, type BasemapId, type PickedFeature } from "@/components/MapView";
import { LayerPanel } from "@/components/LayerPanel";
import { FeaturePopup } from "@/components/FeaturePopup";
import { FeatureBrowser } from "@/components/FeatureBrowser";
import { GapsPanel } from "@/components/GapsPanel";
import { PostcodeLookup } from "@/components/PostcodeLookup";

type Tab = "layers" | "browse" | "postcodes" | "gaps";

const TABS: { id: Tab; label: string }[] = [
  { id: "layers", label: "Layers" },
  { id: "browse", label: "Browse" },
  { id: "postcodes", label: "Postcodes" },
  { id: "gaps", label: "Gaps" },
];

export default function Page() {
  const [tab, setTab] = useState<Tab>("layers");
  const [picked, setPicked] = useState<PickedFeature | null>(null);
  const [basemap, setBasemap] = useState<BasemapId>("esri");
  const [panelOpen, setPanelOpen] = useState(true);
  // Layers the registry lists but public/data does not have; populated by the map
  // as each failed fetch surfaces.
  const [missing, setMissing] = useState<Set<string>>(new Set());
  // Live layers that are on but failing, so the panel can badge them.
  const [feedErrors, setFeedErrors] = useState<Record<string, string>>({});

  // Start from whatever the registry marked defaultOn.
  //
  // Live layers are off by default except the two that genuinely work:
  // weather (Open-Meteo, CORS *, keyless), and - off by default but wired the
  // same way - satellite passes (public-domain TLEs + SGP4 in a worker).
  // OpenSky, AISStream and FindMyBus are on hold pending data agreements:
  // polling is disabled and they badge as such in the panel.
  const [enabled, setEnabled] = useState<Set<string>>(
    () => new Set(LAYERS.filter((l) => l.defaultOn).map((l) => l.id)),
  );

  const toggle = useCallback((id: string) => {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // The feature browser turns a layer on so its features are visible while it
  // is being stepped through (a footprint you cannot see is still hard to find
  // even when the map has flown to it).
  const ensureEnabled = useCallback((id: string) => {
    setEnabled((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);

  const onMissing = useCallback((next: Set<string>) => setMissing(next), []);
  const onFeedErrors = useCallback((next: Record<string, string>) => setFeedErrors(next), []);

  const centreOn = useCallback((lon: number, lat: number) => {
    window.dispatchEvent(
      new CustomEvent("openmannin:fly-to", { detail: { lon, lat } }),
    );
  }, []);

  return (
    <main className="flex h-dvh w-full overflow-hidden bg-[#0b0f14]">
      {/* ---- sidebar ---- */}
      <aside
        className={`flex shrink-0 flex-col border-r border-[#1e2a35] bg-[#0b0f14] transition-[width] ${
          panelOpen ? "w-80" : "w-11"
        }`}
      >
        <div className="flex items-center gap-2 border-b border-[#1e2a35] px-3 py-2">
          <button
            type="button"
            onClick={() => setPanelOpen((v) => !v)}
            aria-label={panelOpen ? "Collapse panel" : "Expand panel"}
            className="shrink-0 px-1 text-xs text-[#6b7f8c] hover:text-[#d7e3ec]"
          >
            {panelOpen ? "⟨" : "⟩"}
          </button>
          {panelOpen && (
            <div className="min-w-0">
              <div className="truncate text-sm font-bold tracking-tight">
                Open<span className="text-[#35c9d4]">Mannin</span>
              </div>
              <div className="truncate text-[10px] text-[#7d8f9d]">
                Isle of Man infrastructure map
              </div>
            </div>
          )}
        </div>

        {panelOpen && (
          <>
            <nav className="flex shrink-0 border-b border-[#1e2a35]">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`flex-1 px-1 py-2 text-[11px] font-medium transition-colors ${
                    tab === t.id
                      ? "border-b-2 border-[#35c9d4] text-[#35c9d4]"
                      : "text-[#7d8f9d] hover:text-[#d7e3ec]"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </nav>

            <div className="min-h-0 flex-1">
              {tab === "layers" && (
                <LayerPanel
                  layers={LAYERS}
                  enabled={enabled}
                  missing={missing}
                  feedErrors={feedErrors}
                  onToggle={toggle}
                />
              )}
              {tab === "browse" && (
                <FeatureBrowser
                  layers={LAYERS}
                  enabled={enabled}
                  onEnsureEnabled={ensureEnabled}
                  onLocate={centreOn}
                />
              )}
              {tab === "postcodes" && <PostcodeLookup onLocate={centreOn} />}
              {tab === "gaps" && <GapsPanel gaps={GAPS} />}
            </div>

            <div className="shrink-0 border-t border-[#1e2a35] px-3 py-2">
              <label className="flex items-center justify-between gap-2 text-[11px] text-[#7d8f9d]">
                Basemap
                <select
                  value={basemap}
                  onChange={(e) => setBasemap(e.target.value as BasemapId)}
                  className="rounded border border-[#1e2a35] bg-[#0d141a] px-1.5 py-1 text-[11px] text-[#d7e3ec] focus:border-[#35c9d4] focus:outline-none"
                >
                  <option value="esri">Esri satellite</option>
                  <option value="opentopo">OpenTopoMap</option>
                </select>
              </label>
              <p className="mt-1 text-[10px] leading-snug text-[#6b7f8c]">
                Esri is keyless and zooms to z19 but its terms are the least certain licence here.
              </p>
            </div>
          </>
        )}
      </aside>

      {/* ---- map ---- */}
      <section className="relative min-w-0 flex-1">
        <MapView
          layers={LAYERS}
          enabled={enabled}
          basemap={basemap}
          onPick={setPicked}
          onMissing={onMissing}
          onFeedErrors={onFeedErrors}
        />

        <FeaturePopup picked={picked} onClose={() => setPicked(null)} onLocate={centreOn} />

        <div className="pointer-events-none absolute right-3 bottom-3 z-10 max-w-[min(24rem,50vw)] rounded border border-[#1e2a35] bg-[#0b0f14]/90 px-2 py-1.5 text-[10px] leading-snug text-[#7d8f9d] backdrop-blur">
          Every layer carries a source, a licence and a confidence grade. Check the &ldquo;i&rdquo;
          on any layer, and see the Gaps tab for what is deliberately absent.
        </div>
      </section>
    </main>
  );
}