// # Responsibility: proves every copy-trading route this batch's screens call is reached at its exact method and path, that mutations carry the caller's Idempotency-Key, and that the preview contract is still refused when the API answers something executable.

import { apiClient } from '@/api/api-client';
import { copyTradingExtendedApi, DECIMAL_STRING } from '@/api/copy-trading-extended-api';

jest.mock('@/api/api-client', () => ({ apiClient: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() } }));
const get = apiClient.get as jest.Mock;
const post = apiClient.post as jest.Mock;
const put = apiClient.put as jest.Mock;

afterEach(() => jest.resetAllMocks());

const previewResponse = {
  executable: false,
  inputProvenance: 'CLIENT_SUPPLIED_UNVERIFIED',
  lines: [{ traderId: 'trader-a', currentValue: '10.00', targetValue: '20.00', deltaValue: '10.00', targetWeightBps: 5000, status: 'PREVIEW' }],
};

describe('routes no other client exposed', () => {
  it('reads the persisted valuation for exactly one quote asset', async () => {
    get.mockResolvedValue({ provenance: 'PERSISTED_PORTFOLIO_VALUATION', state: 'AVAILABLE', requestedQuoteAsset: 'USDT', quoteAssets: [], asOf: null, excluded: { simulatedPositions: 0, positionsWithoutMarkPrice: 0 }, executable: false, reason: null });

    await copyTradingExtendedApi.getPortfolioValuation({ quoteAsset: 'USDT', includeSimulated: 'false' });

    expect(get).toHaveBeenCalledWith('/v1/copy-trading/portfolio-valuation', { searchParams: { quoteAsset: 'USDT', includeSimulated: 'false' } });
  });

  it('saves the budget with a PUT and the caller key, forwarding the exact decimal string', async () => {
    put.mockResolvedValue({});

    await copyTradingExtendedApi.putBudget({ maxActiveExposure: '100000.100000000000', perTraderCap: null, currency: 'USDT' }, 'stable-budget-key');

    expect(put).toHaveBeenCalledWith(
      '/v1/copy-trading/budget',
      { maxActiveExposure: '100000.100000000000', perTraderCap: null, currency: 'USDT' },
      { idempotencyKey: 'stable-budget-key' },
    );
  });

  it('reads the effective-dated policy history and encodes the trader id', async () => {
    get.mockResolvedValue({ data: [] });

    await copyTradingExtendedApi.getLeaderFeeHistory('trader/with slash', 'USD');

    expect(get).toHaveBeenCalledWith('/v1/copy-trading/leader-fees/traders/trader%2Fwith%20slash/history', { searchParams: { currency: 'USD' } });
  });

  it('sets a policy with the DTO idempotency key in the body and the same key in the header', async () => {
    post.mockResolvedValue({ traderId: 't-1', currency: 'USD', profitShareBps: 1000, highWaterMarkScope: 'PER_FOLLOWER_CURRENCY', version: 2, effectiveFrom: '2026-11-01T00:00:00.000Z', effectiveTo: null });
    const input = { idempotencyKey: 'leader-fee-key-0001', currency: 'USD', profitShareBps: 1000, highWaterMarkScope: 'PER_FOLLOWER_CURRENCY' as const };

    await copyTradingExtendedApi.setLeaderFeePolicy('t-1', input);

    expect(post).toHaveBeenCalledWith('/v1/copy-trading/leader-fees/traders/t-1', input, { idempotencyKey: 'leader-fee-key-0001' });
  });
});

