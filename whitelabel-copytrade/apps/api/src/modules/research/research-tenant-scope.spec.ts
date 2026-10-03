import { InMemoryPrisma } from '../../common/__fixtures__/in-memory-prisma.fixture-spec';
import { BacktestRepository } from './backtest-repository';
import { PaperTradingRepository } from './paper-trading-repository';
import { ResearchRepository } from './research-repository';
import { ResearchPromotionService } from './research-promotion.service';
import { SignalService } from './signal.service';
import { ResearchSignalSide } from './signal.types';
import { ResearchDatasetStatus, ResearchStrategyVersionStatus } from './research.types';

/**
 * Tenant scope of the research module. The repositories use the shared
 * PrismaService directly (no per-request RLS context), so the application
 * query itself must carry the tenant:
 *  - an idempotency key replayed by another tenant never returns, or acts on,
 *    the first tenant's row. Since migration 20260924000000 the
 *    idempotency_key columns carry a PER-TENANT unique index
 *    (tenant_id, idempotency_key), so the other tenant's request is simply a
 *    new row of its own - neither a cross-tenant read nor a cross-tenant
 *    unique violation - while a duplicate inside one tenant is still refused
 *    (P2002);
 *  - status updates match `{ id, tenantId }`, so an id of another tenant
 *    updates nothing.
 */

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

const PER_TENANT_KEY = ['tenantId', 'idempotencyKey'];

const UNIQUE_IDEMPOTENCY = {
  researchBacktestRun: [PER_TENANT_KEY],
  researchPaperSession: [PER_TENANT_KEY],
  researchDataset: [PER_TENANT_KEY],
  researchStrategyVersion: [PER_TENANT_KEY],
  researchPromotionRequest: [PER_TENANT_KEY],
  researchSignal: [PER_TENANT_KEY],
};

function backtestInput(tenantId: string, runIdentifier: string, idempotencyKey: string) {
  return {
    tenantId,
    strategyVersionId: `sv-${tenantId}`,
    config: {},
    configFingerprint: 'cfg',
    timeframe: '1h',
    symbols: ['BTCUSDT'],
    startTime: new Date('2026-01-01T00:00:00Z'),
    endTime: new Date('2026-02-01T00:00:00Z'),
    initialCapital: '10000',
    runIdentifier,
    idempotencyKey,
  };
}

