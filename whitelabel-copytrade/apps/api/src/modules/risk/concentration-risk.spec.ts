// # Responsibility: verifies exact customer concentration denominators, stale/unknown evidence handling, aligned correlation observations, and authenticated self-scope.

import { ForbiddenException } from '@nestjs/common';
import { ConcentrationRiskService } from '../risk-management/concentration-risk.service';
import { CorrelationRiskService } from '../risk-management/correlation-risk.service';
import { RiskManagementController } from '../risk-management/risk.controller';
import type { CustomerExposureLine, CustomerExposureView } from '../risk-management/customer-exposure.types';

const TENANT_ID = 'tenant-authenticated';
const USER_ID = 'user-authenticated';
const POLICY_VERSION = 'policy-v4';
const DAY_MS = 24 * 60 * 60 * 1000;
const AS_OF = new Date('2026-10-06T12:00:00.000Z');

function currentExposureLine(overrides: Partial<CustomerExposureLine> = {}): CustomerExposureLine {
  return {
    symbol: 'BTC-USDT',
    venue: 'BINANCE',
    marketType: 'SPOT',
    baseAsset: 'BTC',
    quoteAsset: 'USDT',
    longQuantity: '1',
    shortQuantity: '0',
    netQuantity: '1',
    longPositionNotional: '60',
    shortPositionNotional: '0',
    grossPositionNotional: '60',
    netPositionNotional: '60',
    openOrderCommitment: '0',
    totalNotional: '60',
    openOrderCount: 0,
    openOrderCommitmentBasis: null,
    price: '60',
    priceSource: 'MARKET_DATA_1M_CANDLE_CLOSE',
    priceTimestamp: '2026-10-06T11:59:45.000Z',
    positionState: 'CURRENT',
    openOrderState: 'NO_OPEN_ORDERS',
    state: 'CURRENT',
    ...overrides,
  };
}

function customerExposure(lines: CustomerExposureLine[], overrides: Partial<CustomerExposureView> = {}): CustomerExposureView {
  return {
    tenantId: TENANT_ID,
    traderId: null,
    asOf: '2026-10-06T12:00:00.000Z',
    state: 'CURRENT',
    eligibleAccountCount: 2,
    lines,
    totalsByQuoteAsset: [],
    staleSymbols: [],
    unknownSymbols: [],
    dataScope: 'SIGNED_IN_USER_NON_SANDBOX_NON_SIMULATED_ACCOUNTS',
    simulatedRecordsIncluded: false,
    cashBalancesIncluded: false,
    currencyTreatment: 'SEPARATE_QUOTE_ASSETS_NO_FX_CONVERSION',
    priceMethodology: 'LATEST_1M_CANDLE_CLOSE_WITH_POLICY_FRESHNESS',
    notice: 'Test fixture uses only current persisted candle evidence.',
    ...overrides,
  };
}

function riskPolicy(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: TENANT_ID,
    effectiveVersion: POLICY_VERSION,
    thresholds: {
      maxConcentrationAssetPercent: '40',
      maxConcentrationSymbolPercent: '30',
      maxConcentrationVenuePercent: '60',
      maxCorrelation: '0.8',
      correlationLookbackDays: 30,
      correlationMinObservations: 30,
      marketDataMaxAgeMs: 30_000,
      ...overrides,
    },
  };
}

