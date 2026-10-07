// # Responsibility: verifies atomic tenant-isolated exchange request reservations and fail-closed routing decisions.
import { ExchangeEnvironment, ExchangeVenue } from './exchange.types';
import { ExchangeRateLimitService } from './exchange-rate-limit.service';

describe('ExchangeRateLimitService', () => {
  const baseInput = {
    tenantId: 'tenant-a',
    venue: ExchangeVenue.BINANCE,
    environment: ExchangeEnvironment.LIVE,
    accountId: 'account-a',
    endpointClass: 'ORDER',
  };

  function buildService(reservedUsage: number | Error, expectedWeight = 1) {
    const cache = {
      incrementBy: jest.fn(async (key: string, weight: number, ttlSeconds: number) => {
        expect(key).toBe('exchange:ratelimit:tenant-a:BINANCE:LIVE:account-a:ORDER');
        expect(weight).toBe(expectedWeight);
        expect(ttlSeconds).toBe(60);
        if (reservedUsage instanceof Error) throw reservedUsage;
        return reservedUsage;
      }),
    };
    const registry = {};
    const auditService = { record: jest.fn(async () => undefined) };
    const service = new ExchangeRateLimitService(cache as any, registry as any, auditService as any);
    return { service, cache, auditService };
  }

  test('atomically reserves and allows a request at the configured order ceiling', async () => {
    const { service, cache, auditService } = buildService(600);

    await expect(service.checkRateLimit(baseInput)).resolves.toMatchObject({
      allowed: true,
      remaining: 0,
      pressure: 100,
    });
    expect(cache.incrementBy).toHaveBeenCalledTimes(1);
    expect(auditService.record).not.toHaveBeenCalled();
  });

  test('denies and audits a weighted request that exceeds the order ceiling', async () => {
    const { service, cache, auditService } = buildService(601, 3);

    await expect(service.checkRateLimit({ ...baseInput, weight: 3 })).resolves.toMatchObject({
      allowed: false,
      remaining: 0,
      retryAfterMs: 1000,
      reason: expect.stringContaining('Rate limit exceeded'),
    });
    expect(cache.incrementBy).toHaveBeenCalledWith(
      'exchange:ratelimit:tenant-a:BINANCE:LIVE:account-a:ORDER',
      3,
      60,
    );
    expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      accountId: 'account-a',
      event: 'RATE_LIMIT_TRIGGERED',
      result: 'SUCCESS',
    }));
  });

  test('fails closed and audits when Redis cannot reserve the request budget', async () => {
    const { service, cache, auditService } = buildService(new Error('redis unavailable'));

    await expect(service.checkRateLimit(baseInput)).resolves.toMatchObject({
      allowed: false,
      remaining: null,
      retryAfterMs: 1000,
      pressure: 100,
      reason: expect.stringContaining('unavailable'),
    });
    expect(cache.incrementBy).toHaveBeenCalledTimes(1);
    expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      accountId: 'account-a',
      event: 'RATE_LIMIT_STATE_UNAVAILABLE',
      result: 'FAILURE',
    }));
  });

  test('rejects a zero or fractional request weight without touching Redis', async () => {
    const { service, cache } = buildService(1);

    await expect(service.checkRateLimit({ ...baseInput, weight: 0 })).resolves.toMatchObject({
      allowed: false,
      reason: 'Rate-limit request weight is invalid',
    });
    await expect(service.checkRateLimit({ ...baseInput, weight: 1.5 })).resolves.toMatchObject({
      allowed: false,
      reason: 'Rate-limit request weight is invalid',
    });
    expect(cache.incrementBy).not.toHaveBeenCalled();
  });
});
