// # Tests that payout and settlement ledgers never exceed accrued exact minor-unit balances.
import { verifyPartnerCommissionBalanceParity } from './partner-reconciliation.service';

describe('partner commission reconciliation', () => {
  it('accepts balanced minor-unit totals and detects settled/paid excess', () => {
    expect(
      verifyPartnerCommissionBalanceParity({
        accruedMinorUnits: 100n,
        settledMinorUnits: 80n,
        paidMinorUnits: 80n,
      }).inSync,
    ).toBe(true);
    expect(
      verifyPartnerCommissionBalanceParity({
        accruedMinorUnits: 100n,
        settledMinorUnits: 101n,
        paidMinorUnits: 0n,
      }).inSync,
    ).toBe(false);
    expect(
      verifyPartnerCommissionBalanceParity({
        accruedMinorUnits: 100n,
        settledMinorUnits: 80n,
        paidMinorUnits: 81n,
      }).inSync,
    ).toBe(false);
  });
});
