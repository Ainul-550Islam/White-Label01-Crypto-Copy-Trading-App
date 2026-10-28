import { OrderIntentService } from './order-intent.service';
import { OrderRoutingService } from './order-routing.service';
import { OrderReplaceService } from './order-replace.service';
import { OrderIntentState } from './oms.types';

const tenantId = 'tenant-1';
const accountId = 'account-1';
const intentId = 'intent-1';
const risk = (decision: string) => ({
  id: 'risk-1', decision, policyVersion: 'v1', blockingReasons: [], ruleIds: [],
});
const parameters = {
  tenantId, accountId, symbol: 'BTC-USDT', side: 'BUY', orderType: 'LIMIT',
  quantity: '0.1', price: '50000', environment: 'PAPER', source: 'MANUAL', userId: 'user-1',
};
const symbol = {
  id: 'symbol-1', symbol: 'BTC-USDT', baseAsset: 'BTC', quoteAsset: 'USDT', marketType: 'SPOT',
  priceTick: '0.01', quantityStep: '0.0001', minQuantity: '0.0001', maxQuantity: '100', minNotional: '10',
  isTradeable: true, pricePrecision: 2, quantityPrecision: 4,
  exchange: { id: 'exchange-1', venue: 'BINANCE', isEnabled: true, tradingEnabled: true },
};

function intentHarness(result: unknown) {
  const evaluateUnifiedRisk = jest.fn(async () => result);
  const prisma = {
    tradingAccount: {
      findFirst: jest.fn(async () => ({ id: accountId, userId: 'user-1', exchangeId: 'exchange-1', marketType: 'SPOT', status: 'ACTIVE', liveTradingEnabled: true })),
      findUnique: jest.fn(async () => ({ id: accountId, userId: 'user-1', exchangeId: 'exchange-1', marketType: 'SPOT', status: 'ACTIVE', liveTradingEnabled: true })),
    },
    tradingSymbol: { findFirst: jest.fn(async () => symbol) },
    complianceScreeningRequest: { findFirst: jest.fn(async () => null) },
    securityThreatSignal: { findFirst: jest.fn(async () => null) },
    withTenantRls: jest.fn(async (_tenant: string, run: (tx: unknown) => Promise<unknown>): Promise<unknown> => run(prisma)),
  };
  const tx = {
    $executeRaw: jest.fn(async () => 1),
    omsOrderIntent: { create: jest.fn(async () => ({ id: intentId, state: 'CREATED' })) },
    complianceScreeningRequest: prisma.complianceScreeningRequest,
    securityThreatSignal: prisma.securityThreatSignal,
  };
  const limits = { persistOrderIntentWithLimits: jest.fn(async ({ persist }: { persist: (tx: unknown) => Promise<unknown> }) => persist(tx)) };
  const outbox = { append: jest.fn(async () => undefined) };
  const service = new OrderIntentService(prisma as never, { evaluateUnifiedRisk } as never, limits as never, outbox as never);
  return { service, evaluateUnifiedRisk, limits, tx, outbox, prisma };
}

function routingHarness(result: unknown) {
  const evaluateUnifiedRisk = jest.fn(async () => result);
  const intent = { ...parameters, id: intentId, state: OrderIntentState.VALIDATING, clientOrderId: 'client-1', metadata: {}, timeInForce: 'GTC' };
  const complianceScreeningRequest = { findFirst: jest.fn(async () => null) };
  const tradingAccount = { findFirst: jest.fn(async () => ({ userId: 'user-1' as string | null, exchangeId: 'exchange-1', marketType: 'SPOT' })) };
  const prisma = {
    omsOrderIntent: { findFirst: jest.fn(async () => intent) },
    complianceScreeningRequest,
    tradingSymbol: { findFirst: jest.fn(async () => symbol) },
    order: { findFirst: jest.fn(async () => null), create: jest.fn(async () => ({ id: 'order-1' })), update: jest.fn() },
    position: { findMany: jest.fn(async () => []) },
    tradingAccount,
    withTenantRls: jest.fn(async (_tenant: string, run: (tx: unknown) => Promise<unknown>): Promise<unknown> => run(prisma)),
  };
  const lifecycle = { transition: jest.fn(async (_input: { toState: string }) => undefined) };
  const routing = { route: jest.fn(async () => ({ venue: 'BINANCE' })) };
  const queue = { enqueueOrThrow: jest.fn(async () => 'job-1') };
  const service = new OrderRoutingService(prisma as never, {} as never, lifecycle as never,
    { evaluateUnifiedRisk } as never, routing as never, {} as never, {} as never, queue as never);
  return { service, evaluateUnifiedRisk, prisma, lifecycle, routing, queue };
}

