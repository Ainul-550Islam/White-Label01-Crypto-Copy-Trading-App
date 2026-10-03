import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { BindTenantParamsGuard } from './bind-tenant-params.guard';

/**
 * Governance DTOs take tenantId as an ordinary body/query field. The global
 * TenantGuard binds the tenant from the verified token but never looked at
 * those fields, so any user could name another tenant. This guard pins them.
 */
function run(request: Record<string, unknown>): boolean {
  const context = {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return new BindTenantParamsGuard().canActivate(context);
}

describe('BindTenantParamsGuard', () => {
  it('fills a missing tenantId in body and query with the bound tenant', () => {
    const request = { tenantContext: { tenantId: 't-1' }, query: {}, body: { reason: 'x' } };
    expect(run(request)).toBe(true);
    expect(request.query).toEqual({ tenantId: 't-1' });
    expect(request.body).toEqual({ reason: 'x', tenantId: 't-1' });
  });

  it('treats null and empty string as missing, so an optional field never means "all tenants"', () => {
    const request = { tenantContext: { tenantId: 't-1' }, query: { tenantId: '' }, body: { tenantId: null } };
    run(request);
    expect(request.query.tenantId).toBe('t-1');
    expect(request.body.tenantId).toBe('t-1');
  });

  it('rejects another tenant in the body', () => {
    const request = { tenantContext: { tenantId: 't-1' }, query: {}, body: { tenantId: 't-2' } };
    expect(() => run(request)).toThrow(ForbiddenException);
  });

  it('rejects another tenant in the query', () => {
    const request = { tenantContext: { tenantId: 't-1' }, query: { tenantId: 't-2' }, body: {} };
    expect(() => run(request)).toThrow(ForbiddenException);
  });

  it('passes a matching tenantId unchanged', () => {
    const request = { tenantContext: { tenantId: 't-1' }, query: { tenantId: 't-1' }, body: { tenantId: 't-1' } };
    expect(run(request)).toBe(true);
  });

  it('prefers the resolved tenant context (a platform operator selection) over the token tenant', () => {
    const request = {
      tenantContext: { tenantId: 't-selected' },
      actor: { tenantId: 't-home' },
      query: {},
      body: { tenantId: 't-selected' },
    };
    expect(run(request)).toBe(true);
    expect(request.query).toEqual({ tenantId: 't-selected' });
  });

  it('falls back to the actor tenant and refuses when there is no tenant at all', () => {
    const withActor = { actor: { tenantId: 't-home' }, query: {}, body: {} };
    run(withActor);
    expect(withActor.body).toEqual({ tenantId: 't-home' });
    expect(() => run({ query: {}, body: {} })).toThrow(ForbiddenException);
  });

  it('leaves array and non-object bodies alone', () => {
    const request = { tenantContext: { tenantId: 't-1' }, query: {}, body: ['a'] };
    expect(run(request)).toBe(true);
    expect(request.body).toEqual(['a']);
  });
});