describe('ConcentrationRiskService.evaluateMyConcentration', () => {
  function buildService(view: CustomerExposureView) {
    const customerExposureService = {
      calculateMyExposure: jest.fn(async () => view),
    };
    const policyService = {
      resolveEffectivePolicy: jest.fn(async () => riskPolicy()),
    };
    const service = new ConcentrationRiskService(
      {} as never,
      policyService as never,
      {} as never,
      customerExposureService as never,
    );
    return { service, customerExposureService, policyService };
  }

  it('uses exact gross notionals and calculates asset weights separately for each quote asset', async () => {
    const view = customerExposure([
      currentExposureLine({
        symbol: 'BTC-USDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        grossPositionNotional: '60.000000000001',
        longPositionNotional: '60.000000000001',
        netPositionNotional: '60.000000000001',
        price: '60.000000000001',
        priceTimestamp: '2026-10-06T11:59:30.000Z',
      }),
      currentExposureLine({
        symbol: 'ETH-USDT',
        venue: 'BYBIT',
        baseAsset: 'ETH',
        quoteAsset: 'USDT',
        grossPositionNotional: '40',
        longPositionNotional: '40',
        netPositionNotional: '40',
        price: '40',
        priceTimestamp: '2026-10-06T11:59:40.000Z',
      }),
      currentExposureLine({
        symbol: 'BTC-USDC',
        venue: 'BINANCE',
        baseAsset: 'BTC',
        quoteAsset: 'USDC',
        grossPositionNotional: '80',
        longPositionNotional: '80',
        netPositionNotional: '80',
        price: '80',
        priceTimestamp: '2026-10-06T11:59:35.000Z',
      }),
    ]);
    const { service, customerExposureService, policyService } = buildService(view);

    const assessment = await service.evaluateMyConcentration({ tenantId: TENANT_ID, userId: USER_ID });
    const usdtBtc = assessment.metrics.find((metric) => metric.dimension === 'ASSET' && metric.key === 'BTC' && metric.quoteAsset === 'USDT');
    const usdtEth = assessment.metrics.find((metric) => metric.dimension === 'ASSET' && metric.key === 'ETH' && metric.quoteAsset === 'USDT');
    const usdcBtc = assessment.metrics.find((metric) => metric.dimension === 'ASSET' && metric.key === 'BTC' && metric.quoteAsset === 'USDC');

    expect(customerExposureService.calculateMyExposure).toHaveBeenCalledWith({ tenantId: TENANT_ID, userId: USER_ID });
    expect(policyService.resolveEffectivePolicy).toHaveBeenCalledWith({ tenantId: TENANT_ID });
    expect(assessment.state).toBe('CURRENT');
    expect(usdtBtc).toMatchObject({
      currentNotional: '60.000000000001',
      currentPercent: '60',
      thresholdPercent: '40',
      isBreach: true,
      state: 'CURRENT',
      source: 'MARKET_DATA_1M_CANDLE_CLOSE',
      observedAt: '2026-10-06T11:59:30.000Z',
    });
    expect(usdtEth).toMatchObject({ currentPercent: '39.999999999999', isBreach: false, quoteAsset: 'USDT' });
    expect(usdcBtc).toMatchObject({ currentPercent: '100', quoteAsset: 'USDC', isBreach: true });
    expect(assessment.methodology).toBe('GROSS_POSITION_NOTIONAL_WITHIN_QUOTE_ASSET_NO_FX');
    expect(assessment.metrics.every((metric) => metric.quoteAsset === null || ['USDT', 'USDC'].includes(metric.quoteAsset))).toBe(true);
  });

  it('withholds every ratio that depends on a stale position in its quote-asset denominator', async () => {
    const view = customerExposure([
      currentExposureLine(),
      currentExposureLine({
        symbol: 'ETH-USDT',
        baseAsset: 'ETH',
        quoteAsset: 'USDT',
        grossPositionNotional: null,
        longPositionNotional: null,
        netPositionNotional: null,
        totalNotional: null,
        price: null,
        priceSource: null,
        priceTimestamp: '2026-10-06T11:00:00.000Z',
        positionState: 'STALE',
        state: 'STALE',
      }),
    ], {
      state: 'STALE',
      staleSymbols: ['BINANCE:ETH-USDT'],
    });
    const { service } = buildService(view);

    const assessment = await service.evaluateMyConcentration({ tenantId: TENANT_ID, userId: USER_ID });
    const usdtMetrics = assessment.metrics.filter((metric) => metric.quoteAsset === 'USDT');

    expect(assessment.state).toBe('STALE');
    expect(usdtMetrics.length).toBeGreaterThan(0);
    expect(usdtMetrics.every((metric) => metric.state === 'STALE')).toBe(true);
    expect(usdtMetrics.every((metric) => metric.currentNotional === null && metric.currentPercent === null && metric.isBreach === null)).toBe(true);
    expect(assessment.staleSymbols).toEqual(['BINANCE:ETH-USDT']);
  });

  it('does not treat a nominally CURRENT row without an explicit candle timestamp/source as measured', async () => {
    const view = customerExposure([
      currentExposureLine({
        priceSource: null,
        priceTimestamp: null,
      }),
    ]);
    const { service } = buildService(view);

    const assessment = await service.evaluateMyConcentration({ tenantId: TENANT_ID, userId: USER_ID });

    expect(assessment.state).toBe('UNKNOWN');
    expect(assessment.metrics.length).toBeGreaterThan(0);
    expect(assessment.metrics.every((metric) => metric.state === 'UNKNOWN')).toBe(true);
    expect(assessment.metrics.every((metric) => metric.currentNotional === null && metric.currentPercent === null && metric.isBreach === null)).toBe(true);
  });

  it('does not combine positions whose quote-asset identity is unavailable with measured quote groups', async () => {
    const view = customerExposure([
      currentExposureLine(),
      currentExposureLine({
        symbol: 'ALT-UNKNOWN',
        baseAsset: 'ALT',
        quoteAsset: null,
        grossPositionNotional: null,
        longPositionNotional: null,
        netPositionNotional: null,
        totalNotional: null,
        price: null,
        priceSource: null,
        priceTimestamp: null,
        positionState: 'UNKNOWN',
        state: 'UNKNOWN',
      }),
    ], {
      state: 'UNKNOWN',
      unknownSymbols: ['BINANCE:ALT-UNKNOWN'],
    });
    const { service } = buildService(view);

    const assessment = await service.evaluateMyConcentration({ tenantId: TENANT_ID, userId: USER_ID });
    const unassigned = assessment.metrics.find((metric) => metric.key === 'QUOTE_ASSET_UNAVAILABLE');
    const quoteMetrics = assessment.metrics.filter((metric) => metric.quoteAsset === 'USDT');

    expect(assessment.state).toBe('UNKNOWN');
    expect(unassigned).toMatchObject({ dimension: 'UNCLASSIFIED', state: 'UNKNOWN', currentPercent: null, isBreach: null });
    expect(quoteMetrics.every((metric) => metric.state === 'UNKNOWN' && metric.currentPercent === null)).toBe(true);
  });
});

