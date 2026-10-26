// # Responsibility: logs secret-safe, tenant-scoped money-path failures and rethrows them as typed errors.
import { Logger } from '@nestjs/common';

export interface MoneyPathFailureContext {
  code: string;
  tenantId?: unknown;
  entityId?: unknown;
}

export class MoneyPathOperationError extends Error {
  readonly code: string;
  override readonly cause: unknown;

  constructor(code: string, cause: unknown) {
    super(`Money-path operation failed (${code})`);
    this.name = 'MoneyPathOperationError';
    this.code = code;
    this.cause = cause;
  }
}

const logger = new Logger('MoneyPathFailure');

function safeIdentifier(value: unknown): string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128
    ? value
    : 'UNAVAILABLE';
}

function safeErrorType(error: unknown): string {
  if (error instanceof Error && error.name && /^[A-Za-z][A-Za-z0-9_.]{0,63}$/.test(error.name)) {
    return error.name;
  }
  return 'UnknownError';
}

export function recordMoneyPathFailure(
  error: unknown,
  context: MoneyPathFailureContext,
): MoneyPathOperationError {
  const code = /^[A-Z][A-Z0-9_]{2,63}$/.test(context.code) ? context.code : 'MONEY_PATH_OPERATION_FAILED';
  logger.error(JSON.stringify({
    event: 'money_path.operation_failed',
    code,
    tenantId: safeIdentifier(context.tenantId),
    entityId: safeIdentifier(context.entityId),
    errorType: safeErrorType(error),
  }));
  return new MoneyPathOperationError(code, error);
}

export function failClosedMoneyOperation(
  error: unknown,
  context: MoneyPathFailureContext,
): never {
  throw recordMoneyPathFailure(error, context);
}
