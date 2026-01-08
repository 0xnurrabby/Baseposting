/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Mini Apps are embedded; keep console clean and avoid trying to optimize away hydration issues.
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
};
export default nextConfig;
