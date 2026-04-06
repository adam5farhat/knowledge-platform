import type { Metadata } from "next";
import "./globals.css";

/**
 * Fonts use system stacks in `globals.css` (--font-inter / --font-gelasio) instead of
 * `next/font/google`. That avoids dev/SSR fetches to fonts.googleapis.com, which can hang
 * on some networks and leave the browser tab spinning with no paint.
 */

export const metadata: Metadata = {
  title: "Knowledge Platform",
  description: "Enterprise knowledge intelligence",
  icons: {
    icon: "/icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
