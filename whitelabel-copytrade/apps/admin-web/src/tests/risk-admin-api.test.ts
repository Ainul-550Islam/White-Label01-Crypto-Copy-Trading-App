import { riskAdminApi as api, riskRows } from '@/api/risk-admin-api';
import { apiClient } from '@/lib/api-client';

jest.mock('@/lib/api-client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

const key = 'risk-intent-1';
const opts = { idempotencyKey: key };
const managed = '/v1/risk-management';
const risk = '/v1/risk';

afterEach(() => jest.clearAllMocks());

describe('risk-management reads', () => {
  it('reads the dashboard for a scope and the caller-scoped views', () => {
    void api.getDashboard({ traderId: 't-1' });
    void api.getMyExposure();
    void api.getMyRiskAnalysis();

    expect(apiClient.get).toHaveBeenNthCalledWith(1, `${managed}/dashboard`, { searchParams: { traderId: 't-1' } });
    expect(apiClient.get).toHaveBeenNthCalledWith(2, `${managed}/my-exposure`);
    expect(apiClient.get).toHaveBeenNthCalledWith(3, `${managed}/my-risk-analysis`);
  });

  it('reads exposure, margin, leverage, liquidation and concentration', () => {
    void api.getExposure('a-1');
    void api.getAccountExposure('a/1');
    void api.getTraderExposure('t-1');
    void api.getPositionRisk({ accountId: 'a-1', symbol: 'BTC-USDT' });
    void api.getMargin('a-1');
    void api.getLeverage('a-1', 'BTC-USDT');
    void api.getLiquidation('a-1');
    void api.getConcentration('a-1');

    expect(apiClient.get).toHaveBeenNthCalledWith(1, `${managed}/exposure`, { searchParams: { accountId: 'a-1' } });
    expect(apiClient.get).toHaveBeenNthCalledWith(2, `${managed}/exposure/a%2F1`);
    expect(apiClient.get).toHaveBeenNthCalledWith(3, `${managed}/trader-exposure/t-1`);
    expect(apiClient.get).toHaveBeenNthCalledWith(4, `${managed}/position-risk`, { searchParams: { accountId: 'a-1', symbol: 'BTC-USDT' } });
    expect(apiClient.get).toHaveBeenNthCalledWith(5, `${managed}/margin/a-1`);
    expect(apiClient.get).toHaveBeenNthCalledWith(6, `${managed}/leverage/a-1`, { searchParams: { symbol: 'BTC-USDT' } });
    expect(apiClient.get).toHaveBeenNthCalledWith(7, `${managed}/liquidation/a-1`);
    expect(apiClient.get).toHaveBeenNthCalledWith(8, `${managed}/concentration`, { searchParams: { accountId: 'a-1' } });
  });

  it('reads drawdown, daily loss, correlation, VaR and stress', () => {
    void api.getDrawdown({ strategyId: 's-1' });
    void api.getDailyLoss('a-1');
    void api.getCorrelation();
    void api.getVar('a-1');
    void api.getStress('a-1');

    expect(apiClient.get).toHaveBeenNthCalledWith(1, `${managed}/drawdown`, { searchParams: { strategyId: 's-1' } });
    expect(apiClient.get).toHaveBeenNthCalledWith(2, `${managed}/daily-loss`, { searchParams: { accountId: 'a-1' } });
    expect(apiClient.get).toHaveBeenNthCalledWith(3, `${managed}/correlation`);
    expect(apiClient.get).toHaveBeenNthCalledWith(4, `${managed}/var`, { searchParams: { accountId: 'a-1' } });
    expect(apiClient.get).toHaveBeenNthCalledWith(5, `${managed}/stress`, { searchParams: { accountId: 'a-1' } });
  });

  it('runs a pre-trade risk check', () => {
    const input = { symbol: 'BTC-USDT', side: 'BUY', quantity: '1.5', orderType: 'MARKET', accountId: 'a-1' };
    void api.checkOrder(input, 'risk-check-key');

    expect(apiClient.post).toHaveBeenCalledWith(`${managed}/check`, input, { idempotencyKey: 'risk-check-key' });
  });
});

describe('policy', () => {
  it('reads policy, its history and writes a new version under a key', () => {
    void api.getPolicy({ strategyId: 's-1' });
    void api.getPolicyHistory({ scope: 'STRATEGY', scopeId: 's-1' });
    const input = { scope: 'ACCOUNT', scopeId: 'a-1', thresholds: { maxLeverage: 5 }, changeReason: 'Tighten leverage after review' };
    void api.upsertPolicy(input, key);

    expect(apiClient.get).toHaveBeenNthCalledWith(1, `${managed}/policy`, { searchParams: { strategyId: 's-1' } });
    expect(apiClient.get).toHaveBeenNthCalledWith(2, `${managed}/policy/history`, { searchParams: { scope: 'STRATEGY', scopeId: 's-1' } });
    expect(apiClient.post).toHaveBeenCalledWith(`${managed}/policy`, input, opts);
  });

  it('mints an INSTITUTIONAL_RISK_POLICY_UPDATE proof for the policy write', async () => {
    jest.mocked(apiClient.post).mockResolvedValueOnce({
      proofId: 'p', action: 'INSTITUTIONAL_RISK_POLICY_UPDATE', method: 'PASSWORD', expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    await api.requestPolicyProof('PASSWORD', 'secret', 'proof-key');

    expect(apiClient.post).toHaveBeenCalledWith(
      '/v1/auth/step-up/verify',
      { action: 'INSTITUTIONAL_RISK_POLICY_UPDATE', method: 'PASSWORD', password: 'secret' },
      { idempotencyKey: 'proof-key' },
    );
  });
});

describe('breakers and kill switches', () => {
  it('lists, triggers, acknowledges and clears breakers', () => {
    void api.listBreakers();
    void api.triggerBreaker({ scope: 'ACCOUNT', scopeId: 'a-1', triggerType: 'MANUAL', reason: 'Unexpected exposure' }, key);
    void api.acknowledgeBreaker('b/1', 'Acknowledged by on-call', key);
    void api.clearBreaker('b-1', 'Exposure verified and reduced', key);

    expect(apiClient.get).toHaveBeenCalledWith(`${managed}/breaker`);
    expect(apiClient.post).toHaveBeenNthCalledWith(1, `${managed}/breaker/trigger`, { scope: 'ACCOUNT', scopeId: 'a-1', triggerType: 'MANUAL', reason: 'Unexpected exposure' }, opts);
    expect(apiClient.post).toHaveBeenNthCalledWith(2, `${managed}/breaker/b%2F1/acknowledge`, { reason: 'Acknowledged by on-call' }, opts);
    expect(apiClient.post).toHaveBeenNthCalledWith(3, `${managed}/breaker/b-1/clear`, { reason: 'Exposure verified and reduced' }, opts);
  });

  it('lists, requests, acknowledges and clears kill switches', () => {
    void api.listKillSwitches();
    void api.requestKillSwitch({ scope: 'GLOBAL', reason: 'Market data outage' }, key);
    void api.acknowledgeKillSwitch('k-1', 'Seen', key);
    void api.clearKillSwitch('k-1', 'Data restored', key);

    expect(apiClient.get).toHaveBeenCalledWith(`${managed}/kill-switch`);
    expect(apiClient.post).toHaveBeenNthCalledWith(1, `${managed}/kill-switch/request`, { scope: 'GLOBAL', reason: 'Market data outage' }, opts);
    expect(apiClient.post).toHaveBeenNthCalledWith(2, `${managed}/kill-switch/k-1/acknowledge`, { reason: 'Seen' }, opts);
    expect(apiClient.post).toHaveBeenNthCalledWith(3, `${managed}/kill-switch/k-1/clear`, { reason: 'Data restored' }, opts);
  });

  it('carries the typed confirmation phrase and a long reason on a risk clear', () => {
    const input = { confirm: 'CLEAR RISK PROTECTION', reason: 'Exposure reduced and verified against the venue' };
    void api.clearSwitch('k-1', input, key);

    expect(apiClient.post).toHaveBeenCalledWith(`${risk}/kill-switches/k-1/clear`, input, opts);
  });

  it('engages and acknowledges a risk switch on the risk controller', () => {
    void api.engageSwitch({ scope: 'ACCOUNT', target: 'a-1', reason: 'Manual halt for investigation' }, key);
    void api.acknowledgeSwitch('k-1', 'On-call acknowledged', key);

    expect(apiClient.post).toHaveBeenNthCalledWith(1, `${risk}/kill-switches/engage`, { scope: 'ACCOUNT', target: 'a-1', reason: 'Manual halt for investigation' }, opts);
    expect(apiClient.post).toHaveBeenNthCalledWith(2, `${risk}/kill-switches/k-1/acknowledge`, { reason: 'On-call acknowledged' }, opts);
  });
});

describe('risk controller reads', () => {
  it('reads status, events, protections and switches', () => {
    void api.getStatus();
    void api.getEvents({ severity: 'CRITICAL' });
    void api.listProtections({ includeCleared: true });
    void api.listSwitches({ engagedOnly: true });

    expect(apiClient.get).toHaveBeenNthCalledWith(1, `${risk}/status`);
    expect(apiClient.get).toHaveBeenNthCalledWith(2, `${risk}/events`, { searchParams: { severity: 'CRITICAL' } });
    expect(apiClient.get).toHaveBeenNthCalledWith(3, `${risk}/protections`, { searchParams: { includeCleared: true } });
    expect(apiClient.get).toHaveBeenNthCalledWith(4, `${risk}/kill-switches`, { searchParams: { engagedOnly: true } });
  });

  it('reads the per-account risk views', () => {
    void api.getAccountLimits('a-1');
    void api.getAccountExposureProjection('a-1');
    void api.listAccountSnapshots('a-1');
    void api.getDailyPnl('a-1', '2026-10-29');
    void api.getAccountSummary('a-1');
    void api.getStrategySummary('s-1');

    expect(apiClient.get).toHaveBeenNthCalledWith(1, `${risk}/accounts/a-1/limits`);
    expect(apiClient.get).toHaveBeenNthCalledWith(2, `${risk}/accounts/a-1/exposure`);
    expect(apiClient.get).toHaveBeenNthCalledWith(3, `${risk}/accounts/a-1/snapshots`);
    expect(apiClient.get).toHaveBeenNthCalledWith(4, `${risk}/accounts/a-1/daily-pnl`, { searchParams: { day: '2026-10-29' } });
    expect(apiClient.get).toHaveBeenNthCalledWith(5, `${risk}/accounts/a-1/summary`);
    expect(apiClient.get).toHaveBeenNthCalledWith(6, `${risk}/strategies/s-1/summary`);
  });

  it('writes a new limit version and rolls back to a prior one', () => {
    const update = { entries: [], changeReason: 'Tighten limits' };
    void api.updateAccountLimits('a-1', update, key);
    void api.rollbackAccountLimits('a-1', { toVersion: 3, changeReason: 'Revert bad config', confirm: 'WIDEN RISK LIMITS' }, key);

    expect(apiClient.post).toHaveBeenNthCalledWith(1, `${risk}/accounts/a-1/limits`, update, opts);
    expect(apiClient.post).toHaveBeenNthCalledWith(2, `${risk}/accounts/a-1/limits/rollback`, { toVersion: 3, changeReason: 'Revert bad config', confirm: 'WIDEN RISK LIMITS' }, opts);
  });
});

describe('liquidation alerts and position limits', () => {
  it('reads liquidation alerts from their own controller path', () => {
    void api.listLiquidationAlerts();

    expect(apiClient.get).toHaveBeenCalledWith('/v1/risk/liquidation-alerts');
  });

  it('reads and updates the caller position limits under a key', () => {
    void api.getMyPositionLimits();
    void api.updateMyPositionLimits({ maxConcurrentPositions: 5, maxOpenOrders: 20 }, key);

    expect(apiClient.get).toHaveBeenCalledWith(`${managed}/my-position-limits`);
    expect(apiClient.put).toHaveBeenCalledWith(`${managed}/my-position-limits`, { maxConcurrentPositions: 5, maxOpenOrders: 20 }, opts);
  });

  it('mints a USER_POSITION_LIMIT_UPDATE proof, and rejects a proof minted for another action', async () => {
    jest.mocked(apiClient.post).mockResolvedValueOnce({
      proofId: 'p', action: 'USER_POSITION_LIMIT_UPDATE', method: 'TOTP', expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    await api.requestPositionLimitProof('TOTP', '123456', 'proof-key');
    expect(apiClient.post).toHaveBeenCalledWith(
      '/v1/auth/step-up/verify',
      { action: 'USER_POSITION_LIMIT_UPDATE', method: 'TOTP', code: '123456' },
      { idempotencyKey: 'proof-key' },
    );

    jest.mocked(apiClient.post).mockResolvedValueOnce({
      proofId: 'p', action: 'ORDER_RECOVERY', method: 'TOTP', expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    await expect(api.requestPositionLimitProof('TOTP', '123456', 'proof-key')).rejects.toThrow('Invalid verification response');
  });
});

describe('row normalisation', () => {
  it('accepts a bare array or a data envelope', () => {
    expect(riskRows([1, 2])).toEqual([1, 2]);
    expect(riskRows({ data: [1] })).toEqual([1]);
    expect(riskRows(null)).toEqual([]);
  });
});
