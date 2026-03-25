/** @type {import('next').NextConfig} */
const nextConfig = {
  // Disable Strict Mode — prevents double-mount of effects in dev,
  // which causes race conditions with async image loading + animation loops
  reactStrictMode: false,
};

export default nextConfig;
