import { ValidationException } from '../errors/app.exception';

import { boundedIntParam, limitParam, pageParam } from './pagination-params';

/**
 * The copy-trading, custody and research list endpoints read pagination from
 * an untyped query with `parseInt`: `?page=0` became a negative skip (Prisma
 * UnknownRequestError -> HTTP 500), `?limit=1000000` an unbounded read, and
 * `?page=abc` NaN (a generic 400 without field detail).
 */
describe('pagination params for untyped @Query() handlers', () => {
  it('uses the handler default when the parameter is absent', () => {
    expect(pageParam(undefined)).toBe(1);
    expect(pageParam('')).toBe(1);
    expect(limitParam(undefined, 50)).toBe(50);
    expect(limitParam(undefined)).toBe(20);
  });

  it('parses valid integers', () => {
    expect(pageParam('3')).toBe(3);
    expect(limitParam('100')).toBe(100);
    expect(limitParam(' 25 ')).toBe(25);
  });

  it.each(['abc', '1.5', '-3', '2e3', '0x10'])('rejects page=%s with a validation error, not NaN', (raw) => {
    expect(() => pageParam(raw)).toThrow(ValidationException);
  });

  it('rejects page 0, limit 0 and limit above the maximum', () => {
    expect(() => pageParam('0')).toThrow(ValidationException);
    expect(() => limitParam('0')).toThrow(ValidationException);
    expect(() => limitParam('101')).toThrow(ValidationException);
  });

  it('rejects repeated parameters (?page=1&page=2 arrives as an array)', () => {
    expect(() => pageParam(['1', '2'])).toThrow(ValidationException);
  });

  it('bounded optional integers keep "absent" as undefined and enforce the range', () => {
    expect(boundedIntParam(undefined, 'limit', 1, 1000)).toBeUndefined();
    expect(boundedIntParam('500', 'limit', 1, 1000)).toBe(500);
    expect(() => boundedIntParam('1001', 'limit', 1, 1000)).toThrow(ValidationException);
    expect(() => boundedIntParam('x', 'limit', 1, 1000)).toThrow(ValidationException);
  });
});
