import type { Metadata, Viewport } from "next";
import { Figtree, Geist, IBM_Plex_Mono } from "next/font/google";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";
import { Base } from "@/components/base/Base";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });
const display = Figtree({ variable: "--font-figtree", subsets: ["latin"] });
const mono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: { default: "Aftermath", template: "%s · Aftermath" },
  description: "Reconstruct the incident. Understand the response. Improve what happens next.",
};

export const viewport: Viewport = { themeColor: "#0b0c0d", colorScheme: "dark" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${mono.variable} ${display.variable}`}>
      <body>
        <Base>{children}</Base>
      </body>
    </html>
  );
}