describe('routes delegated to the existing copy clients', () => {
  it('previews with a POST, forwards the caller key and maps the non-executable lines', async () => {
    post.mockResolvedValue(previewResponse);

    await expect(
      copyTradingExtendedApi.previewAllocationRebalance({ totalValue: '100.00', allocations: [{ traderId: 'trader-a', currentValue: '10.00', targetWeightBps: 5000, priceAvailable: true }] }, 'preview-key-0001'),
    ).resolves.toEqual(previewResponse.lines);

    expect(post).toHaveBeenCalledWith(
      '/v1/copy-trading/allocation-rebalance/preview',
      { totalValue: '100.00', allocations: [{ traderId: 'trader-a', currentValue: '10.00', targetWeightBps: 5000, priceAvailable: true }] },
      { idempotencyKey: 'preview-key-0001' },
    );
  });

  it('refuses a preview the API marked executable', async () => {
    post.mockResolvedValue({ ...previewResponse, executable: true });

    await expect(
      copyTradingExtendedApi.previewAllocationRebalance({ totalValue: '100.00', allocations: [] }),
    ).rejects.toThrow(/non-executable/);
  });

  // The budget view the reduce path is verified against: the effective cap is the tighter of the
  // personal ceiling and the tenant ceiling, and the parser refuses a response where it is not.
  const budgetView = {
    tenantId: 'tenant-1', userId: 'user-1', maxActiveExposure: '1000.000000000000', perTraderCap: null,
    tenantCeiling: '5000.000000000000', effectiveCap: '1000.000000000000', currency: 'USDT',
    committed: '100.000000000000', exposureStatus: 'ALLOCATION_ESTIMATE', remaining: '900.000000000000',
    utilisationBps: 1000, updatedAt: null,
  };

  it.each([
    ['getBudget', () => copyTradingExtendedApi.getBudget(), '/v1/copy-trading/budget', budgetView],
    ['getExecutionTimeline', () => copyTradingExtendedApi.getExecutionTimeline('exec-1'), '/v1/copy-trading/executions/exec-1/timeline', { executionId: 'exec-1', subscriptionId: 's-1', terminal: true, currentStatus: 'FILLED', entries: [] }],
    ['getTraderBenchmark', () => copyTradingExtendedApi.getTraderBenchmark('trader-1'), '/v1/copy-trading/traders/trader-1/benchmark', { status: 'UNAVAILABLE', traderId: 'trader-1', reason: 'NO_DATA' }],
    ['getLeaderFeePolicy', () => copyTradingExtendedApi.getLeaderFeePolicy('trader-1', 'USD'), '/v1/copy-trading/leader-fees/traders/trader-1', { traderId: 'trader-1', currency: 'USD', status: 'UNCONFIGURED', policy: null, feeCalculation: { status: 'UNAVAILABLE', reason: 'UNCONFIGURED' } }],
  ])('%s reads %s', async (_name, call, path, response) => {
    get.mockResolvedValue(response);

    await call();

    expect(get.mock.calls[0]?.[0]).toBe(path);
  });

  it('refuses a budget view whose effective cap is not the tighter of the two ceilings', async () => {
    get.mockResolvedValue({ ...budgetView, effectiveCap: '5000.000000000000' });

    await expect(copyTradingExtendedApi.getBudget()).rejects.toThrow('Invalid budget response');
  });

  it('reduces the budget through the tighten-only path with the caller key', async () => {
    post.mockResolvedValue({
      tenantId: 'tenant-1', userId: 'user-1', maxActiveExposure: '500.000000000000', perTraderCap: null,
      tenantCeiling: '1000.000000000000', effectiveCap: '500.000000000000', currency: 'USDT',
      committed: '100.000000000000', exposureStatus: 'ALLOCATION_ESTIMATE', remaining: '400.000000000000',
      utilisationBps: 2000, updatedAt: null,
    });

    await copyTradingExtendedApi.reduceBudget({ maxActiveExposure: '500.000000000000', currency: 'USDT' }, 'reduce-key-0001', { tenantId: 'tenant-1', userId: 'user-1' });

    expect(post).toHaveBeenCalledWith('/v1/copy-trading/budget/reduce', { maxActiveExposure: '500.000000000000', currency: 'USDT' }, { idempotencyKey: 'reduce-key-0001' });
  });
});

describe('decimal handling', () => {
  it('accepts the API money format and rejects floats, signs and exponents', () => {
    expect(DECIMAL_STRING.test('100000.100000000000')).toBe(true);
    expect(DECIMAL_STRING.test('0')).toBe(true);
    // 100000.1 through a JSON number is already 100000.09999999999, which is why these must fail.
    expect(DECIMAL_STRING.test('1e5')).toBe(false);
    expect(DECIMAL_STRING.test('-1')).toBe(false);
    expect(DECIMAL_STRING.test('')).toBe(false);
    expect(DECIMAL_STRING.test('12.1234567890123')).toBe(false);
  });
});
