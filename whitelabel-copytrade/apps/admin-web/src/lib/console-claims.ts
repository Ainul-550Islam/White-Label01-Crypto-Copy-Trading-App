import { decodeAccessTokenClaims, getAccessToken } from '@/lib/session';

/**
 * Server-side view of the session claims for page rendering (round 7).
 *
 * Exactly like the sidebar, this is a usability filter: it decides which
 * notices and buttons a page renders. It is NOT access control - the API
 * re-authorises every request these pages make and is the only authority.
 */
export interface ConsoleClaims {
  userId: string;
  tenantId: string;
  permissions: string[];
  isPlatformUser: boolean;
}

export function getConsoleClaims(): ConsoleClaims | null {
  const token = getAccessToken();
  if (!token) {
    return null;
  }
  const claims = decodeAccessTokenClaims(token);
  if (!claims) {
    return null;
  }
  return { userId: claims.sub, tenantId: claims.tid, permissions: claims.perms, isPlatformUser: claims.plat };
}

/** Same matching rule as the sidebar: exact permission, `resource:*`, or `*`. */
export function hasPermission(claims: ConsoleClaims | null, permission: string): boolean {
  if (!claims) {
    return false;
  }
  const granted = new Set(claims.permissions);
  if (granted.has('*') || granted.has(permission)) {
    return true;
  }
  const [resource] = permission.split(':');
  return granted.has(`${resource}:*`);
}
