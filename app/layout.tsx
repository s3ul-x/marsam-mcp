import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

const plex = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-plex",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Marsam MCP — Painting Studio",
  description:
    "A web painting studio with layers, pressure brushes and project files, plus an MCP server that lets AI clients paint, compose layers and export images.",
  applicationName: "Marsam MCP",
  keywords: ["painting", "canvas", "brush", "layers", "export", "drawing", "mcp"],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#0b0b0c",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" dir="ltr" className={plex.variable}>
      <body className="bg-background text-foreground antialiased">{children}</body>
    </html>
  );
}
