// # Proves portfolio snapshots commit with their developer webhook outbox event

import { PortfolioSnapshotService } from './portfolio-snapshot.service';
import { validateDeveloperEventPayload } from '../developer-platform/event-schemas/developer-event-schemas';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const PROFILE_ID = '22222222-2222-4222-8222-222222222222';
const SNAPSHOT_AT = new Date('2026-10-09T12:00:00.000Z');

function buildHarness(options: { existing?: any; failAppend?: boolean } = {}) {
  let persisted = options.existing ?? null;
  const tx = {
    portfolioSnapshot: {
      findFirst: jest.fn(async () => persisted),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        persisted = {
          id: 'snapshot-row-1',
          createdAt: SNAPSHOT_AT,
          ...data,
        };
        return persisted;
      }),
    },
  };
  const prisma = {
    withTenantRls: jest.fn(async (_tenantId: string, work: (transaction: unknown) => Promise<unknown>) => {
      const before = persisted;
      try {
        return await work(tx);
      } catch (error) {
        persisted = before;
        throw error;
      }
    }),
    portfolioCashLedgerEntry: { findMany: jest.fn(async () => []) },
  };
  const policyService = {
    resolvePolicy: jest.fn(async () => ({ baseCurrency: 'USD', calculationVersion: 'calc-v1', policyVersion: 'policy-v1' })),
  };
  const navService = {
    calculateNav: jest.fn(async () => ({
      nav: '100.00',
      grossAssetValue: '100.00',
      grossLiability: '0',
      methodology: { name: 'LEDGER' },
      evidences: [],
      sourceReferences: ['ledger:1'],
      dataCompleteness: 'COMPLETE',
    })),
  };
  const pnlService = {
    calculateNetPnl: jest.fn(async () => ({
      grossPnl: '5.00',
      netPnl: '4.50',
      fees: '0.50',
      evidence: { gross: { unrealized: '5.00' } },
    })),
    calculateRealizedPnl: jest.fn(async () => ({ realizedPnl: '1.00' })),
  };
  const performanceService = {
    calculateTWR: jest.fn(async () => ({ evidence: { returnPercent: '1.00' } })),
  };
  const positionAccounting = { getHoldings: jest.fn(async () => []) };
  const cashLedger = {
    getCashBalance: jest.fn(async () => ({ balance: '100.00', currency: 'USD', baseCurrencyBalance: '100.00' })),
  };
  const outbox = {
    append: jest.fn(async (_transaction: unknown, _input: Record<string, unknown>) => {
      if (options.failAppend) throw new Error('outbox unavailable');
      return undefined;
    }),
  };
  const service = new PortfolioSnapshotService(
    prisma as never,
    navService as never,
    pnlService as never,
    performanceService as never,
    positionAccounting as never,
    cashLedger as never,
    policyService as never,
    outbox as never,
  );
  return { service, prisma, tx, outbox, navService, persisted: () => persisted };
}

describe('PortfolioSnapshotService outbox transaction', () => {
  it('persists the snapshot and event together, using the immutable snapshot identity and as-of time', async () => {
    const { service, prisma, tx, outbox } = buildHarness();
    const snapshot = await service.createSnapshot({
      tenantId: TENANT_ID,
      profileId: PROFILE_ID,
      snapshotId: 'daily-snapshot-2026-10-09',
      timestamp: SNAPSHOT_AT,
      scope: 'TENANT',
      scopeId: PROFILE_ID,
      correlationId: 'request-123',
    });

    expect(prisma.withTenantRls).toHaveBeenCalledWith(TENANT_ID, expect.any(Function));
    expect(tx.portfolioSnapshot.create).toHaveBeenCalledTimes(1);
    expect(outbox.append).toHaveBeenCalledWith(tx, expect.objectContaining({
      tenantId: TENANT_ID,
      aggregateType: 'portfolio_snapshot',
      aggregateId: snapshot.id,
      eventType: 'portfolio.snapshot.created',
      idempotencyKey: `portfolio-snapshot:${snapshot.id}:created`,
      correlationId: 'request-123',
      payload: { snapshotId: 'daily-snapshot-2026-10-09', asOf: SNAPSHOT_AT.toISOString() },
    }));
    const event = outbox.append.mock.calls[0]?.[1];
    expect(validateDeveloperEventPayload('portfolio.snapshot.created', event?.payload)).toEqual({ valid: true, errors: [] });
  });

  it('reuses the original event identity on an idempotent snapshot retry', async () => {
    const existing = {
      id: 'snapshot-row-2',
      tenantId: TENANT_ID,
      profileId: PROFILE_ID,
      snapshotId: 'existing-snapshot',
      timestamp: SNAPSHOT_AT,
      nav: '100.00',
      createdAt: SNAPSHOT_AT,
      performanceMetrics: { correlationId: 'original-correlation' },
    };
    const { service, tx, outbox } = buildHarness({ existing });
    await service.createSnapshot({
      tenantId: TENANT_ID,
      profileId: PROFILE_ID,
      snapshotId: 'existing-snapshot',
      timestamp: SNAPSHOT_AT,
      scope: 'TENANT',
      scopeId: PROFILE_ID,
      correlationId: 'original-correlation',
    });

    expect(tx.portfolioSnapshot.create).not.toHaveBeenCalled();
    expect(outbox.append).toHaveBeenCalledWith(tx, expect.objectContaining({
      aggregateId: 'snapshot-row-2',
      idempotencyKey: 'portfolio-snapshot:snapshot-row-2:created',
      payload: { snapshotId: 'existing-snapshot', asOf: SNAPSHOT_AT.toISOString() },
    }));
  });

  it('rolls back the snapshot when event validation or persistence fails', async () => {
    const { service, tx, outbox, persisted } = buildHarness({ failAppend: true });
    await expect(service.createSnapshot({
      tenantId: TENANT_ID,
      profileId: PROFILE_ID,
      snapshotId: 'rollback-snapshot',
      timestamp: SNAPSHOT_AT,
      scope: 'TENANT',
      scopeId: PROFILE_ID,
    })).rejects.toThrow('outbox unavailable');

    expect(tx.portfolioSnapshot.create).toHaveBeenCalledTimes(1);
    expect(persisted()).toBeNull();
  });
});
