import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@parkease/contracts', '@parkease/tokens'],
};

export default nextConfig;
