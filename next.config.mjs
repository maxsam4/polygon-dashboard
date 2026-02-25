// next.config.mjs
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  compress: true,
  experimental: {
    instrumentationHook: true,
  },
  async headers() {
    return [
      // Public page routes — cache HTML shell at Cloudflare edge
      // All pages are 'use client' with client-side data fetching, so HTML is identical for all visitors
      {
        source: '/',
        headers: [
          {
            key: 'CDN-Cache-Control',
            value: 'public, max-age=60, stale-while-revalidate=300',
          },
        ],
      },
      {
        source: '/alerts',
        headers: [
          {
            key: 'CDN-Cache-Control',
            value: 'public, max-age=60, stale-while-revalidate=300',
          },
        ],
      },
      {
        source: '/analytics',
        headers: [
          {
            key: 'CDN-Cache-Control',
            value: 'public, max-age=60, stale-while-revalidate=300',
          },
        ],
      },
      {
        source: '/blocks',
        headers: [
          {
            key: 'CDN-Cache-Control',
            value: 'public, max-age=60, stale-while-revalidate=300',
          },
        ],
      },
      {
        source: '/blocks/:path*',
        headers: [
          {
            key: 'CDN-Cache-Control',
            value: 'public, max-age=60, stale-while-revalidate=300',
          },
        ],
      },
      {
        source: '/milestones',
        headers: [
          {
            key: 'CDN-Cache-Control',
            value: 'public, max-age=60, stale-while-revalidate=300',
          },
        ],
      },
      // Static assets — immutable, long cache
      {
        source: '/_next/static/:path*',
        headers: [
          {
            key: 'CDN-Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      // API routes — CDN-Cache-Control for Cloudflare edge, Cache-Control for browsers
      {
        source: '/api/chart-data',
        headers: [
          {
            key: 'CDN-Cache-Control',
            value: 'public, max-age=5, stale-while-revalidate=30',
          },
          {
            key: 'Cache-Control',
            value: 'public, s-maxage=5, stale-while-revalidate=30',
          },
        ],
      },
      {
        source: '/api/blocks/latest',
        headers: [
          {
            key: 'CDN-Cache-Control',
            value: 'public, max-age=2, stale-while-revalidate=10',
          },
          {
            key: 'Cache-Control',
            value: 'public, s-maxage=2, stale-while-revalidate=10',
          },
        ],
      },
      {
        source: '/api/milestones/:path*',
        headers: [
          {
            key: 'CDN-Cache-Control',
            value: 'public, max-age=10, stale-while-revalidate=30',
          },
          {
            key: 'Cache-Control',
            value: 'public, s-maxage=10, stale-while-revalidate=30',
          },
        ],
      },
      {
        source: '/api/anomalies',
        headers: [
          {
            key: 'CDN-Cache-Control',
            value: 'public, max-age=10, stale-while-revalidate=30',
          },
          {
            key: 'Cache-Control',
            value: 'public, s-maxage=10, stale-while-revalidate=30',
          },
        ],
      },
      {
        source: '/api/status',
        headers: [
          {
            key: 'CDN-Cache-Control',
            value: 'public, max-age=5, stale-while-revalidate=10',
          },
          {
            key: 'Cache-Control',
            value: 'public, s-maxage=5, stale-while-revalidate=10',
          },
        ],
      },
    ];
  },
}

export default nextConfig
