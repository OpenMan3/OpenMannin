"use client";

/**
 * Measure readout: the running distance, enclosed area and vertex count for
 * the points collected by the measure tool, with Undo and Clear.
 *
 * Purely presentational - it is handed a summary computed by
 * `summarizeMeasure` (src/lib/measure.ts) and relays intent back up. Distances
 * use the app's imperial boundary (src/lib/units.ts); area is shown in m² until
 * it is worth reading in acres, matching the island's own land units.
 */

import type { MeasureSummary } from "@/lib/measure";
import { formatDistance } from "@/lib/units";
import { t } from "@/lib/i18n";
import { CloseIcon, RulerIcon } from "./Icons";

const M2_PER_ACRE = 4046.8564224;

/** A small area reads better in m²; anything larger, in acres. */
function formatArea(m2: number): string {
  if (m2 < M2_PER_ACRE) return `${Math.round(m2)} m²`;
  const acres = m2 / M2_PER_ACRE;
  return `${acres >= 100 ? acres.toFixed(0) : acres.toFixed(1)} ac`;
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="label">{label}</span>
      <span className="tabular-nums text-sm font-semibold text-ink">{value}</span>
    </div>
  );
}

export function MeasurePanel({
  summary,
  active,
  onUndo,
  onClear,
  onStop,
  className,
}: {
  summary: MeasureSummary;
  active: boolean;
  onUndo: () => void;
  onClear: () => void;
  /** Stop measuring (keep the points); called by the close button. */
  onStop: () => void;
  className?: string;
}) {
  const { pointCount, totalM, areaM2 } = summary;
  const empty = pointCount === 0;

  return (
    <div className={className}>
      <div className="card-floating w-[min(22rem,calc(100vw-2rem))] overflow-hidden border border-line-soft">
        <div className="flex items-center gap-2 border-b border-line-soft px-3 py-2">
          <RulerIcon className="h-4 w-4 shrink-0 text-ink-2" />
          <span className="label flex-1">{t("measure.measure")}</span>
          <button
            type="button"
            onClick={onStop}
            aria-label={t("app.close")}
            title={t("app.close")}
            className="rounded-md p-1 text-ink-3 transition-colors hover:bg-raised hover:text-ink"
          >
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        </div>

        {empty ? (
          <p className="px-3 py-3 text-[12px] leading-snug text-ink-3">
            {active
              ? "Tap the map to drop points."
              : "Press the ruler to start measuring."}
          </p>
        ) : (
          <div className="flex items-end gap-5 px-3 py-2">
            <Readout label={t("measure.distance")} value={formatDistance(totalM)} />
            {areaM2 !== null && (
              <Readout label={t("measure.area")} value={formatArea(areaM2)} />
            )}
            <Readout label={t("measure.points")} value={String(pointCount)} />
          </div>
        )}

        <div className="flex gap-2 border-t border-line-soft px-3 py-2">
          <button
            type="button"
            className="btn flex-1 text-xs"
            onClick={onUndo}
            disabled={empty}
            aria-label={t("app.undo")}
          >
            {t("app.undo")}
          </button>
          <button
            type="button"
            className="btn flex-1 text-xs"
            onClick={onClear}
            disabled={empty}
            aria-label={t("app.clear")}
          >
            {t("app.clear")}
          </button>
        </div>
      </div>
    </div>
  );
}
