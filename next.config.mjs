/** @type {import('next').NextConfig} */
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
};

export default nextConfig;
