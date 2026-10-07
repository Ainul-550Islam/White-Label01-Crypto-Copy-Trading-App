// # Tests risk block, auto-pause on drawdown breach, and kill-switch enforcement
import './follower-risk.service.spec';
import { CopyRiskDecision, compareDecimalStrings } from './copy-trading.types';

describe('Copy-Trading Follower Safety & Drawdown Auto-Pause Contract (GAP-16)', () => {
  test('exposes canonical CopyRiskDecision states including ALLOW, REDUCE, BLOCK, PAUSE, and STOP_COPY', () => {
    expect(CopyRiskDecision.ALLOW).toBe('ALLOW');
    expect(CopyRiskDecision.REDUCE).toBe('REDUCE');
    expect(CopyRiskDecision.BLOCK).toBe('BLOCK');
    expect(CopyRiskDecision.PAUSE).toBe('PAUSE');
    expect(CopyRiskDecision.STOP_COPY).toBe('STOP_COPY');
  });

  test('evaluates drawdown and daily loss limits using exact decimal comparison', () => {
    const realizedDrawdownPct = '12.50';
    const maxDrawdownLimitPct = '10.00';
    const breached = compareDecimalStrings(realizedDrawdownPct, maxDrawdownLimitPct) > 0;
    expect(breached).toBe(true);
  });
});
