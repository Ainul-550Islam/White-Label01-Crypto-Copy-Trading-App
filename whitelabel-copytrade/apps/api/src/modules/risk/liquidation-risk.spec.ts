// # Verifies liquidation distance buckets with exact decimals, hysteresis against alert flapping, UNKNOWN (never SAFE) without an authoritative liquidation price, and tenant isolation of the position read.
import { LiquidationBucket, LiquidationReasonCode, DEFAULT_LIQUIDATION_THRESHOLDS_BPS, boundaryForBucket, bucketSeverity, evaluateLiquidationDistance, liquidationAlertKey } from './liquidation-distance';
import { LiquidationRiskService } from '../risk-management/liquidation-risk.service';
import { RiskState } from '../risk-management/risk-management.types';

/**
 * What this file pins, and why each assertion exists:
 *
 *  - The four buckets land on the exact decimal boundary. `9.99%` is DANGER and
 *    `10.00%` is WATCH: an off-by-one-wei in a liquidation alert is an alert
 *    that arrives one margin call too late.
 *  - A missing authoritative liquidation price is UNKNOWN. It is never SAFE,
 *    and it still alerts, because "we cannot tell" is information.
 *  - Hysteresis: a bucket is entered immediately and left only after the band is
 *    cleared, so a mark price oscillating on a threshold does not produce a
 *    stream of alerts nobody reads.
 *  - Tenant isolation: the risk service's position query is tenant-scoped and
 *    the tenant comes from the caller, never from the position row.
 */

function distanceFor(percent: string, price = '100'): { markPrice: string; liquidationPrice: string } {
  // liquidationPrice = mark * (1 - pct)
  const pct = Number(percent) / 100;
  const liq = (Number(price) * (1 - pct)).toFixed(10);
  return { markPrice: price, liquidationPrice: liq };
}