describe('research tenant scope', () => {
  let prisma: any;

  beforeEach(() => {
    prisma = new InMemoryPrisma(UNIQUE_IDEMPOTENCY);
  });

  describe('BacktestRepository', () => {
    it("never returns another tenant's run for a replayed idempotency key", async () => {
      const repo = new BacktestRepository(prisma);
      const runA = await repo.createRun(backtestInput(TENANT_A, 'run-a', 'k-shared'));

      const runB = await repo.createRun(backtestInput(TENANT_B, 'run-b', 'k-shared'));
      expect(runB.id).not.toBe(runA.id);
      expect(runB).toMatchObject({ tenantId: TENANT_B });
      expect(prisma.rows('researchBacktestRun')).toHaveLength(2);

      const replayA = await repo.createRun(backtestInput(TENANT_A, 'run-a2', 'k-shared'));
      expect(replayA.id).toBe(runA.id);
      const replayB = await repo.createRun(backtestInput(TENANT_B, 'run-b2', 'k-shared'));
      expect(replayB.id).toBe(runB.id);
      expect(prisma.rows('researchBacktestRun')).toHaveLength(2);
    });

    it('still refuses a duplicate key inside one tenant at the index (P2002)', () => {
      prisma.seed('researchBacktestRun', { id: 'r1', tenantId: TENANT_A, idempotencyKey: 'k-dup' });
      expect(() => prisma.seed('researchBacktestRun', { id: 'r2', tenantId: TENANT_A, idempotencyKey: 'k-dup' })).toThrow(
        expect.objectContaining({ code: 'P2002', meta: { target: ['tenantId', 'idempotencyKey'] } }),
      );
      expect(() => prisma.seed('researchBacktestRun', { id: 'r3', tenantId: TENANT_B, idempotencyKey: 'k-dup' })).not.toThrow();
    });

    it("does not update another tenant's run", async () => {
      const repo = new BacktestRepository(prisma);
      const runA = await repo.createRun(backtestInput(TENANT_A, 'run-a', 'k-a'));

      await expect(repo.updateStatus(runA.id, TENANT_B, 'FAILED', { errorCode: 'X' })).resolves.toBeNull();
      expect(prisma.rows('researchBacktestRun')[0]).toMatchObject({ status: 'QUEUED' });

      await expect(repo.updateStatus(runA.id, TENANT_A, 'RUNNING')).resolves.toMatchObject({ id: runA.id, status: 'RUNNING' });
    });
  });

  describe('PaperTradingRepository', () => {
    const session = (tenantId: string, sessionIdentifier: string, idempotencyKey: string) => ({
      tenantId,
      strategyVersionId: `sv-${tenantId}`,
      sessionIdentifier,
      initialCapital: '1000',
      idempotencyKey,
    });

    it("never returns another tenant's paper session for a replayed idempotency key", async () => {
      const repo = new PaperTradingRepository(prisma);
      const sessionA = await repo.createSession(session(TENANT_A, 's-a', 'k-shared'));

      const sessionB = await repo.createSession(session(TENANT_B, 's-b', 'k-shared'));
      expect(sessionB.id).not.toBe(sessionA.id);
      expect(sessionB).toMatchObject({ tenantId: TENANT_B });

      await expect(repo.createSession(session(TENANT_A, 's-a2', 'k-shared'))).resolves.toMatchObject({ id: sessionA.id });
      await expect(repo.createSession(session(TENANT_B, 's-b2', 'k-shared'))).resolves.toMatchObject({ id: sessionB.id });
    });

    it("does not update another tenant's paper session or paper order", async () => {
      const repo = new PaperTradingRepository(prisma);
      const sessionA = await repo.createSession(session(TENANT_A, 's-a', 'k-a'));
      prisma.seed('researchPaperOrder', { id: 'po-a', tenantId: TENANT_A, sessionId: sessionA.id, orderId: 'ord-a', status: 'NEW' });

      await expect(repo.updateSessionStatus(sessionA.id, TENANT_B, 'STOPPED')).resolves.toBeNull();
      await expect(repo.updatePaperOrderStatus('ord-a', TENANT_B, 'FILLED')).resolves.toBeNull();
      expect(prisma.rows('researchPaperSession')[0]).toMatchObject({ status: 'CREATED' });
      expect(prisma.rows('researchPaperOrder')[0]).toMatchObject({ status: 'NEW' });

      await expect(repo.updateSessionStatus(sessionA.id, TENANT_A, 'RUNNING')).resolves.toMatchObject({ status: 'RUNNING' });
      await expect(repo.updatePaperOrderStatus('ord-a', TENANT_A, 'FILLED')).resolves.toMatchObject({ status: 'FILLED' });
    });
  });

  describe('ResearchRepository', () => {
    it("scopes dataset and strategy-version idempotency keys and status updates to the tenant", async () => {
      const repo = new ResearchRepository(prisma);
      prisma.seed('researchDataset', { id: 'ds-a', tenantId: TENANT_A, fingerprint: 'fp-a', idempotencyKey: 'k-ds', status: 'DRAFT' });
      prisma.seed('researchStrategyVersion', { id: 'sv-a', tenantId: TENANT_A, fingerprint: 'fp-sv', idempotencyKey: 'k-sv', status: 'DRAFT', deletedAt: null });

      const datasetB = await repo.createDataset({
        tenantId: TENANT_B,
        name: 'b',
        venue: 'BINANCE',
        symbol: 'BTCUSDT',
        timeframe: '1h',
        source: 'test',
        startTime: new Date('2026-01-01T00:00:00Z'),
        endTime: new Date('2026-01-02T00:00:00Z'),
        fingerprint: 'fp-b',
        idempotencyKey: 'k-ds',
      });
      expect(datasetB.id).not.toBe('ds-a');
      expect(datasetB).toMatchObject({ tenantId: TENANT_B });

      const versionB = await repo.createStrategyVersion({
        tenantId: TENANT_B,
        version: '1',
        name: 'b',
        logicHash: 'l',
        configHash: 'c',
        fingerprint: 'fp-sv-b',
        idempotencyKey: 'k-sv',
      });
      expect(versionB.id).not.toBe('sv-a');
      expect(versionB).toMatchObject({ tenantId: TENANT_B });

      await expect(repo.updateDatasetStatus('ds-a', TENANT_B, ResearchDatasetStatus.INVALID)).resolves.toBeNull();
      await expect(repo.updateStrategyVersionStatus('sv-a', TENANT_B, ResearchStrategyVersionStatus.FROZEN)).resolves.toBeNull();
      expect(prisma.rows('researchDataset')[0]).toMatchObject({ id: 'ds-a', tenantId: TENANT_A, status: 'DRAFT' });
      expect(prisma.rows('researchStrategyVersion')[0]).toMatchObject({ id: 'sv-a', tenantId: TENANT_A, status: 'DRAFT' });

      await expect(repo.updateDatasetStatus('ds-a', TENANT_A, ResearchDatasetStatus.VALID)).resolves.toMatchObject({ status: 'VALID' });
    });
  });

  describe('SignalService', () => {
    it("neither replays nor expires another tenant's signal", async () => {
      const researchRepo = new ResearchRepository(prisma);
      const service = new SignalService(prisma, researchRepo);
      prisma.seed('researchStrategyVersion', { id: 'sv-b', tenantId: TENANT_B, status: 'PUBLISHED', deletedAt: null });
      prisma.seed('researchSignal', { id: 'sig-a', tenantId: TENANT_A, idempotencyKey: 'k-sig', state: 'VALID', signalKey: 'sig_a' });

      const signalB = await service.createSignal({
        tenantId: TENANT_B,
        strategyVersionId: 'sv-b',
        symbol: 'BTCUSDT',
        side: ResearchSignalSide.BUY,
        timestamp: new Date(),
        idempotencyKey: 'k-sig',
      });
      expect(signalB.id).not.toBe('sig-a');
      expect(prisma.rows('researchSignal').find((row: any) => row.id === signalB.id)).toMatchObject({ tenantId: TENANT_B });

      await expect(service.expireSignal(TENANT_B, 'sig-a')).resolves.toBeNull();
      expect(prisma.rows('researchSignal')[0]).toMatchObject({ state: 'VALID' });
      await expect(service.expireSignal(TENANT_A, 'sig-a')).resolves.toMatchObject({ state: 'EXPIRED' });
    });
  });

  describe('ResearchPromotionService', () => {
    it("does not return another tenant's promotion request for a replayed idempotency key", async () => {
      const researchRepo = new ResearchRepository(prisma);
      const policyService = { getPolicy: jest.fn(async () => ({ promotionPrerequisites: { requireBacktest: true } })) };
      const service = new ResearchPromotionService(prisma, researchRepo, new BacktestRepository(prisma), new PaperTradingRepository(prisma), policyService as any);
      prisma.seed('researchStrategyVersion', { id: 'sv-a', tenantId: TENANT_A, status: 'VALID', deletedAt: null });
      prisma.seed('researchStrategyVersion', { id: 'sv-b', tenantId: TENANT_B, status: 'VALID', deletedAt: null });
      prisma.seed('researchPromotionRequest', { id: 'pr-a', tenantId: TENANT_A, strategyVersionId: 'sv-a', idempotencyKey: 'k-pr', state: 'DRAFT' });

      // Tenant B's lookup misses, so the request is evaluated on its own merits (here: policy demands a backtest).
      await expect(service.createPromotionRequest({ tenantId: TENANT_B, strategyVersionId: 'sv-b', idempotencyKey: 'k-pr' })).rejects.toThrow(
        'Promotion requires backtest validation',
      );
      await expect(service.createPromotionRequest({ tenantId: TENANT_A, strategyVersionId: 'sv-a', idempotencyKey: 'k-pr' })).resolves.toMatchObject({
        id: 'pr-a',
      });
    });

    it("does not reject another tenant's promotion request", async () => {
      const researchRepo = new ResearchRepository(prisma);
      jest.spyOn(researchRepo, 'createAuditLog').mockResolvedValue({} as any);
      const service = new ResearchPromotionService(prisma, researchRepo, new BacktestRepository(prisma), new PaperTradingRepository(prisma), {} as any);
      prisma.seed('researchPromotionRequest', { id: 'pr-a', tenantId: TENANT_A, strategyVersionId: 'sv-a', state: 'DRAFT', reviewNotes: null });

      await expect(service.rejectPromotion(TENANT_B, 'pr-a', 'reviewer', 'no')).resolves.toBeNull();
      expect(prisma.rows('researchPromotionRequest')[0]).toMatchObject({ state: 'DRAFT' });
    });
  });
});
