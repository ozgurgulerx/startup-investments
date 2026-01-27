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
  // Ensure output file tracing includes monorepo root dependencies
  experimental: {
    outputFileTracingRoot: require('path').join(__dirname, '../../'),
  },
  outputFileTracingIncludes: {
    '/*': [
      './node_modules/.pnpm/next-auth*/**/*',
      './node_modules/.pnpm/@auth*/**/*',
      './node_modules/next-auth/**/*',
    ],
  },
};

module.exports = nextConfig;
// Static export v2
