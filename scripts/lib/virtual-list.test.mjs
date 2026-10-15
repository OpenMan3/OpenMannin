import { test } from "node:test";
import { strict as assert } from "node:assert";
import { windowRange } from "../../src/lib/virtual-list.ts";

test("renders a window around the viewport, padded top and bottom", () => {
  const r = windowRange({ total: 1000, rowHeight: 30, scrollTop: 3000, viewportHeight: 300, overscan: 2 });
  // first visible = 100, last visible = ceil(3300/30)=110
  assert.equal(r.start, 98);
  assert.equal(r.end, 112);
  assert.equal(r.topPad, 98 * 30);
  assert.equal(r.bottomPad, (1000 - 112) * 30);
});

test("clamps to the top of the list", () => {
  const r = windowRange({ total: 500, rowHeight: 30, scrollTop: 0, viewportHeight: 300, overscan: 5 });
  assert.equal(r.start, 0);
  assert.equal(r.topPad, 0);
  assert.equal(r.end, 15); // ceil(300/30)=10, +5 overscan
});

test("clamps to the end and leaves no bottom pad", () => {
  // total*rowHeight = 1000, viewport 200 => max scrollTop 800.
  const r = windowRange({ total: 50, rowHeight: 20, scrollTop: 800, viewportHeight: 200, overscan: 4 });
  assert.equal(r.start, 36); // first visible 40, minus 4 overscan
  assert.equal(r.end, 50);
  assert.equal(r.bottomPad, 0);
});

test("every row is covered at least once across a scroll sweep", () => {
  const total = 137;
  const rowHeight = 30;
  const viewport = 240;
  const seen = new Set();
  for (let scrollTop = 0; scrollTop <= total * rowHeight; scrollTop += rowHeight) {
    const { start, end } = windowRange({ total, rowHeight, scrollTop, viewportHeight: viewport, overscan: 2 });
    for (let i = start; i < end; i++) seen.add(i);
  }
  assert.equal(seen.size, total);
});

test("an empty or invalid list yields an empty range, not NaN", () => {
  assert.deepEqual(windowRange({ total: 0, rowHeight: 30, scrollTop: 0, viewportHeight: 300 }), {
    start: 0,
    end: 0,
    topPad: 0,
    bottomPad: 0,
  });
  const bad = windowRange({ total: 10, rowHeight: 0, scrollTop: 0, viewportHeight: 300 });
  assert.equal(bad.end, 0);
  assert.equal(Number.isNaN(bad.topPad), false);
});

test("pads account for every unrendered row exactly", () => {
  const { start, end, topPad, bottomPad } = windowRange({
    total: 400,
    rowHeight: 32,
    scrollTop: 6400,
    viewportHeight: 320,
    overscan: 3,
  });
  const rendered = (end - start) * 32;
  assert.equal(topPad + rendered + bottomPad, 400 * 32);
});
