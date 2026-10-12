/**
 * Spoken instructions for turn-by-turn, built from the geometry-derived steps.
 *
 * Nothing here invents road knowledge: a phrase is the step's own instruction
 * with its trailing "for 300 yd" leg length stripped, because the approach
 * distance is spoken separately and the leg length would only confuse a driver.
 * Web Speech itself lives in the host (it is a browser side effect); these are
 * the strings it speaks, kept pure so they can be tested.
 *
 * PURE: no DOM, no SpeechSynthesis - testable under `node --test`.
 */

import { formatDistance } from "../units.ts";
import type { NavigationStep } from "./steps.ts";

/** Distances as spoken words ("330 yd" -> "330 yards"). */
export function spokenDistance(m: number): string {
  const text = formatDistance(m);
  const match = /^([\d.]+)\s*(ft|yd|mi)$/.exec(text);
  if (!match) return text;
  const value = Number(match[1]);
  const [singular, plural] =
    match[2] === "ft" ? ["foot", "feet"] : match[2] === "yd" ? ["yard", "yards"] : ["mile", "miles"];
  return `${match[1]} ${value === 1 ? singular : plural}`;
}

/** The maneuver itself, without the leg-length tail baked into `instruction`. */
export function spokenManeuver(step: NavigationStep): string {
  const base = step.instruction
    .replace(/\s*for\s+[\d.,]+\s*(?:ft|yd|mi)\b.*$/i, "")
    .trim();
  return base || "Continue";
}

/** "In 330 yards, turn right onto Main Street" - the pre-turn warning. */
export function spokenApproach(step: NavigationStep, distanceM: number): string {
  const phrase = spokenManeuver(step);
  return `In ${spokenDistance(distanceM)}, ${phrase.charAt(0).toLowerCase()}${phrase.slice(1)}`;
}

export const ARRIVAL_SPEECH = "You have arrived at your destination.";

/**
 * A short line to say when a new route goes live, e.g. "Starting navigation".
 * Kept separate so the host can decide when (and whether) to announce it.
 */
export function spokenDeparture(step: NavigationStep | null): string {
  return step ? `Starting navigation. ${spokenManeuver(step)}` : "Starting navigation.";
}
