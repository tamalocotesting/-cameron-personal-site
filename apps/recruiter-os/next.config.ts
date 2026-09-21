import type { NextConfig } from 'next';

/**
 * Security headers are set here so they apply to every response, including
 * ones served straight from the Next.js cache. TLS termination, HSTS and
 * network restrictions belong to the hosting layer — see DEPLOYMENT.md.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      // Next.js injects inline bootstrap scripts; styles are Tailwind-generated.
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      // No external font/CDN requests: fonts are the system stack.
      "font-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join('; '),
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Standalone output is what the container image runs. `pnpm start` goes
  // through scripts/start.mjs, which assembles the standalone tree the same
  // way the Dockerfile does.
  output: 'standalone',
  // This app lives in a subdirectory of a repository that has its own
  // lockfile, so the tracing root has to be stated rather than inferred.
  outputFileTracingRoot: import.meta.dirname,
  experimental: {
    // Case data must never be cached in a shared/public cache.
    serverActions: { bodySizeLimit: '256kb' },
  },
  serverExternalPackages: ['pg-boss', '@prisma/client', 'twilio'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
