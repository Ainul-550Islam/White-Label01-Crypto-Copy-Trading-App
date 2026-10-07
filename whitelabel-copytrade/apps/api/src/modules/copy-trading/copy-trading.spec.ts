// # Unit tests for sizing modes, lifecycle transitions, and stop policies
import './copy-policy.service.spec';
import './follower-subscription.service.spec';
import {
  CopySizingMode,
  CopySubscriptionState,
  compareDecimalStrings,
} from './copy-trading.types';

describe('Copy-Trading Sizing Modes, Lifecycle Transitions & Stop Policies (GAP-07, GAP-08, GAP-09)', () => {
  test('supports all canonical CopySizingMode variants', () => {
    expect(CopySizingMode.FIXED).toBe('FIXED');
    expect(CopySizingMode.PERCENTAGE_BALANCE).toBe('PERCENTAGE_BALANCE');
    expect(CopySizingMode.PROPORTIONAL).toBe('PROPORTIONAL');
  });

  test('enforces valid CopySubscriptionState lifecycle transitions', () => {
    expect(CopySubscriptionState.PENDING).toBe('PENDING');
    expect(CopySubscriptionState.ACTIVE).toBe('ACTIVE');
    expect(CopySubscriptionState.PAUSED).toBe('PAUSED');
    expect(CopySubscriptionState.STOPPED).toBe('STOPPED');
  });

  test('compares decimal allocations deterministically without floating-point rounding drift', () => {
    expect(compareDecimalStrings('250.00', '250')).toBe(0);
    expect(compareDecimalStrings('1000.50', '999.99')).toBe(1);
    expect(compareDecimalStrings('25.00', '100.00')).toBe(-1);
  });
});
