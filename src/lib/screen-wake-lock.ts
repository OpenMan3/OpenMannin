/**
 * Screen wake lock, so route navigation does not let the display dim mid-turn.
 *
 * The browser owns the lock's life: it is released behind our back when the
 * tab is hidden, so the UI must re-request it the moment the tab is visible
 * again. This module tracks *intent* (does the caller still want a lock?) and
 * reconciles it with reality on each call. Everything is optional at runtime -
 * a browser without navigator.wakeLock must be a no-op, never a crash.
 */

type WakeLockSentinel = {
  onrelease: unknown;
  addEventListener: (type: string, fn: () => void) => void;
  release: () => Promise<void>;
};

const SENTINEL_EVENT: string = "release";

let desired = false;
let sentinel: WakeLockSentinel | null = null;

async function tryAcquire(): Promise<void> {
  if (!desired || sentinel) return;
  const nav = navigator as Navigator & { wakeLock?: { request: (t: string) => Promise<WakeLockSentinel> } };
  if (!nav.wakeLock) return;
  try {
    const lock = await nav.wakeLock.request("screen");
    if (!desired) {
      // A release raced in while the request was in flight; drop the stale lock.
      void lock.release().catch(() => {});
      return;
    }
    sentinel = lock;
    // A hidden tab strips the lock; drop our reference so the next
    // visibilitychange can acquire a fresh one.
    lock.addEventListener(SENTINEL_EVENT, () => {
      if (sentinel === lock) sentinel = null;
    });
  } catch {
    // Permission denied, system rejecting the request - never fatal.
    sentinel = null;
  }
}

/** Declare that the screen should stay awake from now on. Safe to call often. */
export function requestWakeLock(): void {
  desired = true;
  void tryAcquire();
}

/** Declare the screen may dim again. Releases any lock currently held. */
export function releaseWakeLock(): void {
  desired = false;
  if (sentinel) {
    const lock = sentinel;
    sentinel = null;
    void lock.release().catch(() => {});
  }
}