function replacementHarness(result: unknown) {
  const evaluateUnifiedRisk = jest.fn(async () => result);
  const intent = { ...parameters, id: intentId, state: OrderIntentState.ACKNOWLEDGED, filledQuantity: '0', metadata: {} };
  const prisma = {
    omsOrderIntent: { findFirst: jest.fn(async () => intent), update: jest.fn(async () => ({})) },
    tradingSymbol: { findFirst: jest.fn(async () => symbol) },
  };
  const lifecycle = { transition: jest.fn(async () => undefined) };
  const intents = { createIntent: jest.fn(async () => ({ id: 'replacement-1', metadata: {} })) };
  const service = new OrderReplaceService(prisma as never, lifecycle as never, intents as never,
    { evaluateUnifiedRisk } as never, {} as never);
  return { service, evaluateUnifiedRisk, lifecycle, intents, prisma };
}

const deniedOutcomes = ['BLOCK', 'KILL_SWITCH_REQUIRED', 'REVIEW_REQUIRED', 'REDUCE', 'PAUSE', 'STOP_COPY', 'FUTURE_UNKNOWN'];
describe.each(deniedOutcomes)('risk decision %s is not permission to trade unchanged', (decision) => {
  it('does not create or reserve an intent', async () => {
    const h = intentHarness(risk(decision));
    await expect(h.service.createIntent(parameters as never)).rejects.toThrow('Risk evaluation did not authorize');
    expect(h.limits.persistOrderIntentWithLimits).not.toHaveBeenCalled();
    expect(h.tx.omsOrderIntent.create).not.toHaveBeenCalled();
    expect(h.outbox.append).not.toHaveBeenCalled();
  });
  it('rejects routing before venue, canonical order, and queue', async () => {
    const h = routingHarness(risk(decision));
    await expect(h.service.routeIntent({ tenantId, intentId })).rejects.toThrow('Risk evaluation did not authorize');
    expect(h.lifecycle.transition).toHaveBeenCalledWith(expect.objectContaining({
      tenantId, intentId, toState: OrderIntentState.REJECTED, source: 'RISK', policyVersion: 'v1',
    }));
    expect(h.routing.route).not.toHaveBeenCalled();
    expect(h.prisma.order.create).not.toHaveBeenCalled();
    expect(h.queue.enqueueOrThrow).not.toHaveBeenCalled();
  });
  it('leaves the original order untouched instead of issuing a replacement', async () => {
    const h = replacementHarness(risk(decision));
    await expect(h.service.requestReplace({ tenantId, intentId, newQuantity: '0.2', reason: 'test' })).rejects.toThrow('Risk evaluation did not authorize');
    expect(h.intents.createIntent).not.toHaveBeenCalled();
    expect(h.lifecycle.transition).not.toHaveBeenCalled();
    expect(h.prisma.omsOrderIntent.update).not.toHaveBeenCalled();
  });
});

describe('risk admission fails closed when evidence is unavailable', () => {
  it.each(['PAPER', 'LIVE'])('does not create a %s intent when evaluation throws', async (environment) => {
    const h = intentHarness(null);
    h.evaluateUnifiedRisk.mockRejectedValueOnce(new Error('private backend detail'));
    await expect(h.service.createIntent({ ...parameters, environment } as never)).rejects.toThrow('Risk evaluation is unavailable; the order was not admitted.');
    expect(h.limits.persistOrderIntentWithLimits).not.toHaveBeenCalled();
  });
  it('does not route or expose the underlying evaluation error', async () => {
    const h = routingHarness(null);
    h.evaluateUnifiedRisk.mockRejectedValueOnce(new Error('private backend detail'));
    await expect(h.service.routeIntent({ tenantId, intentId })).rejects.toThrow('Risk evaluation is unavailable; the order was not routed.');
    expect(h.lifecycle.transition).not.toHaveBeenCalled();
    expect(h.routing.route).not.toHaveBeenCalled();
    expect(h.queue.enqueueOrThrow).not.toHaveBeenCalled();
  });
  it('does not replace or expose the underlying evaluation error', async () => {
    const h = replacementHarness(null);
    h.evaluateUnifiedRisk.mockRejectedValueOnce(new Error('private backend detail'));
    await expect(h.service.requestReplace({ tenantId, intentId, newQuantity: '0.2', reason: 'test' })).rejects.toThrow('Risk evaluation is unavailable; the order was not replaced.');
    expect(h.intents.createIntent).not.toHaveBeenCalled();
    expect(h.lifecycle.transition).not.toHaveBeenCalled();
  });
  it('treats an empty result as non-authorizing at all three boundaries', async () => {
    const create = intentHarness(null), route = routingHarness(null), replace = replacementHarness(null);
    await expect(create.service.createIntent(parameters as never)).rejects.toThrow('Risk evaluation did not authorize');
    await expect(route.service.routeIntent({ tenantId, intentId })).rejects.toThrow('Risk evaluation did not authorize');
    await expect(replace.service.requestReplace({ tenantId, intentId, reason: 'test' })).rejects.toThrow('Risk evaluation did not authorize');
    expect(create.limits.persistOrderIntentWithLimits).not.toHaveBeenCalled();
    expect(route.queue.enqueueOrThrow).not.toHaveBeenCalled();
    expect(replace.intents.createIntent).not.toHaveBeenCalled();
  });
});

