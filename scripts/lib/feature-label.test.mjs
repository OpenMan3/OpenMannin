import { test } from "node:test";
import { strict as assert } from "node:assert";
import { resolveFeatureLabel, featureKind } from "../../src/lib/feature-label.ts";

test("resolveFeatureLabel prefers a real identity over a placeholder", () => {
  assert.equal(resolveFeatureLabel({ label: "  42 Castle Street  " }), "42 Castle Street");
  assert.equal(resolveFeatureLabel({ name: "Douglas Head" }), "Douglas Head");
  assert.equal(resolveFeatureLabel({ housename: "Ballaglass" }), "Ballaglass");
  assert.equal(resolveFeatureLabel({ code: "IM1 1AD", addresses: 2 }), "IM1 1AD");
  assert.equal(resolveFeatureLabel({ ref: "A18", highway: "primary" }), "A18");
});

test("a placeholder name the ingest wrote is not an identity", () => {
  assert.equal(
    resolveFeatureLabel({ name: "(unnamed)", named: false, kind: "lighthouse", seamarkType: "light_minor" }),
    "Lighthouse",
  );
});

test("unnamed features get a kind from their own tags", () => {
  assert.equal(resolveFeatureLabel({ highway: "footway" }), "Footway");
  assert.equal(resolveFeatureLabel({ highway: "service" }), "Service road");
  assert.equal(resolveFeatureLabel({ highway: "traffic_signals" }), "Traffic signals");
  assert.equal(resolveFeatureLabel({ highway: "unclassified", maxspeed: "30 mph" }), "30 mph limit");
  assert.equal(resolveFeatureLabel({ maxspeed: "none" }), "National speed limit");
  assert.equal(resolveFeatureLabel({ waterway: "stream" }), "Stream");
  assert.equal(resolveFeatureLabel({ water: "reservoir" }), "Reservoir");
  assert.equal(resolveFeatureLabel({ railway: "narrow_gauge" }), "Narrow-gauge railway");
  assert.equal(resolveFeatureLabel({ bridge: "yes", highway: "path" }), "Footbridge");
  assert.equal(resolveFeatureLabel({ bridge: "yes", railway: "rail" }), "Railway bridge");
  assert.equal(resolveFeatureLabel({ boundary: "protected_area", leisure: "nature_reserve" }), "Nature reserve");
});

test("a charge point is recognised by its socket columns", () => {
  assert.equal(resolveFeatureLabel({ operator: "Pod Point", socketType2: "2" }), "Charge point");
});

test("an anonymous feature is qualified by the nearest place when one exists", () => {
  assert.equal(
    resolveFeatureLabel({ kind: "substation", nearestPlace: "Jurby" }),
    "Substation near Jurby",
  );
  assert.equal(resolveFeatureLabel({ kind: "substation" }), "Substation");
});

test("asn and the last-resort OSM id keep anonymous features traceable", () => {
  assert.equal(resolveFeatureLabel({ asn: 926, holder: "AS926 AS926 Limited" }), "AS926");
  assert.equal(resolveFeatureLabel({ osm: "way/25985912" }), "Feature way/25985912");
  assert.equal(resolveFeatureLabel({}), "(unnamed)");
  assert.equal(resolveFeatureLabel(null), "(unnamed)");
});

test("featureKind is exposed for callers that only want the type", () => {
  assert.equal(featureKind({ highway: "track" }), "Track");
  assert.equal(featureKind({ name: "Douglas Head" }), null);
});
