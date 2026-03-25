import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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