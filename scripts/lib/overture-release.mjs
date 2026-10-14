/**
 * Pinned Overture Maps release used by the ingest.
 *
 * This is deliberately a pin, not "latest". Overture can add records, change
 * contributor licences or rename paths between releases, and every downstream
 * artifact here (feature counts, manifest, search index, layer caveats) has to
 * be checked against the resulting data. A routine refresh therefore changes the
 * data on purpose rather than following upstream silently.
 *
 * OVERTURE_RELEASE may be set to test or ingest an upcoming release, but the
 * committed constant and shipped data file must agree before that ingest is used.
 */
const FALLBACK_RELEASE = "2026-09-23.1";
export const OVERTURE_RELEASE_PATTERN = /^\d{4}-\d{2}-\d{2}\.\d+$/;

export const OVERTURE_RELEASE =
  process.env.OVERTURE_RELEASE ?? FALLBACK_RELEASE;

if (!OVERTURE_RELEASE_PATTERN.test(OVERTURE_RELEASE)) {
  throw new Error(
    `Invalid OVERTURE_RELEASE "${OVERTURE_RELEASE}" (expected e.g. 2026-09-23.1)`,
  );
}
