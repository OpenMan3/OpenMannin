/**
 * UI string catalog for the Manx Gaelic (Gaelg) translation layer.
 *
 * These translations are an initial draft and have NOT been reviewed by a
 * native speaker. English is the source of truth: every key must carry an
 * entry here, and any missing or empty `gv` value falls back to `en` at
 * lookup time (see src/lib/i18n.ts). Spellings favour simple, broadly
 * attested Manx rather than long compounds, so an unreviewed string is at
 * worst plain rather than wrong.
 *
 * Framework-free by design — no React import — so it can be exercised under
 * `node --test` and imported from a Server Component alike.
 */

import type { Lang } from "./i18n.ts";

export const CATALOG: Record<string, { en: string; gv: string }> = {
  "app.title": { en: "OpenMannin", gv: "OpenMannin" },
  "app.tagline": { en: "Isle of Man intelligence", gv: "Fysseree Ellan Vannin" },
  "app.search": { en: "Search", gv: "Ronsaghey" },
  "app.settings": { en: "Settings", gv: "Reaghey" },
  "app.language": { en: "Language", gv: "Çhengey" },
  "app.location": { en: "Location", gv: "Boayl" },
  "app.clear": { en: "Clear", gv: "Glan" },
  "app.close": { en: "Close", gv: "Dooney" },
  "app.undo": { en: "Undo", gv: "Cur ergooyl" },
  "app.download": { en: "Download", gv: "Lughtaghey sheese" },
  "app.save": { en: "Save", gv: "Sauail" },
  "app.saved": { en: "Saved", gv: "Sauailt" },
  "app.recent": { en: "Recent", gv: "Jerdee" },
  "app.about": { en: "About", gv: "Mychione" },
  "app.help": { en: "Help", gv: "Cooney" },

  "tab.layers": { en: "Layers", gv: "Coodee" },
  "tab.browse": { en: "Browse", gv: "Scrutaghey" },
  "tab.gaps": { en: "Gaps", gv: "Baarnyn" },
  "tab.sources": { en: "Sources", gv: "Bunyn" },

  "action.navigate": { en: "Navigate", gv: "Stiurey" },
  "action.follow": { en: "Follow", gv: "Eiyr" },
  "action.voice": { en: "Voice", gv: "Coraa" },
  "action.locate": { en: "Locate", gv: "Fow mish" },

  "nav.destination": { en: "Destination", gv: "Kione-jurnagh" },
  "nav.route": { en: "Route", gv: "Raad" },
  "nav.offlineData": { en: "Offline data", gv: "Fysseree neuchianglt" },
  "nav.followMode": { en: "Follow mode", gv: "Aght eiyrt" },
  "nav.start": { en: "Start", gv: "Gow toshiaght" },
  "nav.overview": { en: "Overview", gv: "Ard-shilley" },
  "nav.end": { en: "End", gv: "Jerrey" },

  "measure.measure": { en: "Measure", gv: "Towsaghey" },
  "measure.distance": { en: "Distance", gv: "Odys" },
  "measure.area": { en: "Area", gv: "Eaghtyr" },
  "measure.points": { en: "Points", gv: "Poyntyn" },

  "status.loading": { en: "Loading", gv: "Lughtaghey" },
  "status.error": { en: "Error", gv: "Marran" },
  "status.retry": { en: "Retry", gv: "Try reesht" },
  "status.updated": { en: "Updated", gv: "Er ny noaaghey" },
  "status.updatedAt": { en: "Updated {time}", gv: "Er ny noaaghey {time}" },
};

/** Short uppercase code for the toggle's face — "EN" or "GV". */
export function langLabel(lang: Lang): string {
  return lang === "gv" ? "GV" : "EN";
}
