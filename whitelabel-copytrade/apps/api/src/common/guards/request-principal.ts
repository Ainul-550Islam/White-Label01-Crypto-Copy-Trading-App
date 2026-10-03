import { ForbiddenException } from '@nestjs/common';

/**
 * Identity of the caller, read only from what the JWT strategy put on
 * `req.user` (see modules/auth/strategies/jwt.strategy.ts):
 *   { userId, tenantId, sessionId, roles, permissions, isPlatformUser, tokenId }
 *
 * Rules (docs/SECURITY.md, contributing rule 3 "never trust a client-supplied
 * tenant id"):
 *  - The tenant comes from the verified token. `x-tenant-id` headers, query
 *    strings and bodies are never a source of the caller's tenant.
 *  - "Platform" means the server-side `isPlatformUser` flag loaded from the
 *    user row. Role keys and permission strings are tenant-editable data and
 *    must not grant cross-tenant reach.
 */
export interface RequestPrincipal {
  tenantId: string;
  userId: string;
  roles: string[];
  permissions: string[];
  isPlatformUser: boolean;
}

type AnyRequest = { user?: Record<string, unknown> | null } | null | undefined;

function user(req: AnyRequest): Record<string, unknown> {
  const u = req?.user;
  return u && typeof u === 'object' ? u : {};
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (entry && typeof entry === 'object') {
        const e = entry as Record<string, unknown>;
        const nested =
          e.role && typeof e.role === 'object'
            ? (e.role as Record<string, unknown>).key
            : undefined;
        return nonEmptyString(e.key) ?? nonEmptyString(nested) ?? '';
      }
      return '';
    })
    .filter((s) => s.length > 0);
}

/** Tenant of the authenticated caller, or null when the token carries none. */
export function authTenantIdOrNull(req: AnyRequest): string | null {
  return nonEmptyString(user(req).tenantId);
}

/** Tenant of the authenticated caller; 403 when absent (never a header fallback). */
export function authTenantId(req: AnyRequest): string {
  const tenantId = authTenantIdOrNull(req);
  if (!tenantId) throw new ForbiddenException('Tenant context required');
  return tenantId;
}

/** User id of the authenticated caller, or null. Accepts the legacy `id`/`sub` shapes. */
export function authUserIdOrNull(req: AnyRequest): string | null {
  const u = user(req);
  return nonEmptyString(u.userId) ?? nonEmptyString(u.id) ?? nonEmptyString(u.sub);
}

/** Server-side platform flag only. */
export function isPlatformPrincipal(req: AnyRequest): boolean {
  return user(req).isPlatformUser === true;
}

export function authRoles(req: AnyRequest): string[] {
  return stringList(user(req).roles);
}

/**
 * Administrative role check for in-controller authorisation.
 *
 * System role keys are upper case (`SystemRole` in @wlct/shared-types:
 * SUPER_ADMIN, TENANT_ADMIN). Several controllers compared against
 * lower-case keys ('admin', 'tenant_admin', 'platform_admin') that no seeded
 * role has, so real administrators were refused. Matching is exact and
 * case-sensitive on the canonical keys; the legacy lower-case keys are still
 * accepted for tenants that created custom roles with those names, and
 * `extraRoles` lets a module add its own (e.g. research_admin). Tenant scope
 * is unaffected: it always comes from the token.
 */
export const ADMIN_ROLE_KEYS: readonly string[] = ['SUPER_ADMIN', 'TENANT_ADMIN', 'admin', 'tenant_admin', 'platform_admin'];

export function hasAdminRole(roles: readonly string[] | undefined | null, extraRoles: readonly string[] = []): boolean {
  if (!Array.isArray(roles)) return false;
  return roles.some((r) => ADMIN_ROLE_KEYS.includes(r) || extraRoles.includes(r));
}

export function authPermissions(req: AnyRequest): string[] {
  return stringList(user(req).permissions);
}

/**
 * Resolve the tenant a request may act on. A requested tenant different from
 * the caller's own is allowed only for platform principals; everyone else gets
 * 403. With no requested tenant, the caller's own tenant is used.
 */
export function resolveTargetTenant(req: AnyRequest, requested?: string | null): string {
  const own = authTenantIdOrNull(req);
  const wanted = nonEmptyString(requested ?? null);
  if (wanted && wanted !== own) {
    if (isPlatformPrincipal(req)) return wanted;
    throw new ForbiddenException('Cross-tenant access refused');
  }
  if (!own) throw new ForbiddenException('Tenant context required');
  return own;
}

export function principal(req: AnyRequest): RequestPrincipal {
  const userId = authUserIdOrNull(req);
  if (!userId) throw new ForbiddenException('Authenticated user required');
  return {
    tenantId: authTenantId(req),
    userId,
    roles: authRoles(req),
    permissions: authPermissions(req),
    isPlatformUser: isPlatformPrincipal(req),
  };
}
