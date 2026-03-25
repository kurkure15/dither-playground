/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { dev }) => {
    if (dev) {
      // Use unique chunk IDs in dev to prevent stale cache errors on reload
      config.output.chunkFilename = 'static/chunks/[name].[contenthash].js';
    }
    return config;
  },
};

export default nextConfig;
