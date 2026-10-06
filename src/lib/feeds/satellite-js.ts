/**
 * satellite.js, pure-JS entry points only.
 *
 * WHY THIS FILE EXISTS. `import ... from "satellite.js"` resolves to
 * dist/index.js, which re-exports `./wasm/index.js`. That WASM build imports
 * `node:module` and `node:worker_threads` for its worker pool, and a browser
 * bundle cannot load either:
 *
 *     Module build failed: UnhandledSchemeError: Reading from "node:module"
 *     is not handled by plugins
 *
 * so the satellite pass layer, the moment it moved from the Node server into the
 * client, stopped the whole app compiling. This layer is the only consumer of
 * satellite.js in the client, and it needs none of the WASM: the arithmetic is
 * available in plain JavaScript under dist/propagation/ and dist/io.js.
 *
 * Those subpaths cannot be imported as `satellite.js/dist/...` because the
 * package's `exports` map does not publish them (ERR_PACKAGE_PATH_NOT_EXPORTED),
 * hence this shim reaching them by relative path. Everything reached from here
 * is dependency-free - the module graph from these four entry points contains no
 * `node:` imports, which is the property that actually matters.
 *
 * WHAT THIS DOES NOT CHANGE. The algorithm is not a reimplementation. It is
 * satellite.js's own published SGP4/SDP4 code, so the positions this layer
 * produces are the same ones the previous server-side route produced, to the
 * last bit. See passes-worker.ts for what the accuracy is and is not.
 *
 * WHAT IS GIVEN UP. satellite.js's WASM build is meaningfully faster per call.
 * That is not a loss worth measuring here: this layer propagates 20 element sets
 * on a 30 s step over a 24 h window, runs once, off the main thread, and its
 * result is cached. The previous server route did the same work in Node with the
 * WASM build and the wall-clock difference was never the bottleneck - the
 * bundler failing was.
 */

export { gstime, propagate, sgp4 } from "../../../node_modules/satellite.js/dist/propagation.js";
export { twoline2satrec } from "../../../node_modules/satellite.js/dist/io.js";
export {
  eciToGeodetic,
  ecfToLookAngles,
  geodeticToEcf,
  radiansLat,
  radiansLong,
  radiansToDegrees,
} from "../../../node_modules/satellite.js/dist/transforms.js";
export { jday } from "../../../node_modules/satellite.js/dist/ext.js";