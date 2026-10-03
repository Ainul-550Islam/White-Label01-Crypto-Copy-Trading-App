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
export const ANONYMOUS_GET_PATHS: ReadonlySet<string> = new Set(['tenants/public-config']);

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
  return ANONYMOUS_GET_PATHS.has(withoutVersion(segments, apiVersion).join('/'));
}

export function isUnsafeSegment(segment: string): boolean {
  return segment.includes('..') || segment.includes('\\');
}
