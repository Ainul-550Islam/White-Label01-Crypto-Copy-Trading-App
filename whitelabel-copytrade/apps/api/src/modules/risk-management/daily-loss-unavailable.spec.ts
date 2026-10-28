import { DailyLossLimitService } from './daily-loss-limit.service';
import { RiskState } from './risk-management.types';

const tenantId = 'tenant-1', accountId = 'account-1';
const asDecimal = (value: string) => ({ toString: () => value });

function makeService(includesUnrealized: boolean) {
  const now = new Date();
  const prisma = {
    position: { findMany: jest.fn().mockResolvedValue([{ accountId, unrealisedPnl: asDecimal('-100'), updatedAt: now }]) },
    accountBalanceSnapshot: { findMany: jest.fn().mockResolvedValue([{ accountId, total: asDecimal('800'), updatedAt: now }]) },
    riskSnapshotMetadata: { findMany: jest.fn().mockResolvedValue([{ accountId, equity: asDecimal('1000'), capturedAt: now }]) },
  };
  const policy = { resolveEffectivePolicy: jest.fn().mockResolvedValue({ effectiveVersion: 'v1',
    thresholds: { maxDailyLoss: '100', dailyLossIncludesUnrealized: includesUnrealized } }) };
  return new DailyLossLimitService(prisma as never, policy as never);
}

describe('daily realized loss cannot be inferred from equity movements', () => {
  it('withholds realized-only PnL, breach and remaining budget even with an equity baseline', async () => {
    const [result] = await makeService(false).evaluateDailyLoss({ tenantId, accountId });
    expect(result.realizedPnl).toBeNull();
    expect(result.unrealizedPnl).toBeNull();
    expect(result.dailyPnl).toBeNull();
    expect(result.remainingBudget).toBeNull();
    expect(result.state).toBe(RiskState.UNKNOWN);
    expect(result.isBreach).toBe(false);
  });

  it('does not mistake an equity delta affected by cash flows or quote units for combined daily PnL', async () => {
    const [result] = await makeService(true).evaluateDailyLoss({ tenantId, accountId });
    expect(result.startingEquity).toBeNull();
    expect(result.currentEquity).toBeNull();
    expect(result.realizedPnl).toBeNull();
    expect(result.unrealizedPnl).toBeNull();
    expect(result.dailyPnl).toBeNull();
    expect(result.remainingBudget).toBeNull();
    expect(result.state).toBe(RiskState.UNKNOWN);
    expect(result.sourceTimestamp).toBeNull();
  });
});
