import type { Metadata } from "next";
import { Gelasio, Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
  /** Primary UI font — preload for faster first text paint (body uses `var(--font-inter)`). */
  preload: true,
});

const gelasio = Gelasio({
  subsets: ["latin"],
  variable: "--font-gelasio",
  display: "swap",
  preload: false,
});

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
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${gelasio.variable}`}>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
