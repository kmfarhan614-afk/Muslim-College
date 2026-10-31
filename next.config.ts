import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: false,
  reactStrictMode: true,
  turbopack: {
    root: process.cwd(),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  images: {
    remotePatterns: [],
    dangerouslyAllowSVG: false,
  },
};

export default nextConfig;
