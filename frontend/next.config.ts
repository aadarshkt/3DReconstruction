import type { NextConfig } from "next";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";
const TOUR_SERVICE_URL = process.env.TOUR_SERVICE_URL || BACKEND_URL;

const nextConfig: NextConfig = {
  async rewrites() {
    return [
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
        destination: "http://localhost:8000/claims/:path*",
      },
      {
        source: "/jobs/:path*",
        destination: "http://localhost:8000/jobs/:path*",
      },
      {
        source: "/static/:path*",
        destination: "http://localhost:8000/static/:path*",
      },
    ];
  },
};

export default nextConfig;
