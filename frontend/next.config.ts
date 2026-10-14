import type { NextConfig } from "next";

// Set NEXT_PUBLIC_API_BASE_URL in .env.local (local) or Vercel env vars (prod).
// For Cloudflare Tunnel deployments, this will be your tunnel hostname,
// e.g. https://deez-dragons-api.yourdomain.com
const CF_TUNNEL_HOST = process.env.CF_TUNNEL_HOSTNAME ?? "";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },

  // Allow <img> tags to load AI-generated images from the API host
  images: {
    remotePatterns: [
      // Local dev
      { protocol: "http", hostname: "localhost", port: "8000", pathname: "/static/**" },
      // Cloudflare Tunnel hostname (set CF_TUNNEL_HOSTNAME in env)
      ...(CF_TUNNEL_HOST
        ? [{ protocol: "https" as const, hostname: CF_TUNNEL_HOST, pathname: "/static/**" }]
        : []),
    ],
  },

  // Security + PWA-friendly response headers
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      {
        // Service worker must be served from root with correct MIME type
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/manifest.json",
        headers: [
          { key: "Content-Type", value: "application/manifest+json" },
          { key: "Cache-Control", value: "public, max-age=86400" },
        ],
      },
    ];
  },
};

export default nextConfig;
