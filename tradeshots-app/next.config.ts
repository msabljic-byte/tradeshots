/**
 * Next.js configuration.
 * - `turbopack.root`: pins Turbopack to this package directory (monorepo-friendly).
 * - `images.remotePatterns`: allow optimized images from the Supabase project host.
 */
import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname),
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "dqseictjuvbakjnrktfz.supabase.co",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;