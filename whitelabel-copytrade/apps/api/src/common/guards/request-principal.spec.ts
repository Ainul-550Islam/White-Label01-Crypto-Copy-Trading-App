import { ForbiddenException } from '@nestjs/common';
import {
  authPermissions,
  authRoles,
  authTenantId,
  authTenantIdOrNull,
  authUserIdOrNull,
  isPlatformPrincipal,
  principal,
  resolveTargetTenant,
  hasAdminRole,
} from './request-principal';

/** Shape produced by JwtStrategy.validate. */
function jwtUser(overrides: Record<string, unknown> = {}) {
  return {
    user: {
      userId: 'user-1',
      tenantId: 'tenant-a',
      sessionId: 's',
      roles: ['TENANT_ADMIN'],
      permissions: ['risk:read'],
      isPlatformUser: false,
      tokenId: 'j',
      ...overrides,
    },
    headers: { 'x-tenant-id': 'tenant-b' },
    query: { tenantId: 'tenant-b' },
  };
}

describe('request-principal', () => {
  it('takes the tenant from the token and ignores x-tenant-id / query', () => {
    expect(authTenantId(jwtUser())).toBe('tenant-a');
  });

  it('refuses a request whose token carries no tenant, even with a header', () => {
    const req = { user: { userId: 'u' }, headers: { 'x-tenant-id': 'tenant-b' } };
    expect(() => authTenantId(req as any)).toThrow(ForbiddenException);
    expect(authTenantIdOrNull(req as any)).toBeNull();
    expect(() => authTenantId({ headers: { 'x-tenant-id': 'tenant-b' } } as any)).toThrow(
      'Tenant context required',
    );
  });

  it('reads userId from the JWT principal and the legacy id/sub shapes', () => {
    expect(authUserIdOrNull(jwtUser())).toBe('user-1');
    expect(authUserIdOrNull({ user: { id: 'legacy' } })).toBe('legacy');
    expect(authUserIdOrNull({ user: { sub: 'subject' } })).toBe('subject');
    expect(authUserIdOrNull({ user: {} })).toBeNull();
    expect(authUserIdOrNull(undefined)).toBeNull();
  });

  it('platform reach is the server-side flag only', () => {
    expect(isPlatformPrincipal(jwtUser({ isPlatformUser: true }))).toBe(true);
    // TENANT_ADMIN contains "admin"; a tenant can also create a role literally
    // named PLATFORM_ADMIN. Neither may unlock other tenants.
    expect(isPlatformPrincipal(jwtUser({ roles: ['TENANT_ADMIN'] }))).toBe(false);
    expect(isPlatformPrincipal(jwtUser({ roles: ['PLATFORM_ADMIN', 'platform_admin'] }))).toBe(
      false,
    );
    expect(
      isPlatformPrincipal(jwtUser({ permissions: ['platform:manage', 'PLATFORM_MANAGE'] })),
    ).toBe(false);
    expect(isPlatformPrincipal(jwtUser({ isPlatformUser: 'true' }))).toBe(false);
  });

  it('resolveTargetTenant: own tenant by default, cross-tenant only for platform', () => {
    expect(resolveTargetTenant(jwtUser())).toBe('tenant-a');
    expect(resolveTargetTenant(jwtUser(), 'tenant-a')).toBe('tenant-a');
    expect(() => resolveTargetTenant(jwtUser(), 'tenant-b')).toThrow('Cross-tenant access refused');
    expect(resolveTargetTenant(jwtUser({ isPlatformUser: true }), 'tenant-b')).toBe('tenant-b');
    expect(() => resolveTargetTenant({ user: { userId: 'u' } })).toThrow('Tenant context required');
  });

  it('normalises role and permission lists', () => {
    expect(
      authRoles({ user: { roles: ['A', { key: 'B' }, { role: { key: 'C' } }, 7, null] } }),
    ).toEqual(['A', 'B', 'C']);
    expect(authPermissions({ user: { permissions: 'not-a-list' } })).toEqual([]);
  });

  it('principal() requires both tenant and user', () => {
    expect(principal(jwtUser())).toEqual({
      tenantId: 'tenant-a',
      userId: 'user-1',
      roles: ['TENANT_ADMIN'],
      permissions: ['risk:read'],
      isPlatformUser: false,
    });
    expect(() => principal({ user: { tenantId: 't' } })).toThrow('Authenticated user required');
  });
});

describe('hasAdminRole', () => {
  it('accepts the canonical upper-case system role keys', () => {
    expect(hasAdminRole(['TRADER', 'TENANT_ADMIN'])).toBe(true);
    expect(hasAdminRole(['SUPER_ADMIN'])).toBe(true);
  });

  it('still accepts the legacy lower-case keys and module-specific extras', () => {
    expect(hasAdminRole(['tenant_admin'])).toBe(true);
    expect(hasAdminRole(['research_admin'])).toBe(false);
    expect(hasAdminRole(['research_admin'], ['research_admin'])).toBe(true);
  });

  it('is exact: look-alikes and non-admin roles are refused', () => {
    expect(hasAdminRole(['FOLLOWER', 'TRADER', 'SUPPORT', 'COMPLIANCE'])).toBe(false);
    expect(hasAdminRole(['Tenant_Admin', 'TENANT_ADMIN_X', 'admins'])).toBe(false);
    expect(hasAdminRole([])).toBe(false);
    expect(hasAdminRole(undefined)).toBe(false);
  });
});
