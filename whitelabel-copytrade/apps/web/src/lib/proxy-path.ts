/**
 * Path rules for the /api/proxy/* route handler. Kept out of the route file
 * because a Next.js route module may only export HTTP handlers and route
 * segment config.
 */

/**
 * Backend routes that are @Public() and needed before sign-in. They are
 * forwarded without a session and never carry an Authorization header. Only
 * GET is allowed, and only exact paths (after the version segment) - nothing
 * else is reachable anonymously through the proxy.
 */
export const ANONYMOUS_GET_PATHS: ReadonlySet<string> = new Set(['public/fee-schedule']);

function withoutVersion(segments: readonly string[], apiVersion: string): readonly string[] {
  return segments[0] === apiVersion ? segments.slice(1) : segments;
}

/**
 * Callers may write '/v1/notifications' or '/notifications'. The backend
 * version is added exactly once - the same rule serverFetch applies - so a
 * leading version segment is never doubled into /v1/v1/...
 */
export function buildUpstreamPath(segments: readonly string[], apiVersion: string): string {
  return [apiVersion, ...withoutVersion(segments, apiVersion)].join('/');
}

export function isAnonymousRoute(method: string, segments: readonly string[], apiVersion: string): boolean {
  if (method !== 'GET') return false;
  const path = withoutVersion(segments, apiVersion);
  return path.length === 2 && path[0] === 'public' && path[1] === 'fee-schedule';
}

/** Check the pathname visible to this handler as well as the route parameters.
 * Next normalizes dot segments before constructing Request and redirects double
 * slashes before this code runs; strict raw-path rejection also needs an ingress
 * that blocks those spellings before they reach Next. */
export function isExactAnonymousProxyUrl(url: string, apiVersion: string): boolean {
  // Do not use new URL().pathname here: WHATWG URL parsing collapses encoded
  // dot segments, erasing the very traversal spelling we need to reject.
  const match = /^https?:\/\/[^/?#]+(\/[^?#]*)(?:[?#]|$)/i.exec(url);
  const path = match?.[1];
  return path === '/api/proxy/public/fee-schedule' || path === `/api/proxy/${apiVersion}/public/fee-schedule`;
}

export function isUnsafeSegment(segment: string): boolean {
  // Next normally decodes one layer, but reject encoded and double-encoded
  // traversal and separators too; never let URL normalisation change the route.
  let candidate = segment;
  for (let depth = 0; depth < 4; depth += 1) {
    if (!candidate || candidate.includes('..') || /[\\/\x00-\x1f\x7f]/.test(candidate)) return true;
    if (!candidate.includes('%')) return false;
    try {
      const decoded = decodeURIComponent(candidate);
      if (decoded === candidate) return false;
      candidate = decoded;
    } catch {
      return true;
    }
  }
  // Excessively nested encoding is not a valid simple path segment.
  return candidate.includes('%');
}
