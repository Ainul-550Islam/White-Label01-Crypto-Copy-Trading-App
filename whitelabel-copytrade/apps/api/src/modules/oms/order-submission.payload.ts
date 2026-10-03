/**
 * Phase 3 — the OMS side of the SUBMIT_ORDER contract, as pure functions.
 *
 * The worker validates this payload again (worker.types.ts parseSubmitOrder)
 * and the engine validates it a third time (schemas.SubmitOrderRequest): the
 * producer, the consumer and the executor each refuse a malformed order on
 * their own authority. These helpers exist so the producer's half is testable
 * without a database or a queue.
 */

import { Prisma } from '@prisma/client';

export const SUBMIT_ORDER_JOB_PREFIX = 'oms-submit-';

/** BullMQ refuses custom job ids containing a single ':' ("Custom Id cannot
 * contain :"), which is why the previous `oms-submit:${id}` enqueue could
 * never succeed. A dash keeps the id deterministic (one job per order,
 * whatever the retry count) and legal. */
export function submitOrderJobId(clientOrderId: string): string {
  return `${SUBMIT_ORDER_JOB_PREFIX}${clientOrderId}`;
}

export function clientOrderIdFromJobId(jobId: string | null | undefined): string | null {
  if (typeof jobId !== 'string' || !jobId.startsWith(SUBMIT_ORDER_JOB_PREFIX)) return null;
  const id = jobId.slice(SUBMIT_ORDER_JOB_PREFIX.length);
  return id.length > 0 ? id : null;
}

export interface SymbolRuleSource {
  baseAsset: string;
  quoteAsset: string;
  marketType: string;
  priceTick: Prisma.Decimal | string | number;
  quantityStep: Prisma.Decimal | string | number;
  minQuantity: Prisma.Decimal | string | number;
  maxQuantity: Prisma.Decimal | string | number | null;
  minNotional: Prisma.Decimal | string | number;
  isTradeable: boolean;
  pricePrecision: number;
  quantityPrecision: number;
}

export interface SubmitSpecification {
  baseAsset: string;
  quoteAsset: string;
  marketType: 'SPOT' | 'MARGIN' | 'FUTURES_USDT' | 'FUTURES_COIN';
  priceTick: string;
  quantityStep: string;
  minQuantity: string;
  maxQuantity: string | null;
  minNotional: string;
  isTradeable: boolean;
  pricePrecision: number;
  quantityPrecision: number;
}

const MARKET_TYPES = new Set(['SPOT', 'MARGIN', 'FUTURES_USDT', 'FUTURES_COIN']);

/** Plain (non-exponent) decimal string - the only spelling the worker and the
 * engine accept for money. */
export function plainDecimal(value: Prisma.Decimal | string | number): string {
  return new Prisma.Decimal(value).toFixed();
}

export function buildSubmitSpecification(symbol: SymbolRuleSource): SubmitSpecification {
  if (!MARKET_TYPES.has(symbol.marketType)) {
    throw new Error(`Unsupported market type ${symbol.marketType} for submission`);
  }
  return {
    baseAsset: symbol.baseAsset,
    quoteAsset: symbol.quoteAsset,
    marketType: symbol.marketType as SubmitSpecification['marketType'],
    priceTick: plainDecimal(symbol.priceTick),
    quantityStep: plainDecimal(symbol.quantityStep),
    minQuantity: plainDecimal(symbol.minQuantity),
    maxQuantity: symbol.maxQuantity === null || symbol.maxQuantity === undefined ? null : plainDecimal(symbol.maxQuantity),
    minNotional: plainDecimal(symbol.minNotional),
    isTradeable: symbol.isTradeable,
    pricePrecision: symbol.pricePrecision,
    quantityPrecision: symbol.quantityPrecision,
  };
}

export interface PositionSource {
  symbolId: string;
  quantity: Prisma.Decimal | string | number;
  markPrice: Prisma.Decimal | string | number | null;
}

export interface SubmitExposure {
  positionQuantity: string;
  symbolExposureNotional: string;
  accountExposureNotional: string;
  complete: boolean;
}

/**
 * Exposure from the canonical Position ledger. A non-flat position without a
 * mark price makes the picture INCOMPLETE - the engine then refuses the order
 * rather than evaluating limits against a number that silently left a
 * position out (the same law Position.unrealisedPnl documents: never default
 * an unknown to zero).
 */
