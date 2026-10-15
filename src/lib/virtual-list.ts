/**
 * Windowing maths for a fixed-height scrollable list.
 *
 * The Browse panel used to cap its list at 250 rows and show "filter to
 * narrow" for everything beyond — useless for a layer of 860 ruins, where the
 * whole point is to scan or step through every member. Rendering all of them
 * at once is fine for 860 but not for the registered trees (1,199) or any
 * future layer that grows; and mounting thousands of rows makes each keystroke
 * in the filter box re-render them all.
 *
 * So the list renders only the rows in (and a little around) the viewport, and
 * pads the top and bottom with empty spacers of exactly the right height to
 * keep the scrollbar honest. This module is the pure function behind that: no
 * React, no DOM, so the arithmetic is unit-tested rather than eyeballed.
 *
 * Kept free of imports and of the `@/` alias so node --experimental-strip-types
 * can load it directly from a test.
 */

export interface WindowRange {
  /** First row index to render (inclusive). */
  start: number;
  /** Last row index to render (exclusive). */
  end: number;
  /** Pixel height of the spacer above `start`. */
  topPad: number;
  /** Pixel height of the spacer below `end`. */
  bottomPad: number;
}

export interface WindowOptions {
  /** Total number of rows. */
  total: number;
  /** Fixed height of every row, in pixels. */
  rowHeight: number;
  /** Current scroll offset of the container, in pixels. */
  scrollTop: number;
  /** Visible height of the container, in pixels. */
  viewportHeight: number;
  /** Extra rows to render above and below the viewport, to hide fast scroll. */
  overscan?: number;
}

/**
 * The slice of rows to render for a given scroll position.
 *
 * Always returns a valid, clamped range: `start`/`end` lie within
 * `[0, total]`, the pads are never negative, and a non-positive `total` or
 * `rowHeight` yields an empty range rather than dividing by zero.
 */
export function windowRange({
  total,
  rowHeight,
  scrollTop,
  viewportHeight,
  overscan = 6,
}: WindowOptions): WindowRange {
  if (total <= 0 || rowHeight <= 0) {
    return { start: 0, end: 0, topPad: 0, bottomPad: 0 };
  }

  const first = Math.floor(scrollTop / rowHeight);
  const last = Math.ceil((scrollTop + Math.max(0, viewportHeight)) / rowHeight);

  const start = Math.max(0, Math.min(total, first - overscan));
  const end = Math.max(start, Math.min(total, last + overscan));

  return {
    start,
    end,
    topPad: start * rowHeight,
    bottomPad: (total - end) * rowHeight,
  };
}
