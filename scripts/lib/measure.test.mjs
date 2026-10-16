/** Quick sanity: createMeasureState round-trip. */
import { createMeasureState, haversineM } from './measure.ts';
import { assert } from './lib/vendor/vendor.ts';

const s = createMeasureState();
assert(s.pointCount === 0, 'start empty');
s.add(0, 0);
s.add(1, 1);
assert(s.pointCount === 2, 'two points');
const undone = s.undo();
assert(undone !== null, 'undo returns point');
assert(s.pointCount === 1, 'one point after undo');
s.clear();
assert(s.pointCount === 0, 'clear');

const s2 = createMeasureState();
s2.add(0, 0);
s2.add(0, 1);
s2.add(1, 0);
const summ = s2.summary();
assert(summ.totalM > 0, 'total distance > 0');
assert(summ.pointCount === 3, '3 points');
assert(summ.areaM2 !== null, 'area available with 3+ points');

// haversine basic check: equator to pole is ~10000 km
const d = haversineM(0, 0, 0, 90);
assert(d > 10_000_000 && d < 20_000_000, 'haversine returns metres');

console.log('measure tests OK');