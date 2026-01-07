/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Ensure static assets under /.well-known are served correctly
  async headers() {
    return [
      {
        source: "/.well-known/farcaster.json",
        headers: [{ key: "Content-Type", value: "application/json; charset=utf-8" }],
      },
    ];
  },
};
export default nextConfig;
