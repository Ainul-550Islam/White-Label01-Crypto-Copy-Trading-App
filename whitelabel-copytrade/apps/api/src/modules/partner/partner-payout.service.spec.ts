// # Regression tests for exact-decimal payout threshold and settlement hold eligibility.
import { evaluatePartnerPayoutThresholdAndHold } from './partner-payout.service';

describe('partner payout eligibility', () => {
  it('compares money as exact decimal strings without binary floating-point coercion', () => {
    expect(
      evaluatePartnerPayoutThresholdAndHold({ amount: '0.30', minPayoutThreshold: '0.3' }),
    ).toEqual({ allowed: true });
    expect(
      evaluatePartnerPayoutThresholdAndHold({
        amount: '0.299999999999999999',
        minPayoutThreshold: '0.3',
      }).allowed,
    ).toBe(false);
  });

  it('refuses invalid decimal inputs and an unelapsed hold window', () => {
    expect(
      evaluatePartnerPayoutThresholdAndHold({ amount: '1e3', minPayoutThreshold: '1' }).allowed,
    ).toBe(false);
    expect(
      evaluatePartnerPayoutThresholdAndHold({
        amount: '10',
        minPayoutThreshold: '1',
        settlementLockedAtIso: '2026-10-25T00:00:00Z',
        holdWindowHours: 24,
        nowMs: Date.parse('2026-10-25T12:00:00Z'),
      }).allowed,
    ).toBe(false);
  });
});
