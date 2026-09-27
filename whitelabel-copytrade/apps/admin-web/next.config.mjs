/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Produces .next/standalone so the Docker runtime image ships only the
  // server bundle and its traced dependencies.
  output: 'standalone',
  // The admin console is a first-party app; transpile the workspace packages
  // rather than publishing build artefacts for them.
  transpilePackages: ['@wlct/shared-types', '@wlct/validation'],
  experimental: {
    typedRoutes: false,
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
