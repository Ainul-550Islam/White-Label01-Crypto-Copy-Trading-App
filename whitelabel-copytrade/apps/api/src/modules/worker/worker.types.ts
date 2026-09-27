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
  | typeof JOB_NAMES.CANCEL_ORDER;

export const TRADE_EXECUTION_COMMANDS: ReadonlySet<string> = new Set<string>([
  JOB_NAMES.VERIFY_EXCHANGE_CREDENTIALS,
  JOB_NAMES.REFRESH_ACCOUNT_BALANCES,
  JOB_NAMES.RECONCILE_TRADING_ACCOUNT,
  JOB_NAMES.RESYNC_PRIVATE_STREAM,
  JOB_NAMES.CANCEL_ORDER,
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

export type TradeExecutionPayload = AccountCommandPayload | CancelOrderPayload;

/** Id-shape on this wire: the platform's own ids (ULIDs/uuids) plus the
 * account/tenant slugs the producers put in. Deliberately tighter than "any
 * string": these values flow into Redis key composition (partitioning) and
 * into engine path bodies, and a character set that cannot carry structure
 * is what makes that safe. 128 is the widest any producer writes. */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const SYMBOL_PATTERN = /^[A-Za-z0-9]{1,32}$/;

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
  return enriched;
}
