// # Resolves the canonical public origin and the crawler allowlist for web robots/sitemap
//
// One module, two consumers. `robots.txt` and `sitemap.xml` describe the same surface to the same
// crawler, so the list of public routes and the host they are advertised under live here rather
// than being restated in each reserved route file, where they could disagree.
//
// Two decisions are made here and both fail closed:
//
// 1. The origin. A crawler is told a host only when we can name one. An empty, loopback, `.local`
//    or `.invalid` host resolves to `null`, and a `null` origin makes `robots.txt` refuse
//    everything. A development or misconfigured deployment is therefore never indexed, and the
//    sitemap is never built on a guessed host. The decision itself is `resolveOrigin`, a pure
//    function of the two configuration strings, so it can be tested for every host shape rather
//    than only for whichever one the test environment happens to carry.
//
// 2. The crawl policy is default-deny, not default-allow. Only the routes in `PUBLIC_ROUTES` are
//    crawlable; everything else - the authenticated app, the tenant surfaces, and any route added
//    later that nobody remembered to classify - is disallowed by the catch-all. Dynamic detail
//    pages (`/traders/[id]`, `/strategies/[id]`) are deliberately *not* in the allowlist yet: no
//    page in this app emits its own robots metadata, so a record that is public for one viewer and
//    private for another cannot mark itself `noindex`. Advertising those URLs before they can
//    disavow indexing would be trading a private-data leak for a little discoverability. Adding a
//    `generateMetadata` robots tag to a page is the prerequisite, and the allowlist is where it
//    gets added afterwards.
import { runtimeConfig } from '@/config/runtime-config';

/** Routes that exist for anonymous visitors and are safe to index. */
export const PUBLIC_ROUTES: readonly string[] = [
  '/',
  '/pricing',
  '/traders',
  '/strategies',
  '/terms',
  '/privacy',
];

/** Route prefixes that must never be indexed, whichever page is serving them. */
export const PRIVATE_ROUTE_PREFIXES: readonly string[] = [
  '/account',
  '/activity',
  '/api',
  '/billing',
  '/copy-trading',
  '/dashboard',
  '/exchanges',
  '/funding',
  '/login',
  '/notifications',
  '/onboarding',
  '/partner',
  '/portfolio',
  '/register',
  '/risk',
  '/security',
  '/statements',
  '/status',
  '/support',
  '/traders/apply',
];

/** Hosts that name a machine rather than a deployment, and must never be advertised to a crawler. */
const NON_PUBLIC_HOSTS: readonly string[] = ['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'];

/** Suffixes reserved by RFC 2606/6761 for local and invalid names. */
const NON_PUBLIC_SUFFIXES: readonly string[] = ['.local', '.localhost', '.test', '.invalid', '.example'];

/** A bare IPv4 literal names one machine, not a brand, and cannot hold a public TLS certificate. */
const IPV4_LITERAL = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * The origin crawlers should be told about, from the configured site URL if there is one and the
 * platform domain otherwise, or `null` when this deployment cannot name a public host.
 *
 * Pure: the two strings in, the decision out. Callers must refuse to be indexed on `null` rather
 * than inventing a host.
 */
export function resolveOrigin(siteUrl: string, platformDomain: string): string | null {
  const configured = siteUrl.trim();
  const raw = configured.length > 0 ? configured : `https://${platformDomain.trim()}`;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  if (host.length === 0) {
    return null;
  }
  if (NON_PUBLIC_HOSTS.includes(host)) {
    return null;
  }
  if (NON_PUBLIC_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return null;
  }
  if (IPV4_LITERAL.test(host)) {
    return null;
  }

  return parsed.origin;
}

/** The origin this deployment should be reachable at, or `null` when it cannot name one. */
export function resolvePublicOrigin(): string | null {
  return resolveOrigin(runtimeConfig.siteUrl, runtimeConfig.platformDomain);
}

/** The absolute URL for a public route, or `null` when no public origin is configured. */
export function publicUrlFor(path: string): string | null {
  const origin = resolvePublicOrigin();
  if (origin === null) {
    return null;
  }
  return path === '/' ? `${origin}/` : `${origin}${path}`;
}
