/** @type {import('next').NextConfig} */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig = {
  serverExternalPackages: ["@mysten-incubation/memwal", "@mysten/seal", "@mysten/walrus"],
  // The marketing landing page is a standalone HTML file. /app is the player experience;
  // /operator is the backstage page for the person running the ledger.
  async rewrites() {
    return { beforeFiles: [{ source: "/", destination: "/landing.html" }] };
  },
  async redirects() {
    return [{ source: "/forecast", destination: "/app", permanent: false }];
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
