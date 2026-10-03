/**
 * The TRADE_EXECUTION job contract, as the worker sees it.
 *
 * The producer side lives in ExecutionCommandsService and
 * ExecutionOrdersService (apps/api/src/modules/execution/); this file is the
 * consumer's mirror of exactly that payload - validated, not trusted. A job
 * is data from Redis, and Redis can be written by anything with the
 * connection: a stale producer, a debug script, an attacker who got that far.
 * The guards below are why the worker can forward a payload into a
 * credentialed service without laundering whatever was in it.
 *
 * Unknown job names are NOT validated-then-ignored: they are refused. An
 * ack path for a name the consumer does not know is how a job goes missing
 * with a green checkmark on it.
 */

import { JOB_NAMES } from '@wlct/config';

export type TradeExecutionCommand =
  | typeof JOB_NAMES.VERIFY_EXCHANGE_CREDENTIALS
  | typeof JOB_NAMES.REFRESH_ACCOUNT_BALANCES
  | typeof JOB_NAMES.RECONCILE_TRADING_ACCOUNT
  | typeof JOB_NAMES.RESYNC_PRIVATE_STREAM
  | typeof JOB_NAMES.CANCEL_ORDER
  | typeof JOB_NAMES.SUBMIT_ORDER;

export const TRADE_EXECUTION_COMMANDS: ReadonlySet<string> = new Set<string>([
  JOB_NAMES.VERIFY_EXCHANGE_CREDENTIALS,
  JOB_NAMES.REFRESH_ACCOUNT_BALANCES,
  JOB_NAMES.RECONCILE_TRADING_ACCOUNT,
  JOB_NAMES.RESYNC_PRIVATE_STREAM,
  JOB_NAMES.CANCEL_ORDER,
  JOB_NAMES.SUBMIT_ORDER,
]);

export interface AccountCommandPayload {
  readonly tenantId: string;
  readonly accountId: string;
  readonly requestedByUserId?: string;
  readonly requestedAt?: string;
}

export interface CancelOrderPayload extends AccountCommandPayload {
  readonly orderId: string;
  readonly clientOrderId: string;
  readonly symbol: string;
}

/** The instrument's trading rules, copied from the platform's TradingSymbol
 * row by the OMS. Decimal fields are STRINGS end to end. */
export interface SubmitOrderSpecification {
  readonly baseAsset: string;
  readonly quoteAsset: string;
  readonly marketType: 'SPOT' | 'MARGIN' | 'FUTURES_USDT' | 'FUTURES_COIN';
  readonly priceTick: string;
  readonly quantityStep: string;
  readonly minQuantity: string;
  readonly maxQuantity: string | null;
  readonly minNotional: string;
  readonly isTradeable: boolean;
  readonly pricePrecision: number;
  readonly quantityPrecision: number;
}

/** The account's exposure from the API's canonical Position ledger.
 * `complete: false` makes the engine's risk check refuse the order. */
export interface SubmitOrderExposure {
  readonly positionQuantity: string;
  readonly symbolExposureNotional: string;
  readonly accountExposureNotional: string;
  readonly realisedPnlToday?: string;
  readonly complete: boolean;
}

/** Phase 3: an OMS-approved order. PAPER only - the engine this worker talks
 * to is simulated, and a LIVE environment is refused here (terminal) rather
 * than forwarded to be refused there. */
export interface SubmitOrderPayload extends AccountCommandPayload {
  readonly orderId: string;
  readonly clientOrderId: string;
  readonly symbol: string;
  readonly side: 'BUY' | 'SELL';
  readonly orderType: 'MARKET' | 'LIMIT';
  readonly quantity: string;
  readonly price: string | null;
  readonly timeInForce: 'GTC' | 'IOC' | 'FOK';
  readonly reduceOnly: boolean;
  readonly strategyId: string | null;
  readonly riskDecisionId: string;
  readonly environment: 'PAPER';
  readonly specification: SubmitOrderSpecification;
  readonly exposure: SubmitOrderExposure;
  readonly metadata: Readonly<Record<string, string>>;
  /** OMS intent this order belongs to, for the API-side result recorder. */
  readonly omsIntentId: string | null;
}

export type TradeExecutionPayload = AccountCommandPayload | CancelOrderPayload | SubmitOrderPayload;

export function isSubmitOrderPayload(payload: TradeExecutionPayload): payload is SubmitOrderPayload {
  return (payload as SubmitOrderPayload).riskDecisionId !== undefined
    && (payload as SubmitOrderPayload).specification !== undefined;
}

/** Id-shape on this wire: the platform's own ids (ULIDs/uuids) plus the
 * account/tenant slugs the producers put in. Deliberately tighter than "any
 * string": these values flow into Redis key composition (partitioning) and
 * into engine path bodies, and a character set that cannot carry structure
 * is what makes that safe. 128 is the widest any producer writes. */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const SYMBOL_PATTERN = /^[A-Za-z0-9]{1,32}$/;
