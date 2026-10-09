// # Responsibility: pins the persisted portfolio valuation to exact per-quote-asset arithmetic, UNAVAILABLE over an assumed number, and to a module that actually declares it.
//
// The modules CopyTradingModule imports are stubbed below. They are not what is under test - the
// module's own collector metadata is - and loading them pulls several hundred files into the
// type-checking transform, which exceeds this environment's memory budget and makes the wiring
// assertion unrunnable. Stubbing them keeps the assertion about the real CopyTradingModule class.

jest.mock('../risk/risk.module', () => ({ RiskModule: class RiskModule {} }));
jest.mock('../exchanges/exchanges.module', () => ({ ExchangesModule: class ExchangesModule {} }));
jest.mock('../billing/billing.module', () => ({ BillingModule: class BillingModule {} }));
jest.mock('../compliance/compliance.module', () => ({ ComplianceModule: class ComplianceModule {} }));
jest.mock('../security/security.module', () => ({ SecurityModule: class SecurityModule {} }));
jest.mock('../oms/oms.module', () => ({ OmsModule: class OmsModule {} }));
jest.mock('../operations/operations.module', () => ({ OperationsModule: class OperationsModule {} }));
jest.mock('../../infrastructure/prisma/prisma.module', () => ({ PrismaModule: class PrismaModule {} }));
jest.mock('../../infrastructure/prisma/prisma.service', () => ({ PrismaService: class PrismaService {} }));

import { BadRequestException } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { PERMISSIONS_KEY } from '../../common/constants/metadata.constants';
import { AllocationRebalanceController, PersistedPreviewResponse } from './allocation-rebalance.controller';
import { AllocationRebalanceService } from './allocation-rebalance.service';
import { AllocationValuationController } from './allocation-valuation.controller';
import { AllocationValuationRepository, quoteAssetOf } from './allocation-valuation.repository';
import { CopyTradingModule } from './copy-trading.module';

type PositionRow = {
  symbol: string;
  quantity: string;
  markPrice: string | null;
  containsSimulatedFills: boolean;
  updatedAt: Date;
};

function repositoryWith(rows: PositionRow[] | Error, onQuery?: (args: unknown) => void) {
  const prisma = {
    position: {
      findMany: async (args: unknown) => {
        onQuery?.(args);
        if (rows instanceof Error) throw rows;
        return rows;
      },
    },
  };
  return new AllocationValuationRepository(prisma as never);
}

const at = (iso: string) => new Date(iso);

