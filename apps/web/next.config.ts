import type { NextConfig } from "next";
import dotenv from "dotenv";

dotenv.config({
  path: "../../.env",
});

const nextConfig: NextConfig = {
  serverExternalPackages: ["@copilotkit/runtime"],
  /** Bundle prebuilt monorepo shell for full-kit workspace download (see prebuild / pack-download-kit). */
  outputFileTracingIncludes: {
    "/api/workspace/download": [".download-kit/base.tar.gz"],
  },
  /**
   * Relax CSP for MCP widget iframes that load scripts from CDNs (esm.sh, unpkg, jsdelivr, etc.).
   * Without this, external MCP servers like Excalidraw fail to render on Vercel.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data: https://esm.sh https://*.esm.sh https://unpkg.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com https://cdn.jsdelivr.net",
              "font-src 'self' data: https://fonts.gstatic.com https://unpkg.com https://cdn.jsdelivr.net",
              "img-src 'self' blob: data: https: http:",
              "connect-src 'self' https: wss:",
              "frame-src 'self' blob: data: https:",
              "worker-src 'self' blob:",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
