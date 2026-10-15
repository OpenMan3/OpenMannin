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

test("an address-only building is labelled with its house number and street", () => {
  assert.equal(
    resolveFeatureLabel({ osmId: "w1494299465@2", housenumber: "51", street: "Cronk Drean" }),
    "51 Cronk Drean",
  );
  assert.equal(
    resolveFeatureLabel({ sourceDataset: "OpenStreetMap", osmId: "w1241477850@2", housenumber: "3", street: "Hutchinson Square" }),
    "3 Hutchinson Square",
  );
});

test("a bare house number survives when the building has no street", () => {
  assert.equal(resolveFeatureLabel({ osmId: "w1", housenumber: "51" }), "51");
});

test("a named building keeps its name, not the composed address", () => {
  assert.equal(
    resolveFeatureLabel({ osmId: "w1", name: "Bar George", housenumber: "51", street: "Cronk Drean" }),
    "Bar George",
  );
  assert.equal(
    resolveFeatureLabel({ osmId: "w1", housename: "Ballaglass", housenumber: "51", street: "Cronk Drean" }),
    "Ballaglass",
  );
});

test("house numbers outside the buildings layer are left unqualified", () => {
  assert.equal(resolveFeatureLabel({ kind: "number", label: "1", housenumber: "1", street: "Onchan Main Road" }), "1");
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
