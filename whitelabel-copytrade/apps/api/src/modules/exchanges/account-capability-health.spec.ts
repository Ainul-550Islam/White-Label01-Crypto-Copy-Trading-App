// # Responsibility: prove the capability matrix refuses to call an unverified, stale, expired or withdraw-capable key healthy.
import { describe, expect, it } from '@jest/globals';

import {
  AccountCapabilityHealthService,
  type CapabilityHealthInput,
  type CapabilityRow,
} from './account-capability-health.service';
import { ExchangeAccountState, ExchangeHealthState } from './exchange.types';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-10-26T12:00:00.000Z');

function input(overrides: Partial<CapabilityHealthInput> = {}): CapabilityHealthInput {
  return {
    tenantId: TENANT,
    accountId: 'account-1',
    venue: 'BINANCE',
    environment: 'LIVE',
    accountState: ExchangeAccountState.ACTIVE,
    healthState: ExchangeHealthState.HEALTHY,
    canReadData: true,
    canTrade: true,
    canWithdraw: false,
    verifiedPermissions: ['SPOT', 'TRADE'],
    lastVerifiedAt: new Date('2026-10-26T11:55:00.000Z'),
    lastFailureCode: null,
    consecutiveFailures: 0,
    credentialExpiresAt: null,
    ...overrides,
  };
}

function service(options: { maxEvidenceAgeMs?: number; failureThreshold?: number } = {}): AccountCapabilityHealthService {
  return new AccountCapabilityHealthService({ ...options, now: () => NOW });
}

function row(result: ReturnType<AccountCapabilityHealthService['evaluate']>, capability: string): CapabilityRow {
  const found = result.capabilities.find((entry) => entry.capability === capability);
  if (!found) throw new Error(`no ${capability} row in the matrix`);
  return found;
}