function positionRows() {
  return [
    { symbolId: 'symbol-btc', symbol: 'BTC-USDT', venue: 'BINANCE', quantity: '1' },
    { symbolId: 'symbol-eth', symbol: 'ETH-USDT', venue: 'BINANCE', quantity: '2' },
  ];
}

function tradingSymbolRows() {
  return [
    {
      id: 'symbol-btc',
      symbol: 'BTC-USDT',
      marketType: 'SPOT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      exchange: { venue: 'BINANCE' },
    },
    {
      id: 'symbol-eth',
      symbol: 'ETH-USDT',
      marketType: 'SPOT',
      baseAsset: 'ETH',
      quoteAsset: 'USDT',
      exchange: { venue: 'BINANCE' },
    },
  ];
}

function dailyCandles(symbolId: string, venue: string, options: { offsetMs?: number; lastOpenDaysBeforeAsOf?: number } = {}) {
  const { offsetMs = 0, lastOpenDaysBeforeAsOf = 1 } = options as { offsetMs?: number; lastOpenDaysBeforeAsOf?: number };
  const asOfDay = Math.floor(AS_OF.getTime() / DAY_MS) * DAY_MS;
  const latestOpen = asOfDay - lastOpenDaysBeforeAsOf * DAY_MS + offsetMs;
  const firstOpen = latestOpen - 30 * DAY_MS;
  const results = [] as Array<{
    symbolId: string;
    venue: string;
    interval: string;
    openTime: Date;
    closeTime: Date;
    close: string;
  }>;
  let close = 100;
  const multipliers = [1.01, 0.995, 1.02, 0.99, 1.005, 0.985];

  for (let index = 0; index <= 30; index += 1) {
    if (index > 0) close *= multipliers[(index - 1) % multipliers.length]!;
    const openTime = new Date(firstOpen + index * DAY_MS);
    results.push({
      symbolId,
      venue,
      interval: '1d',
      openTime,
      closeTime: new Date(openTime.getTime() + DAY_MS - 1),
      close: close.toFixed(12),
    });
  }

  return results;
}

