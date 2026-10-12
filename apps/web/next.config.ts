import createMDX from '@next/mdx';
import type { NextConfig } from 'next';

const isProd = process.env.NODE_ENV === 'production';

/**
 * Inline scripts are unavoidable without nonces (Next's bootstrap and our JSON-LD), so
 * script-src allows 'unsafe-inline'; everything else is locked to this origin.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  ...(isProd ? [{ key: 'Content-Security-Policy', value: contentSecurityPolicy }] : []),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  pageExtensions: ['ts', 'tsx', 'mdx'],
  transpilePackages: ['@parkease/contracts', '@parkease/tokens'],
  headers() {
    return Promise.resolve([{ source: '/(.*)', headers: securityHeaders }]);
  },
  redirects() {
    // People search for both spellings; the indexed URL is the one in lib/cities.ts.
    return Promise.resolve([{ source: '/bengaluru', destination: '/bangalore', permanent: true }]);
  },
  webpack(config: { resolve: { extensionAlias?: Record<string, string[]> } }) {
    // The workspace packages are NodeNext source: `./x.js` imports name `.ts` files.
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] };
    return config;
  },
};

export default createMDX({})(nextConfig);