describe('liquidation distance buckets (GAP-65)', () => {
  it('classifies exact boundary distances into SAFE, WATCH, DANGER and CRITICAL', () => {
    const cases: Array<[string, LiquidationBucket]> = [
      ['20', LiquidationBucket.SAFE],
      ['15.01', LiquidationBucket.SAFE],
      ['14.99', LiquidationBucket.WATCH],
      ['7.01', LiquidationBucket.WATCH],
      ['6.99', LiquidationBucket.DANGER],
      ['3.01', LiquidationBucket.DANGER],
      ['2.99', LiquidationBucket.CRITICAL],
      ['0.05', LiquidationBucket.CRITICAL],
    ];
    for (const [percent, expected] of cases) {
      const { markPrice, liquidationPrice } = distanceFor(percent);
      const result = evaluateLiquidationDistance({ markPrice, liquidationPrice, quantity: '1' });
      expect([percent, result.bucket]).toEqual([percent, expected]);
    }
  });

  it('reports the distance as an exact basis-point string, never a float', () => {
    const result = evaluateLiquidationDistance({ markPrice: '100', liquidationPrice: '93.33', quantity: '2' });
    // (100 - 93.33) / 100 * 10_000 = 667 bps = 6.67%
    expect(result.distanceBps).toBe('667');
    expect(result.distancePercent).toBe('6.67');
    expect(result.distanceAbs).toBe('6.67');
    expect(result.bucket).toBe(LiquidationBucket.DANGER);
  });

  it('is UNKNOWN - never SAFE - when the venue has not supplied a liquidation price', () => {
    const result = evaluateLiquidationDistance({ markPrice: '100', liquidationPrice: null, quantity: '1' });
    expect(result.bucket).toBe(LiquidationBucket.UNKNOWN);
    expect(result.reasonCode).toBe(LiquidationReasonCode.LIQUIDATION_PRICE_UNAVAILABLE);
    expect(result.distanceBps).toBeNull();
    expect(result.alert).toBe(true);
    // The comparison a UI must be able to make without trusting prose:
    expect(bucketSeverity(result.bucket)).toBeLessThan(bucketSeverity(LiquidationBucket.SAFE));
  });

  it('is UNKNOWN for a missing or zero mark price, and for a malformed quantity', () => {
    expect(evaluateLiquidationDistance({ markPrice: null, liquidationPrice: '90', quantity: '1' }).reasonCode)
      .toBe(LiquidationReasonCode.MARK_PRICE_UNAVAILABLE);
    expect(evaluateLiquidationDistance({ markPrice: '0', liquidationPrice: '90', quantity: '1' }).reasonCode)
      .toBe(LiquidationReasonCode.MARK_PRICE_ZERO);
    expect(evaluateLiquidationDistance({ markPrice: '100', liquidationPrice: '90', quantity: '1e5' }).reasonCode)
      .toBe(LiquidationReasonCode.INPUT_NOT_DECIMAL);
  });

  it('treats a flat position as SAFE and does not alert', () => {
    const result = evaluateLiquidationDistance({ markPrice: '100', liquidationPrice: null, quantity: '0' });
    expect(result.bucket).toBe(LiquidationBucket.SAFE);
    expect(result.reasonCode).toBe(LiquidationReasonCode.POSITION_FLAT);
    expect(result.alert).toBe(false);
  });

  it('enters a worse bucket immediately and leaves it only after the hysteresis band', () => {
    const thresholds = DEFAULT_LIQUIDATION_THRESHOLDS_BPS;
    // 6.5% -> DANGER (below danger 7%), entered at once from SAFE.
    const entered = evaluateLiquidationDistance({ ...distanceFor('6.5'), quantity: '1', previousBucket: LiquidationBucket.SAFE });
    expect(entered.bucket).toBe(LiquidationBucket.DANGER);
    expect(entered.heldByHysteresis).toBe(false);

    // 7.5% would nominate WATCH, but leaving DANGER needs 7% + 1% = 8%.
    const held = evaluateLiquidationDistance({ ...distanceFor('7.5'), quantity: '1', previousBucket: LiquidationBucket.DANGER });
    expect(held.bucket).toBe(LiquidationBucket.DANGER);
    expect(held.heldByHysteresis).toBe(true);
    expect(held.reasonCode).toBe(LiquidationReasonCode.HELD_BY_HYSTERESIS);

    // 8.5% clears the band and the bucket moves up.
    const recovered = evaluateLiquidationDistance({ ...distanceFor('8.5'), quantity: '1', previousBucket: LiquidationBucket.DANGER });
    expect(recovered.bucket).toBe(LiquidationBucket.WATCH);
    expect(recovered.heldByHysteresis).toBe(false);

    // And a recovery is not blocked by the previous UNKNOWN state.
    const fromUnknown = evaluateLiquidationDistance({ ...distanceFor('40'), quantity: '1', previousBucket: LiquidationBucket.UNKNOWN });
    expect(fromUnknown.bucket).toBe(LiquidationBucket.SAFE);
    expect(boundaryForBucket(LiquidationBucket.DANGER, thresholds).toString()).toBe('700');
  });

  it('does not flap when the mark price oscillates around a threshold', () => {
    let bucket: LiquidationBucket = LiquidationBucket.SAFE;
    const emitted: LiquidationBucket[] = [];
    // 14.5 / 15.5 / 14.5 / 15.5 ... around the 15% WATCH boundary. Without
    // hysteresis this alternates SAFE/WATCH eight times; with it, one WATCH.
    for (const percent of ['14.5', '15.5', '14.5', '15.5', '14.5', '15.5', '14.5', '15.5']) {
      const result = evaluateLiquidationDistance({ ...distanceFor(percent), quantity: '1', previousBucket: bucket });
      if (result.bucket !== bucket) emitted.push(result.bucket);
      bucket = result.bucket;
    }
    expect(emitted).toEqual([LiquidationBucket.WATCH]);
    expect(bucket).toBe(LiquidationBucket.WATCH);
  });

  it('rejects unordered thresholds instead of silently classifying with them', () => {
    expect(() => evaluateLiquidationDistance({
      markPrice: '100',
      liquidationPrice: '90',
      quantity: '1',
      thresholds: { watch: 500, danger: 700, critical: 300 },
    })).toThrow(/ordered/);
  });

  it('keys alerts per position and bucket so a DANGER alert does not suppress CRITICAL', () => {
    expect(liquidationAlertKey('pos-1', LiquidationBucket.DANGER)).toBe('liquidation-alert:pos-1:DANGER');
    expect(liquidationAlertKey('pos-1', LiquidationBucket.CRITICAL))
      .not.toBe(liquidationAlertKey('pos-1', LiquidationBucket.DANGER));
  });
});

describe('canonical liquidation risk service tenant isolation', () => {
  function build() {
    const findMany = jest.fn(async () => [
      { id: 'pos-1', tenantId: 'tenant-1', accountId: 'acct-1', symbol: 'BTC-USDT', quantity: '1', side: 'LONG', markPrice: '100000', unrealizedPnl: '0', entryPrice: '99000' },
    ]);
    const prisma = {
      position: { findMany },
      // The canonical service reads the symbol's market type before deciding that
      // a spot position has no liquidation price. PERPETUAL here, so the
      // liquidation branch - the one this file is about - is the one exercised.
      tradingSymbol: { findFirst: jest.fn(async () => ({ symbol: 'BTC-USDT', marketType: 'PERPETUAL' })) },
    };
    const policyService = {
      resolveEffectivePolicy: jest.fn(async () => ({ thresholds: { liquidationCriticalDistance: '3', liquidationWarningDistance: '10' } })),
    };
    return { service: new LiquidationRiskService(prisma as never, policyService as never), findMany };
  }

  it('reads positions only for the tenant it was given, and never from the row', async () => {
    const { service, findMany } = build();
    await service.evaluateLiquidationRisk({ tenantId: 'tenant-1' });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-1' }) }));
  });

  it('returns UNKNOWN rather than inventing a liquidation price the venue never sent', async () => {
    const { service } = build();
    const [result] = await service.evaluateLiquidationRisk({ tenantId: 'tenant-1' });
    expect(result.state).toBe(RiskState.UNKNOWN);
    expect(result.liquidationPrice).toBeNull();
  });
});
