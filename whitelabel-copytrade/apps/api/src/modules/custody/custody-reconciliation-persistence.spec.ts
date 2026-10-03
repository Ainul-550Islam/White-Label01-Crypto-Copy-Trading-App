import { Logger } from '@nestjs/common';
import { CustodyReconciliationService } from './custody-reconciliation.service';

/**
 * A custody reconciliation finding that cannot be stored is still returned to
 * the operator, but explicitly as NOT persisted (`persisted: false`, no id),
 * and the failure is logged at error level with the error code only. Before,
 * the catch path returned an object indistinguishable from a stored finding.
 */

const TENANT = '11111111-1111-4111-8111-111111111111';
const SECRET_LOOKING_VALUE = 'row-value-that-must-not-be-logged';

describe('custody reconciliation persistence observability', () => {
  let errorSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  function build(create: jest.Mock) {
    const prisma = {
      custodyWallet: { findMany: jest.fn(async () => [{ id: 'wallet-1', tenantId: TENANT, networkId: 'ethereum', assetId: 'USDT' }]) },
      custodyReconciliation: { findFirst: jest.fn(async () => null), create },
    };
    // No provider for the wallet's network: produces WALLET_WITHOUT_PROVIDER_RECORD.
    const providerFactory = { getProviderForNetwork: jest.fn(async () => null) };
    const auditService = { log: jest.fn(async () => undefined) };
    return { service: new CustodyReconciliationService(prisma as any, providerFactory as any, auditService as any), auditService };
  }

  it('marks a finding that could not be stored as not persisted and logs the error code only', async () => {
    const { service, auditService } = build(
      jest.fn(async () => {
        throw Object.assign(new Error(`Foreign key constraint failed ${SECRET_LOOKING_VALUE}`), { code: 'P2003' });
      }),
    );

    const findings = await service.runReconciliation({ tenantId: TENANT });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ id: null, persisted: false, type: 'WALLET_WITHOUT_PROVIDER_RECORD', walletId: 'wallet-1' });
    expect(auditService.log).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'custody.reconciliation.finding_persist_failed', tenantId: TENANT, error: 'P2003' }),
    );
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(SECRET_LOOKING_VALUE);
    expect(warnSpy).toHaveBeenCalledWith(expect.objectContaining({ event: 'custody.reconciliation.completed', unpersistedCount: 1 }));
  });

  it('returns a stored finding with its id and audits it', async () => {
    const { service, auditService } = build(jest.fn(async ({ data }: any) => ({ id: 'rec-1', createdAt: new Date(), ...data })));

    const findings = await service.runReconciliation({ tenantId: TENANT });

    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe('rec-1');
    expect(findings[0].persisted).toBeUndefined();
    expect(auditService.log).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
