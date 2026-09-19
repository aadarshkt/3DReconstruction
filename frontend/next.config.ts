import type { NextConfig } from "next";
import fs from "fs";

// Detect if running inside Docker to provide a seamless default to host backend
const isDocker = fs.existsSync("/.dockerenv");
const defaultBackend = isDocker ? "http://host.docker.internal:8000" : "http://localhost:8000";

const BACKEND_URL = process.env.BACKEND_URL || defaultBackend;
const TOUR_SERVICE_URL = process.env.TOUR_SERVICE_URL || (isDocker ? "http://tour_service:8001" : "http://localhost:8001");
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || (isDocker ? "http://auth_service:8002" : "http://localhost:8002");

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    // Support large multi-file and 4K video uploads up to 1GB through Next.js proxy
    proxyClientMaxBodySize: "1024mb",
  },
  async rewrites() {
    return [
      {
        source: "/api/v1/auth/:path*",
        destination: `${AUTH_SERVICE_URL}/api/v1/auth/:path*`,
      },
      {
        source: "/api/v1/tour/:path*",
        destination: `${TOUR_SERVICE_URL}/api/v1/tour/:path*`,
      },
      {
        source: "/api/v1/:path*",
        destination: `${BACKEND_URL}/api/v1/:path*`,
      },
      {
        source: "/claims/:path*",
        destination: `${BACKEND_URL}/claims/:path*`,
      },
      {
        source: "/jobs/:path*",
        destination: `${BACKEND_URL}/jobs/:path*`,
      },
      {
        source: "/static/:path*",
        destination: `${BACKEND_URL}/static/:path*`,
      },
    ];
  },
};

export default nextConfig;
