/**
 * Phase 3: the worker's validation of SUBMIT_ORDER job data.
 *
 * The worker forwards this payload into the execution engine, so every field
 * that reaches the engine is checked here first - and everything that cannot
 * succeed (LIVE, a stop order, an exponent-notation quantity) is refused as a
 * TradeExecutionPayloadError, which the processor turns into a terminal,
 * visible failure instead of a retry loop.
 */

import { JOB_NAMES } from '@wlct/config';

import {
  TRADE_EXECUTION_COMMANDS,
  TradeExecutionPayloadError,
  isSubmitOrderPayload,
  parseTradeExecutionPayload,
  type SubmitOrderPayload,
} from './worker.types';

function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tenantId: 'tenant-a',
    accountId: 'acct-1',
    orderId: 'ord-1',
    clientOrderId: 'oms0123456789abcdef0123456789abcdef',
    symbol: 'BTC-USDT',
    side: 'SELL',
    orderType: 'LIMIT',
    quantity: '0.50000',
    price: '50000.10',
    timeInForce: 'IOC',
    reduceOnly: true,
    strategyId: 'strat-1',
    riskDecisionId: 'risk-1',
    environment: 'PAPER',
    specification: {
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      marketType: 'SPOT',
      priceTick: '0.01',
      quantityStep: '0.00001',
      minQuantity: '0.00001',
      maxQuantity: null,
      minNotional: '10',
      isTradeable: true,
      pricePrecision: 2,
      quantityPrecision: 5,
    },
    exposure: {
      positionQuantity: '-0.25',
      symbolExposureNotional: '12500',
      accountExposureNotional: '20000',
      complete: true,
    },
    metadata: { copyExecutionId: 'copy-1', source: 'COPY_TRADING' },
    omsIntentId: 'intent-1',
    requestedAt: '2026-09-28T00:00:00.000Z',
    ...overrides,
  };
}

function parse(data: unknown): SubmitOrderPayload {
  const parsed = parseTradeExecutionPayload(JOB_NAMES.SUBMIT_ORDER, data);
  if (!isSubmitOrderPayload(parsed)) throw new Error('not a submit payload');
  return parsed;
}

describe('SUBMIT_ORDER payload validation (Phase 3)', () => {
  it('is a registered trade-execution command', () => {
    expect(JOB_NAMES.SUBMIT_ORDER).toBe('submit-order');
    expect(TRADE_EXECUTION_COMMANDS.has(JOB_NAMES.SUBMIT_ORDER)).toBe(true);
  });

  it('accepts a complete PAPER limit order and keeps every field verbatim', () => {
    const payload = parse(body());
    expect(payload).toMatchObject({
      orderId: 'ord-1',
      side: 'SELL',
      orderType: 'LIMIT',
      quantity: '0.50000',
      price: '50000.10',
      timeInForce: 'IOC',
      reduceOnly: true,
      strategyId: 'strat-1',
      riskDecisionId: 'risk-1',
      environment: 'PAPER',
      omsIntentId: 'intent-1',
    });
    expect(payload.exposure.positionQuantity).toBe('-0.25');
    expect(payload.specification.maxQuantity).toBeNull();
    expect(payload.metadata).toEqual({ copyExecutionId: 'copy-1', source: 'COPY_TRADING' });
  });

  it('defaults timeInForce and reduceOnly and accepts a market order without price', () => {
    const data = body({ orderType: 'MARKET', price: null });
    delete data.timeInForce;
    delete data.reduceOnly;
    const payload = parse(data);
    expect(payload.price).toBeNull();
    expect(payload.timeInForce).toBe('GTC');
    expect(payload.reduceOnly).toBe(false);
  });

  it('a non-submit payload is not mistaken for one by the type guard', () => {
    const cancel = parseTradeExecutionPayload(JOB_NAMES.CANCEL_ORDER, {
      tenantId: 'tenant-a',
      accountId: 'acct-1',
      orderId: 'ord-1',
      clientOrderId: 'c-1',
      symbol: 'BTCUSDT',
    });
    expect(isSubmitOrderPayload(cancel)).toBe(false);
  });

  const refusals: Array<[string, Record<string, unknown>]> = [
    ['LIVE environment', { environment: 'LIVE' }],
    ['missing environment', { environment: undefined }],
    ['stop order', { orderType: 'STOP' }],
    ['bad side', { side: 'HOLD' }],
    ['limit without price', { price: null }],
    ['zero quantity', { quantity: '0.000' }],
    ['exponent quantity', { quantity: '1e-3' }],
    ['negative quantity', { quantity: '-1' }],
    ['float quantity', { quantity: 0.5 }],
    ['client id too long for the engine', { clientOrderId: 'oms-00000000-0000-4000-8000-000000000001' }],
    ['client id with a colon', { clientOrderId: 'oms:1' }],
    ['symbol with structure', { symbol: 'BTC USDT' }],
    ['missing risk decision', { riskDecisionId: undefined }],
    ['DAY time in force', { timeInForce: 'DAY' }],
    ['reduceOnly as string', { reduceOnly: 'yes' }],
    ['specification missing', { specification: undefined }],
    ['exposure missing', { exposure: undefined }],
    ['exposure.complete missing', { exposure: { positionQuantity: '0', symbolExposureNotional: '0', accountExposureNotional: '0' } }],
    ['negative notional', { exposure: { positionQuantity: '0', symbolExposureNotional: '-1', accountExposureNotional: '0', complete: true } }],
    ['metadata with a non-string value', { metadata: { a: 1 } }],
    ['metadata with a structured key', { metadata: { 'a.b': 'x' } }],
  ];

  it.each(refusals)('refuses %s', (_label, patch) => {
    const data = body(patch);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete data[key];
    }
    expect(() => parse(data)).toThrow(TradeExecutionPayloadError);
  });

  it('refuses a bad specification field', () => {
    const spec = { ...(body().specification as Record<string, unknown>), pricePrecision: 19 };
    expect(() => parse(body({ specification: spec }))).toThrow(TradeExecutionPayloadError);
    const spec2 = { ...(body().specification as Record<string, unknown>), marketType: 'OPTIONS' };
    expect(() => parse(body({ specification: spec2 }))).toThrow(TradeExecutionPayloadError);
  });

  it('refuses more than 16 metadata entries', () => {
    const metadata: Record<string, string> = {};
    for (let i = 0; i < 17; i += 1) metadata[`k${i}`] = 'v';
    expect(() => parse(body({ metadata }))).toThrow(TradeExecutionPayloadError);
  });
});