describe('CorrelationRiskService.evaluateMyCorrelation', () => {
  function buildService(options: {
    candlesBySymbol?: Record<string, Array<{ symbolId: string; venue: string; interval: string; openTime: Date; closeTime: Date; close: string }>>;
    positions?: ReturnType<typeof positionRows>;
    symbols?: ReturnType<typeof tradingSymbolRows>;
  } = {}) {
    const accounts = { findMany: jest.fn(async () => [{ id: 'account-owned' }]) };
    const positions = { findMany: jest.fn(async () => options.positions ?? positionRows()) };
    const tradingSymbols = { findMany: jest.fn(async () => options.symbols ?? tradingSymbolRows()) };
    const marketDataRecord = {
      findMany: jest.fn(async (args: { where: { symbolId: string; venue: string; interval: string } }) => (
        options.candlesBySymbol?.[args.where.symbolId]
        ?? dailyCandles(args.where.symbolId, args.where.venue)
      )),
    };
    const prisma = {
      tradingAccount: accounts,
      position: positions,
      tradingSymbol: tradingSymbols,
      marketDataRecord,
    };
    const policyService = {
      resolveEffectivePolicy: jest.fn(async () => riskPolicy()),
    };
    const service = new CorrelationRiskService(prisma as never, policyService as never);
    return { service, prisma, policyService };
  }

  it('uses owner-scoped non-sandbox accounts, tenant instrument identity, and 30 valid aligned daily returns', async () => {
    const { service, prisma } = buildService();

    const assessment = await service.evaluateMyCorrelation({ tenantId: TENANT_ID, userId: USER_ID, asOf: AS_OF });

    expect(prisma.tradingAccount.findMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT_ID, deletedAt: null, isSandbox: false, userId: USER_ID },
      select: { id: true },
    });
    expect(prisma.position.findMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT_ID, accountId: { in: ['account-owned'] }, containsSimulatedFills: false, closedAt: null },
      select: { symbolId: true, symbol: true, venue: true, quantity: true },
    });
    expect(prisma.tradingSymbol.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: TENANT_ID, id: { in: ['symbol-btc', 'symbol-eth'] } },
    }));
    expect(prisma.marketDataRecord.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ symbolId: 'symbol-btc', venue: 'BINANCE', interval: '1d' }),
      orderBy: { openTime: 'asc' },
      select: expect.objectContaining({ closeTime: true, close: true }),
    }));
    expect(assessment).toMatchObject({
      state: 'CURRENT',
      dataScope: 'SIGNED_IN_USER_NON_SANDBOX_NON_SIMULATED_ACCOUNTS',
      method: 'PEARSON_30D_ALIGNED_DAILY',
      interval: '1d',
      lookbackDays: 30,
      minObservations: 30,
      activePositionCount: 2,
      instrumentCount: 2,
      omittedPositionCount: 0,
      candidatePairCount: 1,
      evaluatedPairCount: 1,
      truncatedPairCount: 0,
    });
    expect(assessment.pairs[0]).toMatchObject({
      observations: 30,
      threshold: '0.8',
      isBreach: true,
      state: 'HIGH',
      isUnknown: false,
      sourceInterval: '1d',
      sourceMethodology: 'ALIGNED_DAILY_CLOSE_RETURNS',
      sourceTimestamp: '2026-10-05T23:59:59.999Z',
      isStale: false,
    });
    expect(Number(assessment.pairs[0]?.correlation)).toBeGreaterThan(0.999);
  });

  it('counts only returns whose candle windows align by timestamp rather than pairing rows by array index', async () => {
    const shifted = dailyCandles('symbol-eth', 'BINANCE', { offsetMs: 60 * 60 * 1000 });
    const { service } = buildService({ candlesBySymbol: { 'symbol-eth': shifted } });

    const assessment = await service.evaluateMyCorrelation({ tenantId: TENANT_ID, userId: USER_ID, asOf: AS_OF });

    expect(assessment.state).toBe('UNKNOWN');
    expect(assessment.pairs[0]).toMatchObject({
      observations: 0,
      correlation: null,
      isUnknown: true,
      state: 'UNKNOWN',
    });
    expect(assessment.pairs[0]?.reason).toContain('timestamp-aligned daily return pairs');
  });

  it('marks old daily candles STALE and never reuses them as a measured correlation', async () => {
    const stale = dailyCandles('symbol-btc', 'BINANCE', { lastOpenDaysBeforeAsOf: 3 });
    const { service } = buildService({ candlesBySymbol: { 'symbol-btc': stale } });

    const assessment = await service.evaluateMyCorrelation({ tenantId: TENANT_ID, userId: USER_ID, asOf: AS_OF });

    expect(assessment.state).toBe('STALE');
    expect(assessment.pairs[0]).toMatchObject({
      correlation: null,
      state: 'STALE',
      isUnknown: true,
      isStale: true,
      sourceMaxAgeMs: 129_600_000,
    });
    expect(assessment.pairs[0]?.reason).toContain('older than the 36-hour freshness limit');
  });

  it('does not calculate a correlation for constant-return series with zero variance', async () => {
    const constant = (symbolId: string, venue: string) => {
      const rows = dailyCandles(symbolId, venue);
      return rows.map((row) => ({ ...row, close: '100.000000000000' }));
    };
    const { service } = buildService({
      candlesBySymbol: {
        'symbol-btc': constant('symbol-btc', 'BINANCE'),
        'symbol-eth': constant('symbol-eth', 'BINANCE'),
      },
    });

    const assessment = await service.evaluateMyCorrelation({ tenantId: TENANT_ID, userId: USER_ID, asOf: AS_OF });

    expect(assessment.state).toBe('UNKNOWN');
    expect(assessment.pairs[0]).toMatchObject({ correlation: null, state: 'UNKNOWN', isUnknown: true });
    expect(assessment.pairs[0]?.reason).toContain('zero or invalid variance');
  });

  it('does not calculate across instruments with different quote assets or market types', async () => {
    const symbols = tradingSymbolRows().map((symbol, index) => index === 1 ? { ...symbol, quoteAsset: 'BTC' } : symbol);
    const { service } = buildService({ symbols });

    const assessment = await service.evaluateMyCorrelation({ tenantId: TENANT_ID, userId: USER_ID, asOf: AS_OF });

    expect(assessment.candidatePairCount).toBe(0);
    expect(assessment.state).toBe('UNKNOWN');
    expect(assessment.pairs).toEqual([]);
  });
});

