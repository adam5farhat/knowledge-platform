import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Avoid a Windows dev-runtime bug where the segment explorer devtool can break the RSC manifest.
    devtoolSegmentExplorer: false,
  },
};

export default nextConfig;
