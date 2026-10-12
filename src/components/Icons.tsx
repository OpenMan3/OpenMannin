"use client";

/**
 * Shared inline SVG icons. Keeping them here (rather than a dependency) keeps
 * the bundle dependency-free and matches the app's zero-runtime-UX-library
 * stance. All icons draw with `currentColor` so they inherit text colour from
 * whatever button/label hosts them.
 */

import type { ManeuverKind } from "@/lib/navigation/steps";

type IconProps = { className?: string };

function base(props: IconProps, children: React.ReactNode, size = 24) {
  const { className } = props;
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function MenuIcon(props: IconProps) {
  return base(props, (
    <>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </>
  ));
}

export function CloseIcon(props: IconProps) {
  return base(props, (
    <>
      <path d="M6 6l12 12M18 6L6 18" />
    </>
  ));
}

export function SearchIcon(props: IconProps) {
  return base(props, (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-3.8-3.8" />
    </>
  ));
}

export function LayersIcon(props: IconProps) {
  return base(props, (
    <>
      <path d="M12 3l9 5-9 5-9-5 9-5z" />
      <path d="M3 13l9 5 9-5" />
      <path d="M3 17.5l9 5 9-5" />
    </>
  ));
}

export function TerrainIcon(props: IconProps) {
  return base(props, (
    <>
      <path d="M3 19.5l6-11 4 6.5 2.5-3.5 5.5 8z" />
      <path d="M3 19.5h18" />
    </>
  ));
}

export function ListIcon(props: IconProps) {
  return base(props, (
    <>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <path d="M4 6h.01M4 12h.01M4 18h.01" />
    </>
  ));
}

export function AlertIcon(props: IconProps) {
  return base(props, (
    <>
      <path d="M12 4l9 16H3l9-16z" />
      <path d="M12 10v4M12 17.4h.01" />
    </>
  ));
}

export function ActivityIcon(props: IconProps) {
  return base(props, (
    <>
      <path d="M3 12h4l2.5-7 5 14 2.5-7H21" />
    </>
  ));
}

export function ShieldIcon(props: IconProps) {
  return base(props, (
    <>
      <path d="M12 3l7 3v5c0 4.6-3 8.4-7 10-4-1.6-7-5.4-7-10V6l7-3z" />
      <path d="M9.5 12l1.8 1.8L14.8 10" />
    </>
  ));
}

export function CarIcon(props: IconProps) {
  return base(props, (
    <>
      <path d="M5 11l1.5-4.2A2 2 0 0 1 8.4 5.5h7.2a2 2 0 0 1 1.9 1.3L19 11" />
      <path d="M4 11h16a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-1.2" />
      <path d="M6.5 17H5a1 1 0 0 1-1-1v-4" />
      <circle cx="7.5" cy="16.5" r="1.3" />
      <circle cx="16.5" cy="16.5" r="1.3" />
    </>
  ));
}

export function WalkIcon(props: IconProps) {
  return base(props, (
    <>
      <circle cx="13" cy="4.5" r="1.6" />
      <path d="M13 8.5l-3.5 2 .8 2.6-2 4.4" />
      <path d="M4 19l3-6 3.5-2" />
      <path d="M11 13.5l3.5 1.5 3 3.5" />
    </>
  ));
}

export function BikeIcon(props: IconProps) {
  return base(props, (
    <>
      <circle cx="6" cy="17" r="3.2" />
      <circle cx="18" cy="17" r="3.2" />
      <path d="M6 17l3.5-7.5h4.5" />
      <path d="M10 9.5h5l3 7.5" />
      <path d="M11.5 9.5l3 7.5" />
      <path d="M8.5 7.5h3.5" />
    </>
  ));
}

export function MapPinIcon(props: IconProps) {
  return base(props, (
    <>
      <path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11z" />
      <circle cx="12" cy="10" r="2.6" />
    </>
  ));
}

export function CrosshairIcon(props: IconProps) {
  return base(props, (
    <>
      <circle cx="12" cy="12" r="6.5" />
      <path d="M12 2.5v3.4M12 18.1v3.4M2.5 12h3.4M18.1 12h3.4" />
      <circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none" />
    </>
  ));
}

export function SunIcon(props: IconProps) {
  return base(props, (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </>
  ));
}

export function MoonIcon(props: IconProps) {
  return base(props, (
    <>
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </>
  ));
}

export function ClockIcon(props: IconProps) {
  return base(props, (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ));
}

export function RouteIcon(props: IconProps) {
  return base(props, (
    <>
      <circle cx="5" cy="19" r="2" />
      <circle cx="19" cy="5" r="2" />
      <path d="M7 19h9a3 3 0 0 0 3-3v-9M17 19a2 2 0 0 1 2-2" />
    </>
  ));
}

export function TurnIcon(props: IconProps) {
  // Right-angle turn, symmetric enough to reuse rotated by CSS if needed.
  return base(props, (
    <>
      <path d="M5 7h9a4 4 0 0 1 4 4v6" />
      <path d="M14 5l4 2-4 2" />
    </>
  ));
}

/**
 * Directional maneuver arrows for turn-by-turn. `kind` comes straight from the
 * geometry-derived steps in navigation/steps.ts; nothing here implies a road
 * feature (exit numbers, lanes) that the data does not carry.
 */
const MANEUVER_GLYPHS: Record<ManeuverKind, React.ReactNode> = {
  depart: (
    <>
      <path d="M12 21V6" />
      <path d="M8 10l4-4 4 4" />
    </>
  ),
  continue: (
    <>
      <path d="M12 21V6" />
      <path d="M8 10l4-4 4 4" />
    </>
  ),
  right: (
    <>
      <path d="M7 21v-8a4 4 0 0 1 4-4h7" />
      <path d="M15 6l4 3-4 3" />
    </>
  ),
  left: (
    <>
      <path d="M17 21v-8a4 4 0 0 0-4-4H6" />
      <path d="M9 6L5 9l4 3" />
    </>
  ),
  "slight-right": (
    <>
      <path d="M8 21l4-8 5-4" />
      <path d="M13 8h5v5" />
    </>
  ),
  "slight-left": (
    <>
      <path d="M16 21l-4-8-5-4" />
      <path d="M11 8H6v5" />
    </>
  ),
  "sharp-right": (
    <>
      <path d="M7 21v-9a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3v4" />
      <path d="M14 13l3 3 3-3" />
    </>
  ),
  "sharp-left": (
    <>
      <path d="M17 21v-9a3 3 0 0 0-3-3h-4a3 3 0 0 0-3 3v4" />
      <path d="M10 13l-3 3-3-3" />
    </>
  ),
  uturn: (
    <>
      <path d="M7 21V11a5 5 0 0 1 10 0v10" />
      <path d="M14 18l3 3 3-3" />
    </>
  ),
  "roundabout-enter": (
    <>
      <circle cx="12" cy="11" r="6.5" />
      <path d="M12 21v-4" />
      <path d="M9 18l3 3 3-3" />
    </>
  ),
  "roundabout-exit": (
    <>
      <circle cx="12" cy="11" r="6.5" />
      <path d="M15 12h6" />
      <path d="M18 9l3 3-3 3" />
    </>
  ),
};

export function ManeuverIcon({ kind, className }: { kind: ManeuverKind; className?: string }) {
  return base({ className }, MANEUVER_GLYPHS[kind] ?? MANEUVER_GLYPHS.continue);
}

export function DirectionsIcon(props: IconProps) {
  // Google-Maps-style navigation arrow toward the top-right.
  return base(props, (
    <>
      <path d="M12 2v20M12 2l-6 6M12 2l6 6" />
    </>
  ));
}

export function CheckIcon(props: IconProps) {
  return base(props, (
    <path d="M5 13l4 4L19 7" />
  ));
}

export function InfoIcon(props: IconProps) {
  return base(props, (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5M12 7.8h.01" />
    </>
  ));
}