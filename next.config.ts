import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  ...(process.env.CAPACITOR_BUILD === "true" ? { output: "export" } : {}),
  images: {
    unoptimized: true,
  },
};

export default nextConfig;