export function computeSubmitExposure(positions: readonly PositionSource[], symbolId: string): SubmitExposure {
  let positionQuantity = new Prisma.Decimal(0);
  let symbolNotional = new Prisma.Decimal(0);
  let accountNotional = new Prisma.Decimal(0);
  let complete = true;
  for (const position of positions) {
    const quantity = new Prisma.Decimal(position.quantity);
    if (position.symbolId === symbolId) {
      positionQuantity = positionQuantity.plus(quantity);
    }
    if (quantity.isZero()) continue;
    if (position.markPrice === null || position.markPrice === undefined) {
      complete = false;
      continue;
    }
    const notional = quantity.abs().times(new Prisma.Decimal(position.markPrice));
    accountNotional = accountNotional.plus(notional);
    if (position.symbolId === symbolId) {
      symbolNotional = symbolNotional.plus(notional);
    }
  }
  return {
    positionQuantity: positionQuantity.toFixed(),
    symbolExposureNotional: symbolNotional.toFixed(),
    accountExposureNotional: accountNotional.toFixed(),
    complete,
  };
}

export interface SubmitOrderJobInput {
  tenantId: string;
  accountId: string;
  orderId: string;
  clientOrderId: string;
  symbol: string;
  side: string;
  orderType: string;
  quantity: Prisma.Decimal | string | number;
  price: Prisma.Decimal | string | number | null | undefined;
  timeInForce: string | null | undefined;
  reduceOnly: boolean | null | undefined;
  strategyId: string | null | undefined;
  riskDecisionId: string;
  environment: string;
  specification: SubmitSpecification;
  exposure: SubmitExposure;
  omsIntentId: string;
  metadata: Record<string, string>;
  requestedByUserId?: string | null;
}

export class SubmitOrderRefused extends Error {
  public constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'SubmitOrderRefused';
  }
}

/** Build the SUBMIT_ORDER job data, refusing what the submission path cannot
 * execute (LIVE, stop orders, a time-in-force the engine route does not take)
 * with a typed reason instead of enqueueing a job the worker would reject. */
export function buildSubmitOrderJob(input: SubmitOrderJobInput): Record<string, unknown> {
  if (input.environment !== 'PAPER') {
    throw new SubmitOrderRefused(
      'LIVE_SUBMISSION_NOT_WIRED',
      'The execution engine is simulated-only; LIVE orders are not submitted by this build',
    );
  }
  if (input.orderType !== 'MARKET' && input.orderType !== 'LIMIT') {
    throw new SubmitOrderRefused('ORDER_TYPE_NOT_SUPPORTED', `Order type ${input.orderType} is not supported by the submission path`);
  }
  if (input.side !== 'BUY' && input.side !== 'SELL') {
    throw new SubmitOrderRefused('SIDE_INVALID', `Side ${input.side} is not BUY or SELL`);
  }
  const timeInForce = input.timeInForce ?? 'GTC';
  if (!['GTC', 'IOC', 'FOK'].includes(timeInForce)) {
    throw new SubmitOrderRefused('TIME_IN_FORCE_NOT_SUPPORTED', `Time in force ${timeInForce} is not supported by the submission path`);
  }
  const price = input.price === null || input.price === undefined ? null : plainDecimal(input.price);
  if (input.orderType === 'LIMIT' && price === null) {
    throw new SubmitOrderRefused('PRICE_REQUIRED', 'LIMIT orders require a price');
  }
  const metadata: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.metadata)) {
    if (typeof value === 'string' && value.length <= 128 && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)) {
      metadata[key] = value;
    }
  }
  return {
    tenantId: input.tenantId,
    accountId: input.accountId,
    orderId: input.orderId,
    clientOrderId: input.clientOrderId,
    symbol: input.symbol,
    side: input.side,
    orderType: input.orderType,
    quantity: plainDecimal(input.quantity),
    price,
    timeInForce,
    reduceOnly: input.reduceOnly ?? false,
    strategyId: input.strategyId ?? null,
    riskDecisionId: input.riskDecisionId,
    environment: 'PAPER',
    specification: input.specification,
    exposure: input.exposure,
    metadata,
    omsIntentId: input.omsIntentId,
    ...(input.requestedByUserId ? { requestedByUserId: input.requestedByUserId } : {}),
    requestedAt: new Date().toISOString(),
  };
}
