/** @type {import('next').NextConfig} */
const nextConfig = {
  // The appDir is now default in Next.js 14, so we don't need this experimental flag
  experimental: {
    serverActions: {
      bodySizeLimit: '100mb',
    },
  },
};

module.exports = nextConfig;
