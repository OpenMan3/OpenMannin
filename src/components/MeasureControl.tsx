"use client";

/**
 * Measure-mode toggle, docked with the other map controls.
 *
 * A dumb switch: it owns no points and computes nothing. Arming it puts the
 * map into measure mode (MapView routes clicks to vertices instead of feature
 * picks); the collected points and the readout live in MeasurePanel. The accent
 * fill mirrors the measure line's colour so the button and the drawing read as
 * one tool.
 */

import { RulerIcon } from "./Icons";
import { t } from "@/lib/i18n";
import { useLang } from "@/lib/use-lang";

export function MeasureControl({
  active,
  onToggle,
  className,
}: {
  active: boolean;
  onToggle: () => void;
  className?: string;
}) {
  useLang();
  const label = t("measure.measure");
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      aria-label={label}
      title={active ? `${label} — on` : `${label} — off`}
      className={`btn-icon transition-colors ${
        active ? "border-accent bg-accent/15 text-accent" : ""
      } ${className ?? ""}`}
    >
      <RulerIcon className="h-5 w-5" />
    </button>
  );
}
