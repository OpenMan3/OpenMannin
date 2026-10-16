/**
 * Freshness / health line for the transparency panel.
 *
 * Two build-time signals are folded into one sentence:
 *  - public/health.json (scripts/build-health.mjs): does the build still have
 *    its MapLibre worker, its ingest output and its security headers;
 *  - the `generated` stamp (health.json's full timestamp, or the manifest's
 *    date when that is all there is): how old the data actually is.
 *
 * The badge is decoration on top of facts the reader can verify elsewhere, so
 * it is built to disappear rather than to lie: anything unparseable returns
 * null and the panel renders nothing. A stale or warned build is amber, a
 * broken one is red with the first problem available on hover - the panel
 * never shows a green line it cannot justify.
 *
 * PURE: no DOM, no fetch - testable under `node --test`.
 */

export type HealthTone = "ok" | "warn" | "danger";

export interface HealthSummary {
  tone: HealthTone;
  /** One compact line, ready to render. */
  text: string;
  /** The first problem or warning in full, for a hover/tooltip. */
  title?: string;
}

/** Generated data at least this many days old is reported as stale. */
export const STALE_DAYS = 7;

const DAY_MS = 86_400_000;

/** UTC month abbreviations, so a build stamp does not shift with the reader's clock. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.length > 0);
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/**
 * Whole days between a build stamp and `now`, or null when it cannot be
 * parsed. A stamp from the future (clock skew between the build machine and
 * the reader) clamps to 0: a negative age would read as a fresh build while
 * hiding the skew it came from.
 */
export function ageInDays(iso: string | null | undefined, now: Date = new Date()): number | null {
  const t = typeof iso === "string" ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / DAY_MS));
}

/**
 * A build stamp as the panel shows it: "12 Oct, 01:50". UTC, because the
 * timestamp records when the build ran, which is a fact about the server and
 * not about the reader's timezone.
 */
export function formatGenerated(iso: string | null | undefined): string | null {
  const t = typeof iso === "string" ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${day} ${MONTHS[d.getUTCMonth()]}, ${hh}:${mm}`;
}

/**
 * Classify the report into the one line the strip shows, or null when there is
 * nothing trustworthy to show.
 *
 * Severity is checked hardest-first - broken build, then stale/warned, then
 * healthy - because a report can carry a problem and a warning at once and the
 * reader needs the problem, not the older news. `manifestGenerated` is the
 * fallback stamp for a health.json that predates its own timestamp field.
 */
export function summarizeHealth(
  report: unknown,
  opts: { manifestGenerated?: string | null; now?: Date } = {},
): HealthSummary | null {
  if (!report || typeof report !== "object" || Array.isArray(report)) return null;
  const r = report as Record<string, unknown>;
  const now = opts.now ?? new Date();

  const problems = asStringList(r.problems);
  const warnings = asStringList(r.warnings);
  const absent = asStringList(r.absent);
  const ok = r.ok !== false;
  const generated =
    typeof r.generated === "string" && r.generated.length > 0
      ? r.generated
      : (opts.manifestGenerated ?? null);

  if (!ok || problems.length > 0 || absent.length > 0) {
    if (problems.length > 0) {
      return {
        tone: "danger",
        text: `Data problems detected · ${plural(problems.length, "problem")}`,
        title: problems[0],
      };
    }
    if (absent.length > 0) {
      return {
        tone: "danger",
        text: `Data incomplete · ${plural(absent.length, "layer")} without data`,
        title: absent[0],
      };
    }
    return { tone: "danger", text: "Data health check failed" };
  }

  const age = ageInDays(generated, now);
  const stale = age !== null && age >= STALE_DAYS;
  if (stale || warnings.length > 0) {
    const parts = ["Data needs attention"];
    if (stale) parts.push(`generated ${age} days ago`);
    if (warnings.length > 0) parts.push(plural(warnings.length, "warning"));
    return {
      tone: "warn",
      text: parts.join(" · "),
      title: warnings.length > 0 ? warnings[0] : undefined,
    };
  }

  const parts = ["Data healthy"];
  if (typeof r.layers === "number" && Number.isFinite(r.layers)) {
    parts.push(plural(r.layers, "layer"));
  }
  const stamp = formatGenerated(generated);
  if (stamp) parts.push(`generated ${stamp}`);
  return { tone: "ok", text: parts.join(" · ") };
}
