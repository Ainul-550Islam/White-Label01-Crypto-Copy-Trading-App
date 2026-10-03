/**
 * Phase 3: recovery steps verify real state or stop; they never report a
 * success they did not observe.
 */

import { RecoveryPlanService } from './recovery-plan.service';

function build(overrides: { unsynced?: number; engaged?: number; openDiscrepancies?: number; filledNoFills?: number; blocking?: number; redisOk?: boolean; accounts?: any[] } = {}) {
  const prisma = {
    order: {
      count: jest.fn(async ({ where }: any) => (where.fills ? overrides.filledNoFills ?? 0 : overrides.unsynced ?? 0)),
    },
    killSwitch: { count: jest.fn(async () => overrides.engaged ?? 0) },
    reconciliationDiscrepancy: { count: jest.fn(async () => overrides.openDiscrepancies ?? 0) },
    complianceCase: { count: jest.fn(async () => overrides.blocking ?? 0) },
    tradingAccount: { findMany: jest.fn(async () => overrides.accounts ?? [{ id: 'a', credentialSource: 'ENVELOPE_DB', apiKeyCiphertext: 'x', apiSecretCiphertext: 'y' }]) },
    $queryRaw: jest.fn(async () => [{ '?column?': 1 }]),
  };
  const redis = { healthCheck: jest.fn(async () => ({ ok: overrides.redisOk ?? true, latencyMs: 2 })) };
  const svc = new RecoveryPlanService(prisma as any, redis as any, {} as any, {} as any);
  const step = (service: string, action: string) =>
    (svc as any).executeRecoveryStep({ tenantId: 't1', runId: 'r1', correlationId: null, step: { stepId: 's', name: 's', description: '', service, action, isIdempotent: true } });
  return { step, prisma };
}

describe('RecoveryPlanService.executeRecoveryStep', () => {
  it('queue health reflects Redis', async () => {
    await expect(build().step('queue', 'health-check')).resolves.toMatchObject({ healthy: true });
    await expect(build({ redisOk: false }).step('queue', 'health-check')).rejects.toThrow(/not reachable/);
  });

  it('actions this service cannot drive stop the run as manual', async () => {
    await expect(build().step('queue', 'retry-failed')).rejects.toThrow(/RECOVERY_MANUAL_ACTION_REQUIRED/);
    await expect(build().step('execution', 'reconnect')).rejects.toThrow(/RECOVERY_MANUAL_ACTION_REQUIRED/);
    await expect(build().step('compliance', 'request-review')).rejects.toThrow(/RECOVERY_MANUAL_ACTION_REQUIRED/);
  });

  it('order reconciliation passes only when every order is IN_SYNC', async () => {
    await expect(build().step('oms', 'reconcile-orders')).resolves.toMatchObject({ verified: true });
    await expect(build({ unsynced: 3 }).step('oms', 'reconcile-orders')).rejects.toThrow('3 order(s) are not IN_SYNC with the venue');
    await expect(build({ filledNoFills: 2 }).step('oms', 'reconcile-fills')).rejects.toThrow(/2 filled order/);
    await expect(build({ openDiscrepancies: 1 }).step('oms', 'reconcile-positions')).rejects.toThrow(/unrepaired/);
  });

  it('live gate is closed by an engaged kill switch or unreconciled orders', async () => {
    await expect(build({ engaged: 1 }).step('live-gate', 'check')).rejects.toThrow(/kill switch/);
    await expect(build({ unsynced: 1 }).step('live-gate', 'check')).rejects.toThrow(/not reconciled/);
    await expect(build().step('live-gate', 'check')).resolves.toEqual({ killSwitchEngaged: false, unreconciledOrders: 0 });
  });

  it('credential verification detects incomplete credential records', async () => {
    await expect(build({ accounts: [{ id: 'a', credentialSource: 'SECRET_MANAGER', credentialRef: null }] }).step('credential', 'verify')).rejects.toThrow(/incomplete credential/);
    await expect(build().step('credential', 'verify')).resolves.toMatchObject({ verified: true, accountsChecked: 1 });
  });

  it('compliance BLOCK cases stop recovery; unknown steps are never a silent success', async () => {
    await expect(build({ blocking: 1 }).step('compliance', 'check-case')).rejects.toThrow(/BLOCK/);
    await expect(build().step('mystery', 'do-it')).rejects.toThrow('Unsupported recovery step mystery:do-it');
  });
});