/** The platform's canonical symbol form ("BTC-USDT") as well as the venue
 * form ("BTCUSDT"): the OMS submits the canonical one. */
const SUBMIT_SYMBOL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,31}$/;
/** The execution core's CLIENT_ORDER_ID_PATTERN (strictest venue limit). */
const ENGINE_CLIENT_ORDER_ID_PATTERN = /^[A-Za-z0-9_-]{1,36}$/;
/** A plain decimal string - no exponent, no sign unless allowed. */
const DECIMAL_PATTERN = /^\d+(\.\d+)?$/;
const SIGNED_DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;
const MAX_METADATA_ENTRIES = 16;

export class TradeExecutionPayloadError extends Error {
  public constructor(public readonly reason: string) {
    super(`TRADE_EXECUTION payload rejected: ${reason}`);
    this.name = 'TradeExecutionPayloadError';
  }
}

function requireId(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new TradeExecutionPayloadError(`${key} must be a platform identifier`);
  }
  return value;
}

function requireDecimal(record: Record<string, unknown>, key: string, opts: { positive?: boolean; signed?: boolean } = {}): string {
  const value = record[key];
  const pattern = opts.signed ? SIGNED_DECIMAL_PATTERN : DECIMAL_PATTERN;
  if (typeof value !== 'string' || value.length > 64 || !pattern.test(value)) {
    throw new TradeExecutionPayloadError(`${key} must be a decimal string`);
  }
  if (opts.positive && !/[1-9]/.test(value)) {
    throw new TradeExecutionPayloadError(`${key} must be greater than zero`);
  }
  return value;
}

