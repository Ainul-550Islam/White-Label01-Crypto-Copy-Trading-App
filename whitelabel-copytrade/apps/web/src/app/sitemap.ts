// # Serves /sitemap.xml: the public routes, and only those, on the deployment's own host
import type { MetadataRoute } from 'next';
import { PUBLIC_ROUTES, publicUrlFor } from '@/lib/public-origin';

/**
 * Lists the allowlisted public routes and nothing else. Two deliberate omissions:
 *
 * - No dynamic trader or strategy detail pages. They are not in the crawler allowlist yet (see
 *   `lib/public-origin.ts`), and a sitemap entry for a URL `robots.txt` refuses is a contradiction
 *   crawlers report as an error.
 * - No `lastModified`. The one honest source for it would be a per-route build timestamp, and a
 *   fabricated or process-start date is worse than the omitted field: crawlers that learn a
 *   sitemap's dates are noise stop trusting its dates.
 *
 * With no public origin configured this returns an empty list, which serves a valid empty
 * urlset: nothing is advertised, and nothing is guessed.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = [];

  for (const route of PUBLIC_ROUTES) {
    const url = publicUrlFor(route);
    if (url !== null) {
      entries.push({ url });
    }
  }

  return entries;
}
