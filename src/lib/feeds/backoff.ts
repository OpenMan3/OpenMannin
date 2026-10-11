/**
 * Poll backoff for the live client feeds.
 *
 * The browser calls CelesTrak directly - there is no server
 * cache between this page and them on a static host, so the poll interval IS
 * the rate limit. When an upstream is down or answering 429, hammering it every
 * thirty seconds on the next tab's every poll makes the outage worse and costs
 * the caller's quota, all while the map shows the same "no data". So the poller
 * backs off exponentially per feed and self-heals: one healthy answer resets
 * the counter and returns to the normal cadence.
 */

/** Normal cadence when nothing has gone wrong. */
export const LIVE_POLL_BASE_MS = 30_000;
/** Longest we will wait between attempts against a failing upstream. */
export const LIVE_POLL_MAX_MS = 30 * 60_000;
/** Consecutive failures past which the delay has already hit the cap. */
const MAX_TRACKED_FAILURES = 10;

/**
 * The delay before the next poll after `failures` consecutive failures.
 *
 * Pure and small on purpose: the schedule logic in MapView is the tricky part,
 * and this is the only number it should trust.
 */
export function nextPollDelayMs(
  failures: number,
  { baseMs = LIVE_POLL_BASE_MS, maxMs = LIVE_POLL_MAX_MS } = {},
): number {
  const f = Math.max(0, Math.min(failures, MAX_TRACKED_FAILURES));
  return Math.min(baseMs * 2 ** f, maxMs);
}