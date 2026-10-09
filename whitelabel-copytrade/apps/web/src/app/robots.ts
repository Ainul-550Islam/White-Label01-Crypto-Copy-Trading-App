// # Serves /robots.txt: default-deny crawler policy that allowlists only the public routes
import type { MetadataRoute } from 'next';
import { PRIVATE_ROUTE_PREFIXES, PUBLIC_ROUTES, resolvePublicOrigin } from '@/lib/public-origin';

/**
 * Default-deny. An unrecognised route is not crawlable, so a new authenticated page is private
 * the moment it is added rather than after someone remembers to list it here. The explicit
 * `Disallow: /` plus per-route `Allow` entries rely on the rule that the most specific match
 * wins, which is how every major crawler resolves an overlapping allow and disallow.
 *
 * When the deployment cannot name a public host, this returns the catch-all alone: no sitemap
 * pointer, no allowlist, nothing indexable.
 */
export default function robots(): MetadataRoute.Robots {
  const origin = resolvePublicOrigin();

  if (origin === null) {
    return {
      rules: [{ userAgent: '*', disallow: '/' }],
    };
  }

  return {
    rules: [
      {
        userAgent: '*',
        allow: [...PUBLIC_ROUTES],
        disallow: ['/', ...PRIVATE_ROUTE_PREFIXES],
      },
    ],
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
