"use client";

/**
 * Elevation profile for the active route.
 *
 * A compact sparkline of height against distance, sampled from the same
 * keyless DEM the 3D terrain uses (elevation-client.ts). It is a convenience,
 * so it degrades quietly: offline it says so and shows nothing, and any DEM
 * failure is silent rather than an error state competing with navigation.
 *
 * The fetch is debounced and aborted on a route change, so scrubbing between
 * routes never stacks requests or lands an old profile under a new route.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { fetchElevationProfile } from "@/lib/elevation-client";
import { profileStats, type ElevationPoint } from "@/lib/elevation";
import { formatDistance } from "@/lib/units";
import { t } from "@/lib/i18n";
import { useLang } from "@/lib/use-lang";

type Status = "idle" | "loading" | "ready" | "error" | "offline";

const W = 100;
const H = 32;
const PAD = 3;
/** Wait out a burst of route updates before hitting the DEM. */
const DEBOUNCE_MS = 500;

function buildPaths(points: ElevationPoint[], totalM: number): { line: string; area: string } {
  if (points.length === 0) return { line: "", area: "" };
  let minM = Infinity;
  let maxM = -Infinity;
  for (const p of points) {
    if (p.eleM < minM) minM = p.eleM;
    if (p.eleM > maxM) maxM = p.eleM;
  }
  const span = maxM - minM || 1;
  const usable = H - PAD * 2;
  const denom = totalM > 0 ? totalM : points[points.length - 1].distM || 1;
  const xy = points.map((p) => {
    const x = (p.distM / denom) * W;
    const y = PAD + (1 - (p.eleM - minM) / span) * usable;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const line = `M${xy.join(" L")}`;
  const area = `M0,${H} L${xy.join(" L")} L${W},${H} Z`;
  return { line, area };
}

export function ElevationProfile({
  coords,
  distanceM,
}: {
  coords: readonly [number, number][] | null;
  distanceM?: number;
}) {
  useLang();
  const [points, setPoints] = useState<ElevationPoint[] | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const reqRef = useRef(0);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  // A stable key for the route geometry: identical routes must not refetch.
  const coordKey = useMemo(
    () => (coords && coords.length > 1 ? `${coords.length}:${coords[0]}:${coords[coords.length - 1]}` : ""),
    [coords],
  );

  useEffect(() => {
    if (!coordKey || !coords || coords.length < 2) {
      setPoints(null);
      setStatus("idle");
      return;
    }
    if (!online) {
      setStatus("offline");
      return;
    }

    const token = ++reqRef.current;
    const controller = new AbortController();
    setStatus("loading");

    const timer = setTimeout(() => {
      fetchElevationProfile(coords, { signal: controller.signal })
        .then((profile) => {
          if (token !== reqRef.current) return;
          setPoints(profile);
          setStatus("ready");
        })
        .catch((err: Error) => {
          if (token !== reqRef.current) return;
          setStatus(err.message === "offline" ? "offline" : "error");
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // coordKey captures the geometry; coords/online are read for the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coordKey, online]);

  if (!coordKey) return null;
  if (status === "idle") return null;

  const totalM = distanceM ?? (points ? points[points.length - 1]?.distM ?? 0 : 0);
  const stats = points ? profileStats(points) : null;
  const { line, area } = points ? buildPaths(points, totalM) : { line: "", area: "" };

  return (
    <div className="card-floating w-[min(20rem,calc(100vw-2rem))] overflow-hidden border border-line-soft">
      <div className="flex items-center justify-between gap-2 border-b border-line-soft px-3 py-1.5">
        <span className="label">{t("elevation.title")}</span>
        {stats && (
          <span className="font-mono text-[10px] text-ink-3">
            {Math.round(stats.minM)}–{Math.round(stats.maxM)} m
          </span>
        )}
      </div>

      {status === "offline" && (
        <p className="px-3 py-2.5 text-[11px] leading-snug text-ink-3">
          {t("elevation.offline")}
        </p>
      )}
      {status === "error" && (
        <p className="px-3 py-2.5 text-[11px] leading-snug text-ink-3">
          {t("elevation.unavailable")}
        </p>
      )}
      {status === "loading" && (
        <p className="px-3 py-2.5 text-[11px] leading-snug text-ink-3">
          {t("elevation.loading")}
        </p>
      )}

      {status === "ready" && stats && (
        <>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="h-16 w-full"
            role="img"
            aria-label={`Elevation profile: ${Math.round(stats.minM)} to ${Math.round(stats.maxM)} metres`}
          >
            {area && <path d={area} className="fill-accent/15" />}
            {line && (
              <path
                d={line}
                className="stroke-accent"
                fill="none"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
          <div className="flex items-center justify-between border-t border-line-soft px-3 py-1.5 text-[10px] text-ink-3">
            <span>
              ↑ {Math.round(stats.ascentM)} m · ↓ {Math.round(stats.descentM)} m
            </span>
            <span>{formatDistance(totalM)}</span>
          </div>
        </>
      )}
    </div>
  );
}
