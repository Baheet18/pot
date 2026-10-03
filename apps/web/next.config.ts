import type { NextConfig } from "next";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  agentRules: false,
  // Persistent build caches can snapshot env/config; keep them off. Secrets are read from files at runtime anyway.
  experimental: { turbopackFileSystemCacheForDev: false, turbopackFileSystemCacheForBuild: false },
  turbopack: { root },
  outputFileTracingRoot: root,
  serverExternalPackages: ["better-sqlite3"],
  transpilePackages: ["@pot/core", "@pot/server", "@solana/wallet-adapter-base", "@solana/wallet-adapter-react", "@solana/wallet-adapter-react-ui", "@solana/wallet-adapter-phantom"],
  images: { remotePatterns: [{ protocol: "https", hostname: "res.cloudinary.com" }] },
  async headers() {
    return [{ source: "/actions.json", headers: [{ key: "Access-Control-Allow-Origin", value: "*" }] }];
  },
};
export default nextConfig;
