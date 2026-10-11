/**
 * Taxonomy ordering tests.
 *
 * The category/subcategory order is explicit (not alphabetical) so a reader
 * meets the most important drawers first. These tests lock the intended order
 * and ensure new drawers never silently disappear.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CATEGORY_ORDER,
  CATEGORY_LABELS,
  CATEGORY_BLURBS,
  SUBCATEGORY_ORDER,
  SUBCATEGORY_LABELS,
  orderSubcategories,
} from "../../src/lib/taxonomy.ts";

test("all five categories have labels and blurbs", () => {
  for (const c of CATEGORY_ORDER) {
    assert.ok(CATEGORY_LABELS[c], `missing label for ${c}`);
    assert.ok(CATEGORY_BLURBS[c], `missing blurb for ${c}`);
  }
});

test("every subcategory in SUBCATEGORY_ORDER has a label", () => {
  for (const [cat, subs] of Object.entries(SUBCATEGORY_ORDER)) {
    for (const s of subs) {
      assert.ok(SUBCATEGORY_LABELS[s], `missing label for subcategory ${s} in ${cat}`);
    }
  }
});

test("orderSubcategories preserves the curated order first", () => {
  const present = ["mine-infrastructure", "designated", "archaeology", "tholtans-ruins"];
  const ordered = orderSubcategories("heritage", present);

  // Curated order for heritage is: designated, mine-infrastructure, tholtans-ruins, archaeology
  assert.deepEqual(ordered, [
    "designated",
    "mine-infrastructure",
    "tholtans-ruins",
    "archaeology",
  ]);
});

test("orderSubcategories appends unknown drawers after the curated ones", () => {
  const present = ["designated", "new-thing", "archaeology"];
  const ordered = orderSubcategories("heritage", present);

  assert.deepEqual(ordered, ["designated", "archaeology", "new-thing"]);
});

test("orderSubcategories handles empty input", () => {
  assert.deepEqual(orderSubcategories("heritage", []), []);
});

test("CATEGORY_ORDER covers exactly the five reader-facing themes", () => {
  assert.deepEqual(CATEGORY_ORDER, [
    "heritage",
    "prow",
    "infrastructure",
    "civic",
    "poi",
  ]);
});

test("SUBCATEGORY_ORDER has entries for all five categories", () => {
  assert.deepEqual(Object.keys(SUBCATEGORY_ORDER).sort(), [
    "civic",
    "heritage",
    "infrastructure",
    "poi",
    "prow",
  ]);
});