describe('compliance status is an independent routing gate', () => {
  it.each([
    { id: 'screening-1', status: 'REVIEW_REQUIRED', decision: 'REVIEW' },
    { id: 'screening-2', status: 'BLOCKED', decision: 'ALLOW' },
  ])('never routes a blocking or review-required screening: $status', async (screening) => {
    const h = routingHarness(risk('ALLOW'));
    h.prisma.complianceScreeningRequest.findFirst.mockResolvedValueOnce(screening as never);
    await expect(h.service.routeIntent({ tenantId, intentId, userId: 'user-1' }))
      .rejects.toThrow('Compliance screening does not authorize routing.');
    expect(h.lifecycle.transition).toHaveBeenCalledWith(expect.objectContaining({ source: 'COMPLIANCE', toState: OrderIntentState.REJECTED }));
    expect(h.routing.route).not.toHaveBeenCalled();
    expect(h.prisma.order.create).not.toHaveBeenCalled();
    expect(h.queue.enqueueOrThrow).not.toHaveBeenCalled();
  });
});

describe('account owner screening at routing', () => {
  it('binds final risk and compliance to the real owner and actor', async () => {
    const h = routingHarness(risk('ALLOW'));
    h.prisma.tradingAccount.findFirst.mockResolvedValueOnce({ userId: 'owner-2', exchangeId: 'exchange-1', marketType: 'SPOT' });
    h.prisma.complianceScreeningRequest.findFirst.mockResolvedValueOnce({ id: 'owner-block' } as never);
    await expect(h.service.routeIntent({ tenantId, intentId, userId: 'user-1' })).rejects.toThrow('Compliance screening does not authorize routing.');
    expect(h.evaluateUnifiedRisk).toHaveBeenCalledWith(expect.objectContaining({ expectedAccountOwnerId: 'owner-2', userId: 'user-1' }));
    expect(h.prisma.complianceScreeningRequest.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantId, userId: { in: ['user-1', 'owner-2'] } }),
    }));
    expect(h.queue.enqueueOrThrow).not.toHaveBeenCalled();
  });

  it('refuses routing when the owner record cannot be read', async () => {
    const h = routingHarness(risk('ALLOW'));
    h.prisma.tradingAccount.findFirst.mockRejectedValueOnce(new Error('private data'));
    await expect(h.service.routeIntent({ tenantId, intentId, userId: 'user-1' }))
      .rejects.toThrow('Trading account ownership is unavailable; the order was not routed.');
    expect(h.evaluateUnifiedRisk).not.toHaveBeenCalled();
    expect(h.queue.enqueueOrThrow).not.toHaveBeenCalled();
  });
});

describe('owner and operator screening at intent reservation', () => {
  it('checks both identities inside the reservation transaction, scoped to the tenant', async () => {
    const h = intentHarness(risk('ALLOW'));
    h.prisma.tradingAccount.findFirst.mockResolvedValueOnce({ id: accountId, userId: 'owner-2', exchangeId: 'exchange-1', marketType: 'SPOT',
      status: 'ACTIVE', liveTradingEnabled: true });
    await h.service.createIntent(parameters as never);
    expect(h.evaluateUnifiedRisk).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', expectedAccountOwnerId: 'owner-2' }));
    expect(h.limits.persistOrderIntentWithLimits).toHaveBeenCalledWith(expect.objectContaining({ expectedOwnerUserId: 'owner-2' }));
    expect(h.tx.complianceScreeningRequest.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantId, userId: { in: ['user-1', 'owner-2'] } }),
    }));
    expect(h.tx.securityThreatSignal.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantId, userId: { in: ['user-1', 'owner-2'] } }),
    }));
    expect(h.prisma.tradingSymbol.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantId, exchangeId: 'exchange-1', marketType: 'SPOT' }),
    }));
  });

  it.each(['complianceScreeningRequest', 'securityThreatSignal'] as const)(
    'rejects a %s block even if the earlier risk decision allowed', async (source) => {
      const h = intentHarness(risk('ALLOW'));
      h.tx[source].findFirst.mockResolvedValueOnce({ id: 'block' } as never);
      await expect(h.service.createIntent(parameters as never)).rejects.toThrow('does not authorize this order');
      expect(h.tx.omsOrderIntent.create).not.toHaveBeenCalled();
      expect(h.outbox.append).not.toHaveBeenCalled();
    },
  );
});