describe('Account capability health', () => {
  it('reports healthy for a verified read-and-trade key that cannot withdraw', () => {
    const result = service().evaluate(input());

    expect(result.overall).toBe('HEALTHY');
    expect(result.requiresAction).toEqual([]);
    expect(row(result, 'READ')).toMatchObject({ state: 'OK', granted: true });
    expect(row(result, 'TRADE')).toMatchObject({ state: 'OK', granted: true });
    expect(row(result, 'WITHDRAW')).toMatchObject({ state: 'OK', granted: false });
    expect(result.verifiedAt).toBe('2026-10-26T11:55:00.000Z');
    expect(result.evidenceAgeMs).toBe(5 * 60 * 1_000);
  });

  it('never reports margin as a fault just because the venue does not offer it', () => {
    const result = service().evaluate(input());

    const margin = row(result, 'MARGIN');
    expect(margin.state).toBe('UNKNOWN');
    expect(margin.countsTowardOverall).toBe(false);
    expect(result.overall).toBe('HEALTHY');
  });

  it('treats a withdraw-capable key as RISK, not as a working account', () => {
    const result = service().evaluate(input({ canWithdraw: true }));

    expect(result.overall).toBe('RISK');
    expect(row(result, 'WITHDRAW')).toMatchObject({ state: 'RISK', reason: 'WITHDRAWAL_ENABLED' });
    expect(result.requiresAction).toContain('ROTATE_KEY_WITHOUT_WITHDRAWAL');
  });

  it('outranks a read-only limitation with the withdrawal hazard', () => {
    // Both rows are bad; the operator must be told about the hazard first, so the
    // overall verdict cannot be the milder of the two.
    const result = service().evaluate(input({ canTrade: false, canWithdraw: true }));

    expect(result.overall).toBe('RISK');
  });

  it('reports a read-only key as degraded on trading while reads stay usable', () => {
    const result = service().evaluate(input({ canTrade: false, verifiedPermissions: ['SPOT'] }));

    expect(result.overall).toBe('DEGRADED');
    expect(row(result, 'TRADE')).toMatchObject({ state: 'DEGRADED', reason: 'KEY_IS_READ_ONLY' });
    expect(row(result, 'READ')).toMatchObject({ state: 'OK' });
  });

  it('reports never-verified permissions as UNKNOWN rather than as absent', () => {
    const result = service().evaluate(
      input({ verifiedPermissions: null, lastVerifiedAt: null, canReadData: null, canTrade: null, canWithdraw: null }),
    );

    expect(result.overall).toBe('UNKNOWN');
    expect(result.verifiedAt).toBeNull();
    expect(result.evidenceAgeMs).toBeNull();
    expect(result.capabilities.every((entry) => entry.state === 'UNKNOWN')).toBe(true);
    expect(result.capabilities.every((entry) => entry.reason === 'PERMISSION_NEVER_VERIFIED')).toBe(true);
    expect(result.requiresAction).toEqual(['VERIFY_PERMISSIONS']);
  });

  it('does not read an empty permission list as never verified', () => {
    // Verified and empty is a fact: the venue reported no permissions. It is still
    // not healthy, but the reason must not claim we never asked.
    const result = service().evaluate(
      input({ verifiedPermissions: [], canReadData: false, canTrade: false, canWithdraw: false }),
    );

    expect(result.verifiedAt).not.toBeNull();
    expect(result.capabilities.some((entry) => entry.reason === 'PERMISSION_NEVER_VERIFIED')).toBe(false);
  });

  it('degrades evidence that has outlived its bound and asks for a re-check', () => {
    const result = service({ maxEvidenceAgeMs: 60 * 60 * 1_000 }).evaluate(
      input({ lastVerifiedAt: new Date('2026-10-26T10:30:00.000Z') }),
    );

    expect(result.overall).toBe('DEGRADED');
    expect(row(result, 'TRADE')).toMatchObject({ state: 'DEGRADED', reason: 'PERMISSION_VERIFICATION_STALE' });
    expect(result.requiresAction).toContain('VERIFY_PERMISSIONS');
  });

  it('keeps evidence exactly at the bound fresh and one millisecond past it stale', () => {
    const svc = service({ maxEvidenceAgeMs: 60_000 });
    const atBound = svc.evaluate(input({ lastVerifiedAt: new Date(NOW.getTime() - 60_000) }));
    const pastBound = svc.evaluate(input({ lastVerifiedAt: new Date(NOW.getTime() - 60_001) }));

    expect(atBound.overall).toBe('HEALTHY');
    expect(pastBound.overall).toBe('DEGRADED');
  });

  it('marks a revoked connection unhealthy whatever the stored permissions say', () => {
    const result = service().evaluate(input({ accountState: ExchangeAccountState.REVOKED }));

    expect(result.overall).toBe('UNHEALTHY');
    expect(result.capabilities.every((entry) => entry.state === 'UNHEALTHY')).toBe(true);
    expect(result.capabilities[0].reason).toBe('ACCOUNT_REVOKED');
    expect(result.requiresAction).toEqual(['RECONNECT_KEY']);
  });

  it('marks a failed venue check UNKNOWN and an errored account unhealthy', () => {
    const failedCheck = service().evaluate(input({ healthState: ExchangeHealthState.AUTH_FAILED, consecutiveFailures: 1 }));
    const errored = service().evaluate(input({ accountState: ExchangeAccountState.ERROR }));

    // One failure does not erase the last verified permissions...
    expect(failedCheck.verifiedAt).not.toBeNull();
    expect(failedCheck.overall).not.toBe('HEALTHY');
    // ...but an account the platform has already put in ERROR cannot be trusted at all.
    expect(errored.overall).toBe('UNHEALTHY');
    expect(errored.capabilities[0].reason).toBe('ACCOUNT_ERROR');
  });

  it('escalates repeated failures to unhealthy at the threshold, not before', () => {
    const svc = service({ failureThreshold: 3 });
    expect(svc.evaluate(input({ consecutiveFailures: 2 })).overall).toBe('HEALTHY');
    expect(svc.evaluate(input({ consecutiveFailures: 3 })).overall).toBe('UNHEALTHY');
  });

  it('refuses an expired credential before anything else is discussed', () => {
    const result = service().evaluate(input({ credentialExpiresAt: new Date('2026-10-26T11:59:59.000Z') }));

    expect(result.overall).toBe('UNHEALTHY');
    expect(result.capabilities[0].reason).toBe('CREDENTIAL_EXPIRED');
    expect(result.requiresAction).toEqual(['RECONNECT_KEY']);
  });

  it('accepts a credential that expires in the future', () => {
    const result = service().evaluate(input({ credentialExpiresAt: new Date('2026-11-26T00:00:00.000Z') }));

    expect(result.overall).toBe('HEALTHY');
  });

  it('does not upgrade a disabled account to healthy', () => {
    const result = service().evaluate(input({ accountState: ExchangeAccountState.DISABLED }));

    expect(result.overall).toBe('DEGRADED');
    expect(row(result, 'READ').reason).toBe('ACCOUNT_DISABLED');
  });

  it('reports an unavailable venue health state as at most degraded', () => {
    const result = service().evaluate(input({ healthState: ExchangeHealthState.UNAVAILABLE }));

    expect(result.overall).toBe('DEGRADED');
  });

  it('counts a margin permission the venue did report', () => {
    const result = service().evaluate(input({ verifiedPermissions: ['SPOT', 'TRADE', 'MARGIN'] }));

    expect(row(result, 'MARGIN')).toMatchObject({ state: 'OK', granted: true, countsTowardOverall: true });
    expect(result.overall).toBe('HEALTHY');
  });

  it('renders no venue response text in any capability detail', () => {
    // Details are platform copy. A venue's raw error string in this field would be
    // an information leak and an untranslatable sentence on a customer screen.
    const result = service().evaluate(input({ canWithdraw: true, lastFailureCode: 'AUTH_FAILED' }));

    for (const entry of result.capabilities) {
      expect(entry.detail).toMatch(/^[A-Z][\s\S]*\.$/);
      expect(entry.detail).not.toContain('AUTH_FAILED');
    }
  });

  it('never returns another tenant’s account from the list view', () => {
    const other = input({ tenantId: OTHER_TENANT, accountId: 'account-other' });
    const mine = input({ accountId: 'account-mine' });

    const result = service().listForTenant(TENANT, [mine, other]);

    expect(result.map((entry) => entry.accountId)).toEqual(['account-mine']);
  });

  it('keeps every account it returns scoped to the requested tenant', () => {
    const rows = service().listForTenant(TENANT, [
      input({ accountId: 'a' }),
      input({ accountId: 'b' }),
      input({ tenantId: OTHER_TENANT, accountId: 'c' }),
    ]);

    expect(rows.every((entry) => entry.tenantId === TENANT)).toBe(true);
    expect(rows).toHaveLength(2);
  });

  it('orders severities so a caller can sort by the worst account first', () => {
    expect(AccountCapabilityHealthService.severityOf('UNHEALTHY')).toBeGreaterThan(
      AccountCapabilityHealthService.severityOf('RISK'),
    );
    expect(AccountCapabilityHealthService.severityOf('RISK')).toBeGreaterThan(
      AccountCapabilityHealthService.severityOf('DEGRADED'),
    );
    expect(AccountCapabilityHealthService.severityOf('DEGRADED')).toBeGreaterThan(
      AccountCapabilityHealthService.severityOf('UNKNOWN'),
    );
    expect(AccountCapabilityHealthService.severityOf('HEALTHY')).toBe(0);
  });

  it('refuses a configuration that would disable the staleness or failure gate', () => {
    expect(() => new AccountCapabilityHealthService({ maxEvidenceAgeMs: 0 })).toThrow(/maxEvidenceAgeMs/);
    expect(() => new AccountCapabilityHealthService({ failureThreshold: 0 })).toThrow(/failureThreshold/);
  });
});
