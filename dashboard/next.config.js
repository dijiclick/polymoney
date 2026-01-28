/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Enable file polling for Windows compatibility
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        poll: 1000,
        aggregateTimeout: 300,
      }
    }
    return config
  },
}

module.exports = nextConfig
