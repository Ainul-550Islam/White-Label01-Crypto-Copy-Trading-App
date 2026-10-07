// # Responsibility: tests rebalance weight validation, exact supported precision, and the no-order preview safety contract.

import { AllocationRebalanceService } from './allocation-rebalance.service';

function parseAtSixteenPlaces(value: string): bigint {
  const [integer, fraction = ''] = value.split('.');
  return BigInt(integer) * 10n ** 16n + BigInt(fraction.padEnd(16, '0'));
}

describe('AllocationRebalanceService', () => {
  const service = new AllocationRebalanceService();

  it('calculates deterministic deltas at full accepted input precision and never emits executable orders', () => {
    const preview = service.preview({
      totalValue: '1000.123456789012',
      allocations: [
        { traderId: 'trader-a', currentValue: '500.123456789012', targetWeightBps: 5000, priceAvailable: true },
        { traderId: 'trader-b', currentValue: '500', targetWeightBps: 5000, priceAvailable: true },
      ],
    });

    expect(preview.totalValue).toBe('1000.123456789012');
    expect(preview.lines[0].currentValue).toBe('500.123456789012');
    expect(preview.lines[0].targetValue).toBe('500.061728394506');
    expect(preview.lines[0].deltaValue).toBe('-0.061728394506');
    expect(preview.lines[1].targetValue).toBe('500.061728394506');
    expect(preview.lines[1].deltaValue).toBe('0.061728394506');
    expect(preview.executable).toBe(false);
    expect(preview.reason).toMatch(/no order/i);
  });

  it('represents sub-picounit target splits exactly at sixteen decimal places without losing total value', () => {
    const preview = service.preview({
      totalValue: '0.000000000001',
      allocations: [
        { traderId: 'trader-a', currentValue: '0', targetWeightBps: 5000, priceAvailable: true },
        { traderId: 'trader-b', currentValue: '0', targetWeightBps: 5000, priceAvailable: true },
      ],
    });

    expect(preview.lines.map((line) => line.targetValue)).toEqual([
      '0.0000000000005',
      '0.0000000000005',
    ]);
    expect(preview.lines.map((line) => line.status)).toEqual(['PREVIEW', 'PREVIEW']);
    expect(
      preview.lines.reduce((sum, line) => sum + parseAtSixteenPlaces(line.targetValue ?? '0'), 0n),
    ).toBe(10_000n);
  });

  it('does not estimate a target when valuation or price evidence is unavailable', () => {
    const preview = service.preview({
      totalValue: '500.000000000001',
      allocations: [
        { traderId: 'a', currentValue: '500.000000000001', targetWeightBps: 10_000, priceAvailable: false },
      ],
    });

    expect(preview.lines[0].status).toBe('UNAVAILABLE');
    expect(preview.lines[0].currentValue).toBe('500.000000000001');
    expect(preview.lines[0].targetValue).toBeNull();
    expect(preview.lines[0].deltaValue).toBeNull();
  });

  it('rejects duplicate ids, negative amounts and target weights not totaling one hundred percent', () => {
    expect(() => service.preview({
      totalValue: '100',
      allocations: [{ traderId: 'a', currentValue: '0', targetWeightBps: 9000, priceAvailable: true }],
    })).toThrow(/sum/i);

    expect(() => service.preview({
      totalValue: '100',
      allocations: [
        { traderId: 'a', currentValue: '0', targetWeightBps: 5000, priceAvailable: true },
        { traderId: 'a', currentValue: '0', targetWeightBps: 5000, priceAvailable: true },
      ],
    })).toThrow(/unique/i);

    expect(() => service.preview({
      totalValue: '100',
      allocations: [{ traderId: 'a', currentValue: '-0.01', targetWeightBps: 10_000, priceAvailable: true }],
    })).toThrow(/negative/i);

    expect(() => service.preview({
      totalValue: '100',
      allocations: [{ traderId: 'a', currentValue: '0', targetWeightBps: 10_001, priceAvailable: true }],
    })).toThrow(/basis points/i);

    expect(() => service.preview({
      totalValue: '100',
      allocations: [{ traderId: 'a', currentValue: '0', targetWeightBps: 10_000, priceAvailable: 'true' as unknown as boolean }],
    })).toThrow(/boolean/i);

    expect(() => service.preview({
      totalValue: '1e3',
      allocations: [{ traderId: 'a', currentValue: '0', targetWeightBps: 10_000, priceAvailable: true }],
    })).toThrow(TypeError);
  });
});
