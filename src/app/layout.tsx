import type { Metadata, Viewport } from "next";
import "./globals.css";
import "maplibre-gl/dist/maplibre-gl.css";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";

export const metadata: Metadata = {
  title: "OpenMannin — Isle of Man Infrastructure Map",
  description:
    "An open-source intelligence map of the Isle of Man: transport, utilities, subsea cables, coastlines, protected sites and heritage. Every layer carries its source, licence and confidence grade.",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#1a73e8",
};

/**
 * Render-blocking theme bootstrap.
 *
 * A tiny synchronous script in <head> so the correct theme class is on <html>
 * before the browser paints anything — reading `om:theme`, falling back to the
 * OS `prefers-color-scheme`, and treating any unrecognised value as "system".
 * Without this the saved dark theme would flash white until React hydrated.
 * It is a constant string we author (no user input), so dangerouslySetInnerHTML
 * is safe here. The `try/catch` keeps a storage-disabled browser on the light
 * default rather than throwing during parsing. Kept in step with
 * src/lib/theme.ts by hand — it must not import anything.
 */
const THEME_BOOTSTRAP = `(function(){try{var p=localStorage.getItem("om:theme");var d=p==="dark"||(p!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var e=document.documentElement;e.classList.toggle("dark",d);e.style.colorScheme=d?"dark":"light";}catch(_){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the inline script sets `class`/`color-scheme`
    // on <html> before hydration, so the server and client markup intentionally
    // differ on that one element.
    <html lang="en-GB" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}