describe('persisted portfolio valuation (GAP-60)', () => {
  it('is declared by the copy-trading module, so the feature is reachable at runtime', () => {
    // The audit found AllocationRebalanceController and AllocationRebalanceService referenced by no
    // module: their specs passed against hand-constructed instances while no running application
    // could route to them. Asserting the declaration is the difference between "the code exists" and
    // "the code runs", and it fails if the wiring is removed.
    const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, CopyTradingModule) as unknown[];
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, CopyTradingModule) as unknown[];

    expect(controllers).toContain(AllocationRebalanceController);
    expect(controllers).toContain(AllocationValuationController);
    expect(providers).toContain(AllocationValuationRepository);
    expect(providers).toContain(AllocationRebalanceService);
  });

  it('decorates both routes with a permission', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, AllocationValuationController.prototype.getValuation)).toBeDefined();
    expect(Reflect.getMetadata(PERMISSIONS_KEY, AllocationRebalanceController.prototype.preview)).toBeDefined();
  });

  it('sums only within a quote asset and never converts between two of them', async () => {
    const repository = repositoryWith([
      { symbol: 'BTC-USDT', quantity: '0.5', markPrice: '60000', containsSimulatedFills: false, updatedAt: at('2026-10-07T10:00:00.000Z') },
      { symbol: 'ETH-USDT', quantity: '2', markPrice: '3000', containsSimulatedFills: false, updatedAt: at('2026-10-07T11:00:00.000Z') },
      { symbol: 'SOL-BTC', quantity: '10', markPrice: '0.002', containsSimulatedFills: false, updatedAt: at('2026-10-07T09:00:00.000Z') },
    ]);

    const usdt = await repository.loadPersistedPortfolioValuation({ tenantId: 'tenant-1', quoteAsset: 'USDT' });

    expect(usdt.state).toBe('AVAILABLE');
    expect(usdt.quoteAssets.map((group) => group.quoteAsset)).toEqual(['USDT']);
    // 0.5 x 60000 + 2 x 3000 = 36000, exact, no float and no BTC group folded in.
    expect(usdt.quoteAssets[0].totalValue).toBe('36000');
    expect(usdt.asOf).toBe('2026-10-07T11:00:00.000Z');

    const whole = await repository.loadPersistedPortfolioValuation({ tenantId: 'tenant-1' });
    expect(whole.quoteAssets.map((group) => group.quoteAsset)).toEqual(['BTC', 'USDT']);
    expect(whole.quoteAssets.map((group) => group.totalValue)).toEqual(['0.02', '36000']);
  });

  it('reports UNAVAILABLE rather than valuing a position with no mark price, at entry or at zero', async () => {
    const repository = repositoryWith([
      { symbol: 'BTC-USDT', quantity: '0.5', markPrice: '60000', containsSimulatedFills: false, updatedAt: at('2026-10-07T10:00:00.000Z') },
      { symbol: 'DOGE-USDT', quantity: '1000', markPrice: null, containsSimulatedFills: false, updatedAt: at('2026-10-07T10:00:00.000Z') },
    ]);

    const valuation = await repository.loadPersistedPortfolioValuation({ tenantId: 'tenant-1', quoteAsset: 'USDT' });

    expect(valuation.state).toBe('UNAVAILABLE');
    expect(valuation.quoteAssets[0].totalValue).toBeNull();
    expect(valuation.quoteAssets[0].symbolsWithoutMarkPrice).toEqual(['DOGE-USDT']);
    expect(valuation.quoteAssets[0].pricedPositionCount).toBe(1);
    expect(valuation.reason).toMatch(/mark price/i);
  });

  it('keeps simulated positions out of a real portfolio total unless they are asked for', async () => {
    const rows: PositionRow[] = [
      { symbol: 'BTC-USDT', quantity: '1', markPrice: '100', containsSimulatedFills: false, updatedAt: at('2026-10-07T10:00:00.000Z') },
      { symbol: 'BTC-USDT', quantity: '1', markPrice: '100', containsSimulatedFills: true, updatedAt: at('2026-10-07T10:00:00.000Z') },
    ];

    let query: unknown;
    const real = await repositoryWith(rows, (args) => {
      query = args;
    }).loadPersistedPortfolioValuation({ tenantId: 'tenant-1', quoteAsset: 'USDT' });
    expect(real.quoteAssets[0].totalValue).toBe('100');
    expect((query as { where: Record<string, unknown> }).where).toMatchObject({ containsSimulatedFills: false });

    const withPaper = await repositoryWith(rows).loadPersistedPortfolioValuation({
      tenantId: 'tenant-1',
      quoteAsset: 'USDT',
      includeSimulated: true,
    });
    expect(withPaper.quoteAssets[0].totalValue).toBe('200');
  });

  it('scopes the read to the tenant and the account when one is given', async () => {
    let query: { where: Record<string, unknown> } = { where: {} };
    const repository = repositoryWith([], (args) => {
      query = args as { where: Record<string, unknown> };
    });

    await repository.loadPersistedPortfolioValuation({ tenantId: 'tenant-9', accountId: 'acc-1' });

    expect(query.where).toMatchObject({ tenantId: 'tenant-9', accountId: 'acc-1' });
  });

  it('treats an unreadable position table as UNAVAILABLE, not as an empty portfolio', async () => {
    const repository = repositoryWith(new Error('connection terminated'));

    const valuation = await repository.loadPersistedPortfolioValuation({ tenantId: 'tenant-1', quoteAsset: 'USDT' });

    // A zero total here would be handed to the allocation arithmetic and produce a preview of zero.
    expect(valuation.state).toBe('UNAVAILABLE');
    expect(valuation.quoteAssets).toEqual([]);
    expect(valuation.reason).toMatch(/could not be read/i);
  });

  it('reports UNAVAILABLE when the tenant holds nothing in the requested quote asset', async () => {
    const repository = repositoryWith([
      { symbol: 'ETH-BTC', quantity: '1', markPrice: '0.05', containsSimulatedFills: false, updatedAt: at('2026-10-07T10:00:00.000Z') },
    ]);

    const valuation = await repository.loadPersistedPortfolioValuation({ tenantId: 'tenant-1', quoteAsset: 'USDT' });

    expect(valuation.state).toBe('UNAVAILABLE');
    expect(valuation.reason).toMatch(/no persisted positions are denominated in USDT/i);
  });

  it('splits symbols on their separator and leaves an unsplittable symbol as its own group', () => {
    expect(quoteAssetOf('BTC-USDT')).toBe('USDT');
    expect(quoteAssetOf('btc/usdt')).toBe('USDT');
    // A concatenated pair cannot be split without a quote-asset list, so it stays whole rather than
    // being assigned to a guessed quote asset.
    expect(quoteAssetOf('BTCUSDT')).toBe('BTCUSDT');
  });

  it('requires an explicit quote asset and a tenant from the request context', async () => {
    const stored = {
      provenance: 'PERSISTED_PORTFOLIO_VALUATION',
      state: 'AVAILABLE',
      requestedQuoteAsset: 'USDT',
      quoteAssets: [
        {
          quoteAsset: 'USDT',
          totalValue: '250',
          state: 'AVAILABLE',
          positionCount: 1,
          pricedPositionCount: 1,
          symbolsWithoutMarkPrice: [],
          reason: null,
        },
      ],
      asOf: '2026-10-07T11:00:00.000Z',
      excluded: { simulatedPositions: 0, positionsWithoutMarkPrice: 0 },
      reason: null,
    };
    const loadPersistedPortfolioValuation = jest.fn().mockResolvedValue(stored);
    const repository = { loadPersistedPortfolioValuation } as unknown as AllocationValuationRepository;
    const controller = new AllocationValuationController(repository);
    const request = { user: { tenantId: 'tenant-7' } };

    await expect(controller.getValuation(request, undefined)).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.getValuation(request, 'usdt', 'not-a-uuid')).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.getValuation(request, 'USDT', undefined, 'yes')).rejects.toBeInstanceOf(BadRequestException);
    expect(loadPersistedPortfolioValuation).not.toHaveBeenCalled();

    // The route reads the tenant from the verified token and normalises the asset; nothing about the
    // read comes from the request beyond the asset and the optional account.
    const response = await controller.getValuation(request, 'usdt');
    expect(loadPersistedPortfolioValuation).toHaveBeenCalledWith({
      tenantId: 'tenant-7',
      quoteAsset: 'USDT',
      accountId: null,
      includeSimulated: false,
    });
    expect(response).toMatchObject({ state: 'AVAILABLE', executable: false });
    expect(response.quoteAssets[0].totalValue).toBe('250');
    await expect(controller.getValuation({}, 'USDT')).rejects.toThrow();
  });
});

