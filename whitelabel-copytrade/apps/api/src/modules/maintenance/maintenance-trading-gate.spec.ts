// # Verifies maintenance and kill-switch blocking across manual and copy order paths
import { ExecutionSafetyService } from '../execution/execution-safety.service';
import { RiskService } from '../risk/risk.service';

describe('Maintenance & Kill-Switch Trading Gate (GAP-24 & GAP-25)', () => {
  test('blocks order dispatch when platform, tenant, venue, symbol, or account kill-switch is engaged', async () => {
    const mockPrisma: any = {
      killSwitch: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'ks-1',
            scope: 'EXCHANGE',
            target: 'BINANCE',
            isEngaged: true,
            reason: 'Binance connectivity degradation',
            engagedByUserId: 'admin-1',
            engagedAt: new Date('2026-10-01T10:00:00.000Z'),
            releasedByUserId: null,
            releasedAt: null,
            updatedAt: new Date('2026-10-01T10:00:00.000Z'),
          },
          {
            id: 'ks-2',
            scope: 'SYMBOL',
            target: 'BTC-USDT',
            isEngaged: true,
            reason: 'Volatility halt on BTC-USDT',
            engagedByUserId: 'admin-1',
            engagedAt: new Date('2026-10-01T10:05:00.000Z'),
            releasedByUserId: null,
            releasedAt: null,
            updatedAt: new Date('2026-10-01T10:05:00.000Z'),
          },
        ]),
      },
    };
    const mockAudit: any = { recordImmediate: jest.fn() };
    const mockConfig: any = {
      executionSafetySummary: {
        tradingMode: 'PAPER',
        executionEnabled: false,
        liveTradingEnabled: false,
        dryRun: true,
        paperTrading: true,
        sandboxMode: true,
      },
    };
    const mockLogger: any = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

    const safetyService = new ExecutionSafetyService(
      mockPrisma,
      mockAudit,
      mockConfig,
      mockLogger,
    );

    const gate = await safetyService.evaluateOrderGate({
      tenantId: 'tenant-1',
      venue: 'BINANCE',
      symbol: 'BTC-USDT',
      accountId: 'acct-1',
    });

    expect(gate.allowed).toBe(false);
    expect(gate.blockingSwitches).toHaveLength(2);
    expect(gate.reasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining('EXCHANGE kill switch engaged (BINANCE)'),
        expect.stringContaining('SYMBOL kill switch engaged (BTC-USDT)'),
      ]),
    );
  });

  test('enforces pre-trade available balance, margin, min-notional, step-size, and tick-size checks (GAP-24)', () => {
    const riskService = new RiskService();

    // Valid order
    const ok = riskService.evaluatePreTradeOrderRules({
      quantity: '0.25',
      price: '60000.00',
      availableBalance: '10000.00',
      leverage: '2',
      minQuantity: '0.01',
      maxQuantity: '10.00',
      quantityStep: '0.01',
      tickSize: '0.50',
      minNotional: '100.00',
    });
    expect(ok.allowed).toBe(true);
    expect(ok.computedNotional).toBe('15000.00000000');
    expect(ok.requiredMargin).toBe('7500.00000000');

    // Invalid stepSize, tickSize, minNotional, and insufficient balance
    const bad = riskService.evaluatePreTradeOrderRules({
      quantity: '0.005',
      price: '1000.13',
      availableBalance: '1.00',
      leverage: '1',
      minQuantity: '0.01',
      quantityStep: '0.01',
      tickSize: '0.50',
      minNotional: '50.00',
    });
    expect(bad.allowed).toBe(false);
    expect(bad.reasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining('below minQuantity 0.01'),
        expect.stringContaining('not a multiple of stepSize 0.01'),
        expect.stringContaining('does not conform to tickSize 0.50'),
        expect.stringContaining('below minNotional 50.00'),
        expect.stringContaining('Insufficient available balance'),
      ]),
    );
  });
});
