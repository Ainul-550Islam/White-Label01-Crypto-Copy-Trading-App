import { Logger } from '@nestjs/common';
import { CustodyReconciliationService } from './custody-reconciliation.service';

/**
 * Custody reconciliation read failures are observable (round 7). Each check whose read fails
 * is logged at error level (custody.reconciliation.check_read_failed, error code only), counted
 * in the report, and makes the run incomplete - "no findings" from a check that could not read
 * its rows is never presented as a clean result. runReconciliation() keeps returning the
 * findings array (the API shape); runReconciliationReport() carries the read failures.
 */

const TENANT = '11111111-1111-4111-8111-111111111111';
const SECRET_LOOKING_VALUE = 'row-value-that-must-not-be-logged';

function readFailure(): Error {
  return Object.assign(new Error(`connection reset ${SECRET_LOOKING_VALUE}`), { code: 'P1017' });
}

describe('custody reconciliation read failures', () => {
  let errorSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  const wallet = { id: 'wallet-1', tenantId: TENANT, networkId: 'ethereum', assetId: 'USDT' };

  function build(overrides: Record<string, any> = {}) {
    const ok = jest.fn(async () => []);
    const prisma: any = {
      custodyWallet: { findMany: jest.fn(async () => [wallet]) },
      custodyWalletAddress: { findMany: ok },
      custodyDeposit: { findMany: ok, findFirst: jest.fn(async () => null) },
      custodyTransaction: { findMany: ok, findFirst: jest.fn(async () => null) },
      custodyWithdrawal: { findMany: ok },
      custodyReconciliation: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => ({ id: 'rec-1', createdAt: new Date(), ...data })),
        findMany: jest.fn(async () => []),
        count: jest.fn(async () => 0),
      },
      ...overrides,
    };
    const providerFactory = { getProviderForNetwork: jest.fn(async () => ({ id: 'internal-ledger' })) };
    const auditService = { log: jest.fn(async () => undefined) };
    return new CustodyReconciliationService(prisma, providerFactory as any, auditService as any);
  }

  it('a clean run is complete with no read failures', async () => {
    const report = await build().runReconciliationReport({ tenantId: TENANT });

    expect(report).toMatchObject({ findings: [], walletsChecked: 1, readFailures: [], unpersistedCount: 0, complete: true });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('reports each failed check read, marks the run incomplete and logs the error code only', async () => {
    const fail = jest.fn(async () => {
      throw readFailure();
    });
    const service = build({
      custodyDeposit: { findMany: fail, findFirst: fail },
      custodyWithdrawal: { findMany: fail },
    });

    const report = await service.runReconciliationReport({ tenantId: TENANT });

    expect(report.complete).toBe(false);
    expect(report.readFailures).toEqual([
      { check: 'deposits', walletId: 'wallet-1', error: 'P1017' },
      { check: 'withdrawals', walletId: 'wallet-1', error: 'P1017' },
    ]);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'custody.reconciliation.check_read_failed', tenantId: TENANT, check: 'deposits', error: 'P1017' }),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'custody.reconciliation.completed', readFailures: 2, complete: false }),
    );
    expect(JSON.stringify([...errorSpy.mock.calls, ...warnSpy.mock.calls])).not.toContain(SECRET_LOOKING_VALUE);
  });

  it('a failed wallet list read is an incomplete run, not an empty clean one', async () => {
    const service = build({
      custodyWallet: {
        findMany: jest.fn(async () => {
          throw readFailure();
        }),
      },
    });

    const report = await service.runReconciliationReport({ tenantId: TENANT });

    expect(report).toMatchObject({ findings: [], walletsChecked: 0, complete: false });
    expect(report.readFailures).toEqual([{ check: 'wallets', walletId: null, error: 'P1017' }]);
  });

  it('runReconciliation keeps returning the findings array (API shape unchanged)', async () => {
    const findings = await build().runReconciliation({ tenantId: TENANT });
    expect(Array.isArray(findings)).toBe(true);
  });

  it('listFindings propagates a read failure instead of answering with an empty page', async () => {
    const service = build({
      custodyReconciliation: {
        findMany: jest.fn(async () => {
          throw readFailure();
        }),
        count: jest.fn(async () => 0),
      },
    });

    await expect(service.listFindings({ tenantId: TENANT })).rejects.toMatchObject({ code: 'P1017' });
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'custody.reconciliation.list_read_failed', tenantId: TENANT, error: 'P1017' }),
    );
  });
});
