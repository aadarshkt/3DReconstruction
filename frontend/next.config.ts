import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: "http://localhost:8000/api/v1/:path*",
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
