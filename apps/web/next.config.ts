import type { NextConfig } from "next";
import bundleAnalyzer from "@next/bundle-analyzer";

const withBundleAnalyzer = bundleAnalyzer({
  /** Dev/CI only: `npm run analyze:web` at repo root. No effect on normal `next build`. */
  enabled: process.env.ANALYZE === "true",
});

const nextConfig: NextConfig = {
  experimental: {
    // Avoid a Windows dev-runtime bug where the segment explorer devtool can break the RSC manifest.
    devtoolSegmentExplorer: false,
  },
  /** Avoid `app/favicon.ico/route.ts` (segment name breaks some Next dev builds); serve `public/icon.svg` instead. */
  async rewrites() {
    return [{ source: "/favicon.ico", destination: "/icon.svg" }];
  },
};

export default withBundleAnalyzer(nextConfig);
