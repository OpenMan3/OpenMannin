import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  /**
   * Static export. Firebase Hosting serves files, so there is no runtime to run
   * a Next server in. This is what makes the deploy hands-free.
   *
   * The cost, stated plainly: anything that needed a server now needs a Firebase
   * Function instead. Three live feeds moved there - OpenSky (CORS pinned to
   * their own origin), AISStream (the key must not reach a browser) and
   * FindMyBus (no CORS header at all). The other two, weather and satellite
   * passes, moved into the browser because their upstreams send
   * `Access-Control-Allow-Origin: *` and need no credential.
   *
   * `images.unoptimized` is required rather than optional: the image optimizer
   * is a server route, and a static export silently drops images that route
   * would have handled.
   */
  output: "export",
  images: { unoptimized: true },
  /**
   * NO headers() HERE, DELIBERATELY.
   *
   * Next warns that `headers` "will not automatically work with output: export",
   * and it is right: a static export has no server to apply them, so the rule is
   * silently ignored. That is the worst kind of config - it looks like it is
   * protecting something and is not.
   *
   * The security headers this used to set now live in ONE place,
   * scripts/static-headers.mjs, which both writes public/_headers (Cloudflare
   * Pages applies that file at the edge) and feeds scripts/serve.mjs (used by
   * `npm start`, Docker, Fly and systemd). If you deploy somewhere else, send
   * those headers there too or lose them - do not assume this file still does.
   */
};

export default nextConfig;