describe('allocation preview from the persisted valuation', () => {
  const allocations = [
    { traderId: 'trader-a', currentValue: '400', targetWeightBps: 5_000, priceAvailable: true },
    { traderId: 'trader-b', currentValue: '600', targetWeightBps: 5_000, priceAvailable: true },
  ];

  function controllerWithValuation(valuation: unknown) {
    const loadPersistedPortfolioValuation = jest.fn().mockResolvedValue(valuation);
    const controller = new AllocationRebalanceController(
      new AllocationRebalanceService(),
      { loadPersistedPortfolioValuation } as unknown as AllocationValuationRepository,
    );
    return { controller, loadPersistedPortfolioValuation };
  }

  it('uses the persisted total and reports its provenance and recency', async () => {
    const { controller, loadPersistedPortfolioValuation } = controllerWithValuation({
      provenance: 'PERSISTED_PORTFOLIO_VALUATION',
      state: 'AVAILABLE',
      requestedQuoteAsset: 'USDT',
      quoteAssets: [
        {
          quoteAsset: 'USDT',
          totalValue: '1000.5',
          state: 'AVAILABLE',
          positionCount: 2,
          pricedPositionCount: 2,
          symbolsWithoutMarkPrice: [],
          reason: null,
        },
      ],
      asOf: '2026-10-07T11:00:00.000Z',
      excluded: { simulatedPositions: 1, positionsWithoutMarkPrice: 0 },
      reason: null,
    });

    const response = (await controller.preview(
      { user: { tenantId: 'tenant-from-token', userId: 'user-from-token' } },
      { quoteAsset: 'usdt', allocations } as never,
    )) as PersistedPreviewResponse;

    expect(loadPersistedPortfolioValuation).toHaveBeenCalledWith({
      tenantId: 'tenant-from-token',
      quoteAsset: 'USDT',
      accountId: null,
      includeSimulated: false,
    });
    expect(response).toMatchObject({
      state: 'AVAILABLE',
      inputProvenance: 'PERSISTED_PORTFOLIO_VALUATION',
      quoteAsset: 'USDT',
      asOf: '2026-10-07T11:00:00.000Z',
      executable: false,
    });
    // targetValue = 1000.5 x 50%, from the database total rather than from any request field.
    expect(response.lines.map((line) => line.targetValue)).toEqual(['500.25', '500.25']);
  });

  it('refuses to compute anything, and never substitutes a client number, when the valuation is unavailable', async () => {
    const { controller, loadPersistedPortfolioValuation } = controllerWithValuation({
      provenance: 'PERSISTED_PORTFOLIO_VALUATION',
      state: 'UNAVAILABLE',
      requestedQuoteAsset: 'USDT',
      quoteAssets: [],
      asOf: null,
      excluded: { simulatedPositions: 0, positionsWithoutMarkPrice: 0 },
      reason: 'Persisted positions could not be read; no portfolio value is available.',
    });

    const response = (await controller.preview(
      { user: { tenantId: 'tenant-a', userId: 'user-a' } },
      { quoteAsset: 'USDT', allocations } as never,
    )) as PersistedPreviewResponse;

    expect(response.state).toBe('UNAVAILABLE');
    expect(response.totalValue).toBeNull();
    expect(response.lines).toEqual([]);
    expect(response.reason).toMatch(/could not be read/i);
    expect(loadPersistedPortfolioValuation).toHaveBeenCalledTimes(1);
  });

  it('keeps the client-supplied path synchronous, labelled unverified and unchanged', () => {
    const { controller, loadPersistedPortfolioValuation } = controllerWithValuation({});

    const response = controller.preview(
      { user: { tenantId: 'tenant-a', userId: 'user-a' } },
      { totalValue: '1000.5', quoteAsset: 'USDT', allocations } as never,
    );

    // Precisely the envelope the pre-existing spec pins: no extra fields, no promise.
    expect(response).toEqual({
      totalValue: '1000.5',
      lines: [
        {
          traderId: 'trader-a',
          currentValue: '400',
          targetValue: '500.25',
          deltaValue: '100.25',
          targetWeightBps: 5_000,
          status: 'PREVIEW',
        },
        {
          traderId: 'trader-b',
          currentValue: '600',
          targetValue: '500.25',
          deltaValue: '-99.75',
          targetWeightBps: 5_000,
          status: 'PREVIEW',
        },
      ],
      executable: false,
      reason: 'Preview only; no order or transfer has been created.',
      inputProvenance: 'CLIENT_SUPPLIED_UNVERIFIED',
    });
    expect(loadPersistedPortfolioValuation).not.toHaveBeenCalled();
  });

  it('asks for a quote asset when the caller names neither a total nor an asset', () => {
    const { controller } = controllerWithValuation({});

    expect(() => controller.preview({ user: { tenantId: 'tenant-a', userId: 'user-a' } }, { allocations } as never)).toThrow(
      BadRequestException,
    );
  });

  it('refuses the persisted path rather than answering it from client input when no repository is wired', async () => {
    const controller = new AllocationRebalanceController(new AllocationRebalanceService());

    await expect(
      controller.preview({ user: { tenantId: 'tenant-a', userId: 'user-a' } }, { quoteAsset: 'USDT', allocations } as never),
    ).rejects.toThrow(/not available on this controller/i);
  });

  it('still requires a verified tenant and an authenticated user on the persisted path', async () => {
    const { controller, loadPersistedPortfolioValuation } = controllerWithValuation({});
    const dto = { quoteAsset: 'USDT', allocations } as never;

    // The guards run before the first await, so these throw synchronously and no read is attempted.
    expect(() => controller.preview({ user: { userId: 'user-a' } }, dto)).toThrow();
    expect(() => controller.preview({ user: { tenantId: 'tenant-a' } }, dto)).toThrow();
    expect(loadPersistedPortfolioValuation).not.toHaveBeenCalled();
  });
});