function requireObject(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TradeExecutionPayloadError(`${key} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireEnum<T extends string>(record: Record<string, unknown>, key: string, allowed: readonly T[]): T {
  const value = record[key];
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new TradeExecutionPayloadError(`${key} must be one of ${allowed.join(', ')}`);
  }
  return value as T;
}

function requireAsset(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !/^[A-Za-z0-9]{1,16}$/.test(value)) {
    throw new TradeExecutionPayloadError(`${key} must be an asset code`);
  }
  return value;
}

function requirePrecision(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 18) {
    throw new TradeExecutionPayloadError(`${key} must be an integer 0..18`);
  }
  return value;
}

function parseSubmitOrder(record: Record<string, unknown>, enriched: AccountCommandPayload): SubmitOrderPayload {
  const orderId = requireId(record, 'orderId');
  const clientOrderId = record.clientOrderId;
  if (typeof clientOrderId !== 'string' || !ENGINE_CLIENT_ORDER_ID_PATTERN.test(clientOrderId)) {
    throw new TradeExecutionPayloadError('clientOrderId must match [A-Za-z0-9_-]{1,36}');
  }
  const symbol = record.symbol;
  if (typeof symbol !== 'string' || !SUBMIT_SYMBOL_PATTERN.test(symbol)) {
    throw new TradeExecutionPayloadError('symbol must be a platform or exchange symbol');
  }
  const side = requireEnum(record, 'side', ['BUY', 'SELL'] as const);
  const orderType = requireEnum(record, 'orderType', ['MARKET', 'LIMIT'] as const);
  const quantity = requireDecimal(record, 'quantity', { positive: true });
  let price: string | null = null;
  if (record.price !== undefined && record.price !== null) {
    price = requireDecimal(record, 'price', { positive: true });
  }
  if (orderType === 'LIMIT' && price === null) {
    throw new TradeExecutionPayloadError('LIMIT orders require a price');
  }
  const timeInForce = record.timeInForce === undefined
    ? 'GTC'
    : requireEnum(record, 'timeInForce', ['GTC', 'IOC', 'FOK'] as const);
  const reduceOnly = record.reduceOnly === undefined ? false : record.reduceOnly;
  if (typeof reduceOnly !== 'boolean') {
    throw new TradeExecutionPayloadError('reduceOnly must be a boolean');
  }
  const environment = record.environment;
  if (environment !== 'PAPER') {
    // Terminal, by design: the only engine this worker forwards to is the
    // simulated runtime. A LIVE order is refused visibly here instead of
    // being retried against a refusal that can never change.
    throw new TradeExecutionPayloadError('environment must be PAPER; live submission is not wired');
  }
  const riskDecisionId = requireId(record, 'riskDecisionId');
  let strategyId: string | null = null;
  if (record.strategyId !== undefined && record.strategyId !== null) {
    strategyId = requireId(record, 'strategyId');
  }
  let omsIntentId: string | null = null;
  if (record.omsIntentId !== undefined && record.omsIntentId !== null) {
    omsIntentId = requireId(record, 'omsIntentId');
  }

  const specRecord = requireObject(record, 'specification');
  let maxQuantity: string | null = null;
  if (specRecord.maxQuantity !== undefined && specRecord.maxQuantity !== null) {
    maxQuantity = requireDecimal(specRecord, 'maxQuantity', { positive: true });
  }
  if (typeof specRecord.isTradeable !== 'boolean') {
    throw new TradeExecutionPayloadError('specification.isTradeable must be a boolean');
  }
  const specification: SubmitOrderSpecification = {
    baseAsset: requireAsset(specRecord, 'baseAsset'),
    quoteAsset: requireAsset(specRecord, 'quoteAsset'),
    marketType: requireEnum(specRecord, 'marketType', ['SPOT', 'MARGIN', 'FUTURES_USDT', 'FUTURES_COIN'] as const),
    priceTick: requireDecimal(specRecord, 'priceTick'),
    quantityStep: requireDecimal(specRecord, 'quantityStep'),
    minQuantity: requireDecimal(specRecord, 'minQuantity'),
    maxQuantity,
    minNotional: requireDecimal(specRecord, 'minNotional'),
    isTradeable: specRecord.isTradeable,
    pricePrecision: requirePrecision(specRecord, 'pricePrecision'),
    quantityPrecision: requirePrecision(specRecord, 'quantityPrecision'),
  };

  const exposureRecord = requireObject(record, 'exposure');
  if (typeof exposureRecord.complete !== 'boolean') {
    throw new TradeExecutionPayloadError('exposure.complete must be a boolean');
  }
  const exposure: SubmitOrderExposure = {
    positionQuantity: requireDecimal(exposureRecord, 'positionQuantity', { signed: true }),
    symbolExposureNotional: requireDecimal(exposureRecord, 'symbolExposureNotional'),
    accountExposureNotional: requireDecimal(exposureRecord, 'accountExposureNotional'),
    ...(exposureRecord.realisedPnlToday !== undefined && exposureRecord.realisedPnlToday !== null
      ? { realisedPnlToday: requireDecimal(exposureRecord, 'realisedPnlToday', { signed: true }) }
      : {}),
    complete: exposureRecord.complete,
  };

  const metadata: Record<string, string> = {};
  if (record.metadata !== undefined && record.metadata !== null) {
    const metaRecord = requireObject(record, 'metadata');
    const entries = Object.entries(metaRecord);
    if (entries.length > MAX_METADATA_ENTRIES) {
      throw new TradeExecutionPayloadError(`metadata may carry at most ${MAX_METADATA_ENTRIES} entries`);
    }
    for (const [key, value] of entries) {
      if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) || typeof value !== 'string' || value.length > 128) {
        throw new TradeExecutionPayloadError('metadata must map identifier keys to strings of at most 128 characters');
      }
      metadata[key] = value;
    }
  }

  return {
    ...enriched,
    orderId,
    clientOrderId,
    symbol,
    side,
    orderType,
    quantity,
    price,
    timeInForce,
    reduceOnly,
    strategyId,
    riskDecisionId,
    environment: 'PAPER',
    specification,
    exposure,
    metadata,
    omsIntentId,
  };
}

/** Validate the job data for a known command. Throws
 * {@link TradeExecutionPayloadError} for anything malformed, including a
 * well-shaped payload for an unknown command name - the caller turns that
 * into an UnrecoverableError so the job fails visibly instead of retrying a
 * shape that can never succeed. */
export function parseTradeExecutionPayload(
  command: string,
  data: unknown,
): TradeExecutionPayload {
  if (!TRADE_EXECUTION_COMMANDS.has(command)) {
    throw new TradeExecutionPayloadError(`unknown command ${JSON.stringify(command)}`);
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new TradeExecutionPayloadError('payload must be an object');
  }
  const record = data as Record<string, unknown>;
  const base: AccountCommandPayload = {
    tenantId: requireId(record, 'tenantId'),
    accountId: requireId(record, 'accountId'),
  };
  const requestedBy = record.requestedByUserId;
  const requestedAt = record.requestedAt;
  const enriched: AccountCommandPayload = {
    ...base,
    ...(typeof requestedBy === 'string' && requestedBy.length <= 64
      ? { requestedByUserId: requestedBy }
      : {}),
    ...(typeof requestedAt === 'string' && requestedAt.length <= 64
      ? { requestedAt }
      : {}),
  };

  if (command === JOB_NAMES.CANCEL_ORDER) {
    const orderId = requireId(record, 'orderId');
    const clientOrderId = record.clientOrderId;
    if (typeof clientOrderId !== 'string' || clientOrderId.length < 1 || clientOrderId.length > 128) {
      throw new TradeExecutionPayloadError('clientOrderId must be a 1..128 character string');
    }
    const symbol = record.symbol;
    if (typeof symbol !== 'string' || !SYMBOL_PATTERN.test(symbol)) {
      throw new TradeExecutionPayloadError('symbol must be an exchange symbol');
    }
    const payload: CancelOrderPayload = { ...enriched, orderId, clientOrderId, symbol };
    return payload;
  }
  if (command === JOB_NAMES.SUBMIT_ORDER) {
    return parseSubmitOrder(record, enriched);
  }
  return enriched;
}
