import type { Metadata } from "next";
import "./globals.css";
import "maplibre-gl/dist/maplibre-gl.css";

export const metadata: Metadata = {
  title: "OpenMannin — Isle of Man Infrastructure Map",
  description:
    "An open-source intelligence map of the Isle of Man: transport, utilities, subsea cables, coastlines, protected sites, live vehicle positions and IP networks. Every layer carries its source, licence and confidence grade.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}