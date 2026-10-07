// # Responsibility: verifies the allocation planner request shape, exact-decimal response mapping, and fail-closed preview contract.

import { apiClient } from '@/api/api-client';
import { tradingApi } from '@/api/trading-api';

describe('tradingApi.previewAllocationRebalance', () => {
  afterEach(() => jest.restoreAllMocks());

  it('sends decimal strings unchanged and maps only a non-executable unverified response', async () => {
    const input = {
      totalValue: '0.000000000001',
      allocations: [
        { traderId: 'trader-a', currentValue: '0', targetWeightBps: 5000, priceAvailable: true },
        { traderId: 'trader-b', currentValue: '0', targetWeightBps: 5000, priceAvailable: true },
      ],
    };
    const post = jest.spyOn(apiClient, 'post').mockResolvedValue({
      executable: false,
      inputProvenance: 'CLIENT_SUPPLIED_UNVERIFIED',
      lines: [
        {
          traderId: 'trader-a',
          currentValue: '0',
          targetValue: '0.0000000000005',
          deltaValue: '0.0000000000005',
          targetWeightBps: 5000,
          status: 'PREVIEW',
        },
        {
          traderId: 'trader-b',
          currentValue: '0',
          targetValue: '0.0000000000005',
          deltaValue: '0.0000000000005',
          targetWeightBps: 5000,
          status: 'PREVIEW',
        },
      ],
    } as never);

    await expect(tradingApi.previewAllocationRebalance(input)).resolves.toEqual([
      {
        traderId: 'trader-a',
        currentValue: '0',
        targetValue: '0.0000000000005',
        deltaValue: '0.0000000000005',
        targetWeightBps: 5000,
        status: 'PREVIEW',
      },
      {
        traderId: 'trader-b',
        currentValue: '0',
        targetValue: '0.0000000000005',
        deltaValue: '0.0000000000005',
        targetWeightBps: 5000,
        status: 'PREVIEW',
      },
    ]);
    expect(post).toHaveBeenCalledWith('/v1/copy-trading/allocation-rebalance/preview', input);
  });

  it('rejects executable or differently-provenanced responses', async () => {
    jest.spyOn(apiClient, 'post').mockResolvedValue({
      executable: true,
      inputProvenance: 'PERSISTED',
      lines: [],
    } as never);

    await expect(tradingApi.previewAllocationRebalance({ totalValue: '1', allocations: [] })).rejects.toThrow(
      /non-executable, unverified-input contract/,
    );
  });
});
