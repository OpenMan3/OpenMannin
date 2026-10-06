# Test fixtures

## celestrak-stations.tle

Four real element sets captured verbatim from CelesTrak's `STATIONS` GP endpoint
(public domain: published by the US Space Force, redistributed with no key, no
login and no terms restricting use).

Kept as a byte-faithful payload — names included, no blank lines between records,
no comment header — because the parsing and propagation tests are only
meaningful against the shape that actually arrives.

A hand-built element set is not an acceptable substitute. An earlier version of
the SGP4 test used a synthetic ISS element set, and it failed: the drag term in
that made-up record made SGP4 correctly report the satellite as decayed
(`mrt < 1.0`, error 6). The algorithm was right and the fixture was wrong.

The four records span the range the layer handles: two crewed-orbit stations, a
higher-inclination commercial platform, and a decayed-orbit case.
