import { PAGINATION_DEFAULTS } from '@wlct/config';

import { ValidationException } from '../errors/app.exception';

/**
 * Pagination for handlers that still read an untyped `@Query() query: any`
 * (copy-trading, custody and research controllers).
 *
 * Those handlers used `query.page ? parseInt(query.page) : 1`. Measured on
 * PostgreSQL 16 with Prisma 5.22:
 *   - `?page=0` / `?page=-3` -> negative `skip` -> PrismaClientUnknownRequestError,
 *     which no filter maps -> HTTP 500;
 *   - `?limit=1000000` -> accepted, an unbounded read (the custody and research
 *     services do not clamp);
 *   - `?page=abc` -> `take`/`skip` NaN -> a generic 400 with no field detail.
 * These helpers apply the same rules as PaginationQueryDto
 * (page >= 1, 1 <= limit <= MAX_LIMIT) and fail with the same field-level
 * ValidationException (422) a DTO-validated endpoint would return, before any
 * database call.
 */
function parsePositiveInt(raw: unknown, field: 'page' | 'limit'): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const text = typeof raw === 'number' ? String(raw) : raw;
  if (typeof text !== 'string' || !/^\d+$/.test(text.trim())) {
    throw new ValidationException([
      { field, constraint: 'isInt', message: `${field} must be an integer` },
    ]);
  }
  return Number.parseInt(text.trim(), 10);
}

export function pageParam(raw: unknown, fallback: number = PAGINATION_DEFAULTS.PAGE): number {
  const page = parsePositiveInt(raw, 'page');
  if (page === undefined) return fallback;
  if (page < 1) {
    throw new ValidationException([{ field: 'page', constraint: 'min', message: 'page must be at least 1' }]);
  }
  return page;
}

export function limitParam(raw: unknown, fallback: number = PAGINATION_DEFAULTS.LIMIT): number {
  const limit = parsePositiveInt(raw, 'limit');
  if (limit === undefined) return fallback;
  if (limit < 1) {
    throw new ValidationException([{ field: 'limit', constraint: 'min', message: 'limit must be at least 1' }]);
  }
  if (limit > PAGINATION_DEFAULTS.MAX_LIMIT) {
    throw new ValidationException([
      {
        field: 'limit',
        constraint: 'max',
        message: `limit must not exceed ${PAGINATION_DEFAULTS.MAX_LIMIT}`,
      },
    ]);
  }
  return limit;
}

/**
 * Optional integer with explicit bounds, for limits that are not page sizes
 * (e.g. candle counts forwarded to an exchange). Absent -> undefined so the
 * downstream default applies.
 */
export function boundedIntParam(raw: unknown, field: string, min: number, max: number): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const text = typeof raw === 'number' ? String(raw) : raw;
  if (typeof text !== 'string' || !/^\d+$/.test(text.trim())) {
    throw new ValidationException([{ field, constraint: 'isInt', message: `${field} must be an integer` }]);
  }
  const value = Number.parseInt(text.trim(), 10);
  if (value < min || value > max) {
    throw new ValidationException([
      { field, constraint: 'range', message: `${field} must be between ${min} and ${max}` },
    ]);
  }
  return value;
}
