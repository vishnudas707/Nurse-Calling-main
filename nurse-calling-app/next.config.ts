import type { NextConfig } from "next";
import withFlowbiteReact from "flowbite-react/plugin/nextjs";
import path from "path";

const nextConfig: NextConfig = {
  // Standalone build: produces .next/standalone/server.js, which PM2 runs on the server.
  output: "standalone",
  // Keeps server.js at the standalone root instead of nested under a parent path.
  outputFileTracingRoot: path.join(__dirname),
  // Run `npm run lint` separately — combined lint + typecheck often OOMs on low-RAM machines.
  eslint: {
    ignoreDuringBuilds: true,
  },
  webpack: (config, { dev }) => {
    // Avoid intermittent ENOENT issues in .next/cache/webpack on Windows dev.
    if (dev) config.cache = false;
    return config;
  },
};

export default withFlowbiteReact(nextConfig);