describe('RiskManagementController.getMyRiskAnalysis', () => {
  function buildController() {
    const controller = Object.create(RiskManagementController.prototype) as RiskManagementController;
    const concentrationService = {
      evaluateMyConcentration: jest.fn(async () => ({ state: 'EMPTY' })),
    };
    const correlationService = {
      evaluateMyCorrelation: jest.fn(async () => ({ state: 'EMPTY' })),
    };
    Reflect.set(controller, 'concentrationService', concentrationService);
    Reflect.set(controller, 'correlationService', correlationService);
    return { controller, concentrationService, correlationService };
  }

  it('binds both analysis calls to the verified tenant and user and ignores caller-supplied scope selectors', async () => {
    const { controller, concentrationService, correlationService } = buildController();
    const result = await controller.getMyRiskAnalysis({
      user: { tenantId: TENANT_ID, userId: USER_ID },
      query: {
        tenantId: 'attacker-tenant',
        userId: 'attacker-user',
        accountId: 'attacker-account',
      },
    });

    expect(concentrationService.evaluateMyConcentration).toHaveBeenCalledTimes(1);
    expect(concentrationService.evaluateMyConcentration).toHaveBeenCalledWith({ tenantId: TENANT_ID, userId: USER_ID });
    expect(correlationService.evaluateMyCorrelation).toHaveBeenCalledTimes(1);
    expect(correlationService.evaluateMyCorrelation).toHaveBeenCalledWith({ tenantId: TENANT_ID, userId: USER_ID });
    expect(result).toMatchObject({
      tenantId: TENANT_ID,
      dataScope: 'SIGNED_IN_USER_NON_SANDBOX_NON_SIMULATED_ACCOUNTS',
      concentration: { state: 'EMPTY' },
      correlation: { state: 'EMPTY' },
    });
  });

  it('refuses a missing authenticated user instead of falling back to tenant-wide risk data', async () => {
    const { controller, concentrationService, correlationService } = buildController();

    await expect(controller.getMyRiskAnalysis({
      user: { tenantId: TENANT_ID },
      query: { userId: USER_ID, accountId: 'attacker-account' },
    })).rejects.toBeInstanceOf(ForbiddenException);
    expect(concentrationService.evaluateMyConcentration).not.toHaveBeenCalled();
    expect(correlationService.evaluateMyCorrelation).not.toHaveBeenCalled();
  });
});
