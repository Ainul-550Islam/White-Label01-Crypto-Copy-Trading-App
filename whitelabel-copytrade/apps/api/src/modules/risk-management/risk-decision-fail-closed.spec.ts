import { RiskDecisionService } from './risk-decision.service';
import { RiskDecision, RiskState } from './risk-management.types';

const params = {
  tenantId: 'tenant-1', accountId: 'account-1', userId: 'user-1', symbol: 'BTC-USDT',
  orderIntent: { side: 'BUY' as const, quantity: '0.1', price: '100', orderType: 'LIMIT' as const },
  environment: 'PAPER' as const,
};

function harness() {
  const thresholds = { notionalCurrency: 'USDT', maxGrossExposure: '1000', maxSymbolExposure: '1000', maxPositionNotional: '1000',
    maxDailyLoss: '100', marketDataMaxAgeMs: 30000, exchangeHealthMaxAgeMs: 60000,
    liquidationCriticalDistance: '5', liquidationWarningDistance: '10', marginCriticalUtilization: '90' };
  const policy = { effectiveVersion: 'policy-v1', scopeChain: [], thresholds, sourcePolicies: [{ thresholds }] };
  const empty = () => jest.fn().mockResolvedValue([]);
  const tx = {
    riskDecisionRecord: { create: jest.fn().mockResolvedValue({}) },
    complianceScreeningRequest: { findFirst: jest.fn().mockResolvedValue(null) },
    securityThreatSignal: { findFirst: jest.fn().mockResolvedValue(null) },
    tradingAccount: { findFirst: jest.fn().mockResolvedValue({ status: 'ACTIVE', lastVerifiedAt: new Date() }) },
  };
  const prisma = {
    ...tx,
    withTenantRls: jest.fn(async (_tenant: string, fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
  };
  const exposure = { calculateExposure: jest.fn().mockResolvedValue({
    state: RiskState.NORMAL, grossExposure: '0', totalExposure: '0', valuationCurrency: 'USDT', symbolExposures: [], staleSymbols: [], unknownPrices: [],
  }) };
  const position = { evaluatePositionRisk: empty() };
  const margin = { evaluateMargin: jest.fn().mockResolvedValue([{ state: RiskState.NORMAL, isStale: false,
    marginUtilizationPercent: '0', projectedMarginUtilizationPercent: '10' }]) };
  const leverage = { evaluateLeverage: empty() };
  const liquidation = { evaluateLiquidationRisk: empty() };
  const concentration = { evaluateConcentration: empty() };
  const drawdown = { evaluateDrawdown: empty() };
  const daily = { evaluateDailyLoss: jest.fn().mockResolvedValue([{ state: RiskState.NORMAL, dailyPnl: '0', isBreach: false }]) };
  const correlation = { evaluateCorrelation: empty() };
  const variation = { evaluateVar: empty() };
  const stress = { runStressTests: empty() };
  const breaker = { isBlocked: jest.fn().mockResolvedValue(false) };
  const kill = { isEngaged: jest.fn().mockResolvedValue(false) };
  const events = { emitThresholdBreached: jest.fn().mockResolvedValue(undefined) };
  const outbox = { append: jest.fn().mockResolvedValue(undefined) };
  const service = new RiskDecisionService(prisma as never, { resolveEffectivePolicy: jest.fn().mockResolvedValue(policy) } as never,
    exposure as never, position as never, margin as never, leverage as never, liquidation as never, concentration as never,
    drawdown as never, daily as never, correlation as never, variation as never, stress as never,
    breaker as never, kill as never, {} as never, events as never, outbox as never);
  return { service, policy, prisma, tx, exposure, position, margin, leverage, liquidation, concentration, drawdown, daily, breaker, kill, events, outbox };
}

const failedChecks = [
  ['exposure', 'calculateExposure', 'MAX_GROSS_EXPOSURE'],
  ['position', 'evaluatePositionRisk', 'POSITION_RISK_UNAVAILABLE'],
  ['margin', 'evaluateMargin', 'MARGIN_RISK_UNAVAILABLE'],
  ['leverage', 'evaluateLeverage', 'LEVERAGE_RISK_UNAVAILABLE'],
  ['liquidation', 'evaluateLiquidationRisk', 'LIQUIDATION_RISK_UNAVAILABLE'],
  ['concentration', 'evaluateConcentration', 'CONCENTRATION_RISK_UNAVAILABLE'],
  ['drawdown', 'evaluateDrawdown', 'DRAWDOWN_RISK_UNAVAILABLE'],
  ['daily', 'evaluateDailyLoss', 'DAILY_LOSS_UNAVAILABLE'],
  ['breaker', 'isBlocked', 'CIRCUIT_BREAKER_UNAVAILABLE'],
  ['kill', 'isEngaged', 'KILL_SWITCH_UNAVAILABLE'],
] as const;

describe('unified risk cannot turn a failed critical check into approval', () => {
  it.each(failedChecks)('%s unavailable requires review without leaking the underlying error', async (component, method, code) => {
    const h = harness();
    const dependency = h[component] as unknown as Record<string, jest.Mock>;
    dependency[method].mockRejectedValueOnce(new Error('private database credential detail'));
    const decision = await h.service.evaluateUnifiedRisk(params);
    expect(decision.decision).toBe(RiskDecision.REVIEW_REQUIRED);
    expect(decision.ruleIds).toContain(code);
    expect(JSON.stringify(decision)).not.toContain('private database credential detail');
    expect(decision.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(h.prisma.withTenantRls).toHaveBeenCalledWith(params.tenantId, expect.any(Function));
    expect(h.prisma.riskDecisionRecord.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ id: decision.id, decision: RiskDecision.REVIEW_REQUIRED }),
    }));
  });

  it.each([
    ['complianceScreeningRequest', 'COMPLIANCE_BLOCK'],
    ['securityThreatSignal', 'SECURITY_CHECK_UNAVAILABLE'],
  ] as const)('requires review when the %s source throws', async (source, ruleId) => {
    const h = harness();
    h.prisma[source].findFirst.mockRejectedValueOnce(new Error('private backend detail'));
    const decision = await h.service.evaluateUnifiedRisk(params);
    expect(decision.decision).toBe(RiskDecision.REVIEW_REQUIRED);
    expect(decision.ruleIds).toContain(ruleId);
    expect(JSON.stringify(decision)).not.toContain('private backend detail');
  });

  it.each([
    [{ status: 'COMPLETED', decision: 'REVIEW_REQUIRED' }, RiskDecision.REVIEW_REQUIRED, 'COMPLIANCE_REVIEW_REQUIRED'],
    [{ status: 'BLOCKED', decision: 'ALLOW' }, RiskDecision.BLOCK, 'COMPLIANCE_BLOCK'],
    [{ status: 'COMPLETED', decision: 'BLOCK' }, RiskDecision.BLOCK, 'COMPLIANCE_BLOCK'],
  ] as const)('does not allow a non-clear screening: %s', async (screening, expected, ruleId) => {
    const h = harness();
    h.prisma.complianceScreeningRequest.findFirst.mockResolvedValueOnce(screening as never);
    const decision = await h.service.evaluateUnifiedRisk(params);
    expect(decision.decision).toBe(expected);
    expect(decision.ruleIds).toContain(ruleId);
    expect(h.prisma.complianceScreeningRequest.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantId: 'tenant-1', userId: 'user-1', OR: expect.any(Array) }),
    }));
  });

  it('screens the real account owner as well as the acting operator', async () => {
    const h = harness();
    h.prisma.tradingAccount.findFirst.mockResolvedValue({ userId: 'owner-2', status: 'ACTIVE', lastVerifiedAt: new Date() } as never);
    h.prisma.complianceScreeningRequest.findFirst.mockImplementation(async (args: any) =>
      args.where.userId === 'owner-2' ? { status: 'COMPLETED', decision: 'BLOCK' } : null);
    const result = await h.service.evaluateUnifiedRisk({ ...params, expectedAccountOwnerId: 'owner-2' });
    expect(result.decision).toBe(RiskDecision.BLOCK);
    expect(result.ruleIds).toContain('COMPLIANCE_BLOCK');
    const subjects = h.prisma.complianceScreeningRequest.findFirst.mock.calls.map(([args]) => (args as any).where.userId);
    expect(subjects).toEqual(['user-1', 'owner-2']);
    expect(h.prisma.securityThreatSignal.findFirst.mock.calls.map(([args]) => (args as any).where.userId)).toEqual(['user-1', 'owner-2']);
  });

  it('does not approve a decision for a changed account owner', async () => {
    const h = harness();
    h.prisma.tradingAccount.findFirst.mockResolvedValue({ userId: 'new-owner', status: 'ACTIVE', lastVerifiedAt: new Date() } as never);
    const result = await h.service.evaluateUnifiedRisk({ ...params, expectedAccountOwnerId: 'previous-owner' });
    expect(result.decision).toBe(RiskDecision.REVIEW_REQUIRED);
    expect(result.ruleIds).toContain('ACCOUNT_OWNER_CHANGED');
  });

  it('requires review when the account cannot be found or read', async () => {
    for (const failure of ['missing', 'throws'] as const) {
      const h = harness();
      if (failure === 'missing') h.prisma.tradingAccount.findFirst.mockResolvedValueOnce(null);
      else h.prisma.tradingAccount.findFirst.mockRejectedValueOnce(new Error('private backend detail'));
      const decision = await h.service.evaluateUnifiedRisk(params);
      expect(decision.decision).toBe(RiskDecision.REVIEW_REQUIRED);
      expect(decision.ruleIds).toContain('EXCHANGE_HEALTH_UNAVAILABLE');
    }
  });

  it('does not treat empty configured margin, leverage or drawdown evaluations as healthy', async () => {
    const h = harness();
    Object.assign(h.policy.thresholds, { maxLeverageGross: '5', maxDrawdownPercent: '20' });
    h.margin.evaluateMargin.mockResolvedValueOnce([]);
    h.leverage.evaluateLeverage.mockResolvedValueOnce([]);
    h.drawdown.evaluateDrawdown.mockResolvedValueOnce([]);
    const decision = await h.service.evaluateUnifiedRisk(params);
    expect(decision.decision).toBe(RiskDecision.REVIEW_REQUIRED);
    expect(decision.ruleIds).toEqual(expect.arrayContaining([
      'MARGIN_RISK_UNAVAILABLE', 'LEVERAGE_RISK_UNAVAILABLE', 'DRAWDOWN_RISK_UNAVAILABLE',
    ]));
  });

  it('does not interpret empty daily-loss data as an unbreached configured limit', async () => {
    const h = harness();
    h.daily.evaluateDailyLoss.mockResolvedValueOnce([]);
    const decision = await h.service.evaluateUnifiedRisk(params);
    expect(decision.decision).toBe(RiskDecision.REVIEW_REQUIRED);
    expect(decision.ruleIds).toContain('DAILY_LOSS_UNAVAILABLE');
  });

  it.each([RiskState.UNKNOWN, RiskState.STALE])('requires review for %s daily-loss evidence', async (state) => {
    const h = harness();
    h.daily.evaluateDailyLoss.mockResolvedValueOnce([{ state, dailyPnl: null, isBreach: false }]);
    const decision = await h.service.evaluateUnifiedRisk(params);
    expect(decision.decision).toBe(RiskDecision.REVIEW_REQUIRED);
    expect(decision.ruleIds).toContain('DAILY_LOSS_UNAVAILABLE');
  });

  it.each([
    ['exposure', 'calculateExposure', { state: RiskState.UNKNOWN, grossExposure: null, symbolExposures: [], staleSymbols: [] }, 'MAX_GROSS_EXPOSURE'],
    ['margin', 'evaluateMargin', [{ state: RiskState.UNKNOWN, isStale: false }], 'MARGIN_RISK_UNAVAILABLE'],
    ['margin', 'evaluateMargin', [{ state: RiskState.NORMAL, isStale: true }], 'MARGIN_RISK_UNAVAILABLE'],
    ['leverage', 'evaluateLeverage', [{ state: RiskState.NORMAL, isBreach: false, policyMaxLeverage: '5', grossLeverage: null }], 'LEVERAGE_RISK_UNAVAILABLE'],
    ['liquidation', 'evaluateLiquidationRisk', [{ state: RiskState.UNKNOWN, isCritical: false, isWarning: false }], 'LIQUIDATION_RISK_UNAVAILABLE'],
    ['drawdown', 'evaluateDrawdown', [{ state: RiskState.NORMAL, isBreach: false, thresholdPercent: '20', drawdownPercent: null }], 'DRAWDOWN_RISK_UNAVAILABLE'],
  ] as const)('%s incomplete data cannot authorize', async (component, method, value, code) => {
    const h = harness();
    const dependency = h[component] as unknown as Record<string, jest.Mock>;
    dependency[method].mockResolvedValueOnce(value);
    const decision = await h.service.evaluateUnifiedRisk(params);
    expect(decision.decision).toBe(RiskDecision.REVIEW_REQUIRED);
    expect(decision.ruleIds).toContain(code);
  });

  it('uses exact order-notional arithmetic rather than truncating a value just above the limit', async () => {
    const h = harness();
    Object.assign(h.policy.thresholds, { maxOrderNotional: '1.000000000000' });
    const decision = await h.service.evaluateUnifiedRisk({ ...params,
      orderIntent: { ...params.orderIntent, quantity: '1.000000000001', price: '1.000000000001' } });
    expect(decision.decision).toBe(RiskDecision.BLOCK);
    expect(decision.ruleIds).toContain('MAX_ORDER_NOTIONAL');
    expect(decision.details.find((detail) => detail.ruleId === 'MAX_ORDER_NOTIONAL')?.current)
      .toBe('1.000000000002000000000001');
  });

  it.each([
    [{ ...params.orderIntent, orderType: 'MARKET' as const, price: null }, 'market order'],
    [{ ...params.orderIntent, side: 'SELL' as const }, 'sell limit (price is a floor)'],
    [{ ...params.orderIntent, price: '0' }, 'zero price'],
  ])('requires review without a defensible price ceiling: %s (%s)', async (orderIntent, _description) => {
    const h = harness();
    const decision = await h.service.evaluateUnifiedRisk({ ...params, orderIntent });
    expect(decision.decision).toBe(RiskDecision.REVIEW_REQUIRED);
    expect(decision.ruleIds).toContain('ORDER_NOTIONAL_UNAVAILABLE');
  });

  it('includes committed open orders and the proposed order in projected gross and symbol limits', async () => {
    const h = harness();
    h.exposure.calculateExposure.mockResolvedValueOnce({ state: RiskState.NORMAL, grossExposure: '75', totalExposure: '95', valuationCurrency: 'USDT',
      symbolExposures: [{ symbol: 'BTC-USDT', grossNotional: '75', totalExposure: '95' }], staleSymbols: [], unknownPrices: [] });
    Object.assign(h.policy.thresholds, { maxGrossExposure: '100', maxSymbolExposure: '100' });
    const decision = await h.service.evaluateUnifiedRisk(params);
    expect(decision.decision).toBe(RiskDecision.BLOCK);
    expect(decision.ruleIds).toEqual(expect.arrayContaining(['MAX_GROSS_EXPOSURE', 'MAX_SYMBOL_EXPOSURE']));
  });

  it('cannot approve a non-atomic aggregate exposure projection even when it is below the ceiling', async () => {
    const h = harness();
    const decision = await h.service.evaluateUnifiedRisk(params);
    expect(decision.decision).toBe(RiskDecision.REVIEW_REQUIRED);
    expect(decision.ruleIds).toContain('EXPOSURE_RESERVATION_UNAVAILABLE');
    expect(h.exposure.calculateExposure).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1', candidateAccountId: 'account-1', candidateSymbol: 'BTC-USDT',
    }));
    expect(h.exposure.calculateExposure.mock.calls[0][0]).not.toHaveProperty('accountId');
  });

  it.each(['missing', 'mismatched-source', 'mismatched-quote'] as const)('never compares monetary limits with %s currency evidence', async (kind) => {
    const h = harness();
    Object.assign(h.policy.thresholds, { maxOrderNotional: '1' });
    if (kind === 'missing') Object.assign(h.policy.thresholds, { notionalCurrency: null });
    if (kind === 'mismatched-source') h.policy.sourcePolicies = [{ thresholds: { ...h.policy.thresholds, notionalCurrency: 'USD' } }];
    if (kind === 'mismatched-quote') h.exposure.calculateExposure.mockResolvedValueOnce({
      state: RiskState.NORMAL, grossExposure: '0', totalExposure: '0', valuationCurrency: 'USD', symbolExposures: [], staleSymbols: [], unknownPrices: [],
    });
    const decision = await h.service.evaluateUnifiedRisk(params);
    expect(decision.decision).toBe(RiskDecision.REVIEW_REQUIRED);
    expect(decision.ruleIds).not.toContain('MAX_ORDER_NOTIONAL');
    expect(decision.ruleIds).toContain(kind === 'mismatched-quote' ? 'ORDER_CURRENCY_UNAVAILABLE' : 'POLICY_CURRENCY_UNAVAILABLE');
  });

  it('projects the candidate against the specific account cap and requires an account', async () => {
    const h = harness();
    Object.assign(h.policy.thresholds, { maxAccountExposure: '100' });
    h.exposure.calculateExposure.mockResolvedValueOnce({ state: RiskState.NORMAL, grossExposure: '500', totalExposure: '500',
      valuationCurrency: 'USDT', symbolExposures: [], staleSymbols: [], unknownPrices: [] });
    h.exposure.calculateExposure.mockResolvedValueOnce({ state: RiskState.NORMAL, grossExposure: '95', totalExposure: '95',
      valuationCurrency: 'USDT', symbolExposures: [], staleSymbols: [], unknownPrices: [] });
    const decision = await h.service.evaluateUnifiedRisk(params);
    expect(decision.decision).toBe(RiskDecision.BLOCK);
    expect(decision.details.find((d) => d.ruleId === 'MAX_ACCOUNT_EXPOSURE')?.current).toBe('105');
    expect(h.exposure.calculateExposure.mock.calls[1][0]).toMatchObject({ tenantId: 'tenant-1', accountId: 'account-1' });
    const missing = harness(); Object.assign(missing.policy.thresholds, { maxAccountExposure: '100' });
    const unknown = await missing.service.evaluateUnifiedRisk({ ...params, accountId: undefined });
    expect(unknown.decision).toBe(RiskDecision.REVIEW_REQUIRED);
    expect(unknown.ruleIds).toContain('ACCOUNT_EXPOSURE_UNAVAILABLE');
  });

  it('does not approve a known-normal exposure result with missing prices', async () => {
    const h = harness();
    h.exposure.calculateExposure.mockResolvedValueOnce({ state: RiskState.NORMAL, grossExposure: '0', totalExposure: '0',
      symbolExposures: [], staleSymbols: [], unknownPrices: ['BTC-USDT'] });
    const decision = await h.service.evaluateUnifiedRisk(params);
    expect(decision.decision).toBe(RiskDecision.REVIEW_REQUIRED);
    expect(decision.ruleIds).toContain('EXPOSURE_PRICE_UNAVAILABLE');
  });

  it('enforces the configured intraday threshold instead of ignoring it', async () => {
    const h = harness();
    Object.assign(h.policy.thresholds, { maxIntradayDrawdownPercent: '5' });
    h.drawdown.evaluateDrawdown.mockResolvedValueOnce([{ state: RiskState.NORMAL, isBreach: false,
      thresholdPercent: null, intradayDrawdownPercent: '5.1', scope: 'TENANT', scopeId: 'account-1', policyVersion: 'policy-v1' }]);
    const decision = await h.service.evaluateUnifiedRisk(params);
    expect(decision.decision).toBe(RiskDecision.BLOCK);
    expect(decision.ruleIds).toContain('MAX_INTRADAY_DRAWDOWN');
  });

  it('still allows when every supplied critical check is known and clear and no aggregate reservation is required', async () => {
    const h = harness();
    Object.assign(h.policy.thresholds, { maxGrossExposure: null, maxSymbolExposure: null, maxPositionNotional: null });
    const decision = await h.service.evaluateUnifiedRisk(params);
    expect(decision.decision).toBe(RiskDecision.ALLOW);
    expect(decision.ruleIds).toEqual([]);
  });

  it('does not convert a real block into review when another check fails', async () => {
    const h = harness();
    h.kill.isEngaged.mockRejectedValueOnce(new Error('private backend detail'));
    h.margin.evaluateMargin.mockResolvedValueOnce([{ state: RiskState.BLOCKED, ruleId: 'MARGIN_LIMIT',
      policyVersion: 'policy-v1', marginUtilizationPercent: '100', severity: 'CRITICAL', reason: 'Limit reached' }]);
    const decision = await h.service.evaluateUnifiedRisk(params);
    expect(decision.decision).toBe(RiskDecision.BLOCK);
    expect(decision.ruleIds).toEqual(expect.arrayContaining(['MARGIN_LIMIT', 'KILL_SWITCH_UNAVAILABLE']));
    expect(h.events.emitThresholdBreached).toHaveBeenCalledTimes(1);
  });
});
