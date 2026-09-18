import type { NextConfig } from "next";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";
const TOUR_SERVICE_URL = process.env.TOUR_SERVICE_URL || "http://localhost:8001";
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || "http://localhost:8002";

const nextConfig: NextConfig = {
  output: "standalone",
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
