import { Prisma } from '@prisma/client';

/**
 * True when `error` is Prisma's "record to update/delete does not exist"
 * (P2025) - the one storage error that legitimately means "not found".
 *
 * Repository update/delete methods that answer `null` (or `false`) for a
 * missing row use this to keep that answer while letting every other storage
 * failure propagate: a lost connection, a statement timeout or an RLS denial
 * is an error, not "not found", and the global PrismaExceptionFilter maps it
 * to the right HTTP status without leaking the driver message.
 *
 * Besides the real PrismaClientKnownRequestError, any error object carrying
 * `code: 'P2025'` is recognised (test doubles raise plain objects, and some
 * suites replace @prisma/client entirely, so the class may be absent).
 */
export function isRecordNotFound(error: unknown): boolean {
  const KnownRequestError = (Prisma as { PrismaClientKnownRequestError?: unknown } | undefined)
    ?.PrismaClientKnownRequestError;
  if (typeof KnownRequestError === 'function' && error instanceof (KnownRequestError as new (...args: never[]) => object)) {
    return (error as { code?: unknown }).code === 'P2025';
  }
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2025';
}