describe('tenant-scoped routing and canonical order identity', () => {
  it('does not fall back to an unrelated order when the tenant intent read fails', async () => {
    const h = routingHarness(risk('ALLOW'));
    h.prisma.omsOrderIntent.findFirst.mockRejectedValueOnce(new Error('private backend detail'));
    await expect(h.service.routeIntent({ tenantId, intentId })).rejects.toThrow('Order intent is unavailable; the order was not routed.');
    expect(h.prisma.order.findFirst).not.toHaveBeenCalled();
    expect(h.queue.enqueueOrThrow).not.toHaveBeenCalled();
  });

  it('does not enqueue a canonical order from a different risk decision or account', async () => {
    const h = routingHarness(risk('ALLOW'));
    h.prisma.order.findFirst.mockResolvedValueOnce({ id: 'other-order', tenantId, accountId: 'other-account', symbolId: symbol.id,
      symbol: parameters.symbol, side: parameters.side, orderType: parameters.orderType, timeInForce: 'GTC', strategyId: null,
      reduceOnly: false, isSimulated: true, riskDecisionId: 'other-risk', status: 'SUBMITTED', reconciliationState: 'IN_SYNC',
      quantity: '0.1', price: '50000' } as never);
    await expect(h.service.routeIntent({ tenantId, intentId })).rejects.toMatchObject({
      response: { code: 'CANONICAL_ORDER_CONFLICT' },
    });
    expect(h.prisma.order.create).not.toHaveBeenCalled();
    expect(h.queue.enqueueOrThrow).not.toHaveBeenCalled();
    expect(h.lifecycle.transition).toHaveBeenCalledWith(expect.objectContaining({ toState: OrderIntentState.RECONCILIATION_REQUIRED }));
  });
});

describe('an affirmative risk decision retains the real order paths', () => {
  it('reserves and creates the intent transactionally', async () => {
    const h = intentHarness(risk('ALLOW'));
    await expect(h.service.createIntent(parameters as never)).resolves.toMatchObject({ id: intentId });
    expect(h.limits.persistOrderIntentWithLimits).toHaveBeenCalledTimes(1);
    expect(h.tx.omsOrderIntent.create).toHaveBeenCalledTimes(1);
    expect(h.outbox.append).toHaveBeenCalledTimes(1);
  });
  it('routes and enqueues the paper order through the existing producer', async () => {
    const h = routingHarness(risk('ALLOW'));
    await expect(h.service.routeIntent({ tenantId, intentId })).resolves.toMatchObject({ canonicalOrderId: 'order-1', jobId: 'job-1' });
    expect(h.lifecycle.transition.mock.calls.map(([value]) => (value as { toState: string }).toState)).toEqual([
      OrderIntentState.APPROVED, OrderIntentState.SUBMITTED,
    ]);
    expect(h.routing.route).toHaveBeenCalledTimes(1);
    expect(h.prisma.tradingSymbol.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantId, symbol: 'BTC-USDT', exchangeId: 'exchange-1', marketType: 'SPOT' }),
    }));
    expect(h.prisma.order.create).toHaveBeenCalledTimes(1);
    expect(h.queue.enqueueOrThrow).toHaveBeenCalledTimes(1);
  });
  it('creates an approved replacement and records the transition', async () => {
    const h = replacementHarness(risk('ALLOW'));
    await expect(h.service.requestReplace({ tenantId, intentId, newQuantity: '0.2', reason: 'test' })).resolves.toMatchObject({ newIntentId: 'replacement-1' });
    expect(h.intents.createIntent).toHaveBeenCalledTimes(1);
    expect(h.lifecycle.transition).toHaveBeenCalledWith(expect.objectContaining({ toState: OrderIntentState.REPLACED }));
    expect(h.prisma.omsOrderIntent.update).toHaveBeenCalledTimes(1);
  });
});
