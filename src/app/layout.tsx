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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}