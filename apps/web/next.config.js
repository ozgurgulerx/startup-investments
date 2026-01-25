/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@startup-intelligence/shared'],
  // Use 'standalone' for Azure Static Web Apps with server features
  // Use 'export' for fully static deployment (disables API routes & auth)
  output: process.env.STATIC_EXPORT === 'true' ? 'export' : 'standalone',
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  env: {
    DATA_PATH: process.env.DATA_PATH || './data',
  },
};

module.exports = nextConfig;
