import { Injectable, Logger } from '@nestjs/common';
import { CacheService } from '../../infrastructure/redis/cache.service';
import { ExchangeVenue, ExchangeEnvironment } from './exchange.types';
import { ExchangeRegistryService } from './exchange-registry.service';
import { ExchangeAuditService } from './exchange-audit.service';

export interface RateLimitState {
  venue: ExchangeVenue;
  environment: ExchangeEnvironment;
  accountId: string | null;
  endpointClass: string;
  requestsPerInterval: number;
  intervalMs: number;
  weightPerRequest: number;
  remaining: number | null;
  resetAtMs: number | null;
  retryAfterMs: number | null;
  isWeightBased: boolean;
  scope: string;
  currentUsage: number;
  pressure: number; // 0-100
}

export interface RateLimitCheckResult {
  allowed: boolean;
  remaining: number | null;
  retryAfterMs: number | null;
  pressure: number;
  reason?: string;
}

/**
 * Normalizes exchange-specific rate limits and coordinates requests with existing rate-limit infrastructure without bypassing venue protections.
 * Do not replace existing Part 2 API rate-limit enforcement.
 */
@Injectable()
export class ExchangeRateLimitService {
  private readonly logger = new Logger(ExchangeRateLimitService.name);

  // Venue-specific rate limit configs - authoritative
  private readonly venueLimits: Map<ExchangeVenue, { requestsPerSecond: number; weightLimitPerMinute: number; isWeightBased: boolean }> = new Map([
    [ExchangeVenue.BINANCE, { requestsPerSecond: 10, weightLimitPerMinute: 1200, isWeightBased: true }],
    [ExchangeVenue.BYBIT, { requestsPerSecond: 10, weightLimitPerMinute: 600, isWeightBased: false }],
    [ExchangeVenue.OKX, { requestsPerSecond: 10, weightLimitPerMinute: 600, isWeightBased: false }],
    [ExchangeVenue.KRAKEN, { requestsPerSecond: 1, weightLimitPerMinute: 60, isWeightBased: false }],
    [ExchangeVenue.COINBASE, { requestsPerSecond: 10, weightLimitPerMinute: 600, isWeightBased: false }],
    [ExchangeVenue.OTHER_CONFIGURED, { requestsPerSecond: 5, weightLimitPerMinute: 300, isWeightBased: false }],
  ]);

  constructor(
    private readonly cache: CacheService,
    private readonly registry: ExchangeRegistryService,
    private readonly auditService: ExchangeAuditService,
  ) {}

  /**
   * The budget key names the tenant first.
   *
   * It did not, so two tenants routing to the same venue with no account selected shared one
   * `global` bucket: one tenant's traffic consumed another tenant's budget, and a busy tenant could
   * rate-limit a quiet one out of its own orders. In a white-label deployment that is a
   * cross-tenant defect, not a tuning detail.
   */
  private getCacheKey(
    tenantId: string,
    venue: ExchangeVenue,
    environment: ExchangeEnvironment,
    accountId: string | null,
    endpointClass: string,
  ): string {
    return `exchange:ratelimit:${tenantId}:${venue}:${environment}:${accountId || 'global'}:${endpointClass}`;
  }

  private getVenueLimit(venue: ExchangeVenue): { requestsPerSecond: number; weightLimitPerMinute: number; isWeightBased: boolean } {
    return this.venueLimits.get(venue) || { requestsPerSecond: 5, weightLimitPerMinute: 300, isWeightBased: false };
  }

  async checkRateLimit(input: {
    tenantId: string;
    venue: ExchangeVenue;
    environment: ExchangeEnvironment;
    accountId?: string | null;
    endpointClass: string;
    weight?: number;
  }): Promise<RateLimitCheckResult> {
    const venueLimit = this.getVenueLimit(input.venue);
    const weight = input.weight === undefined || input.weight === null ? 1 : input.weight;

    // A weight that is not a positive integer is not a request. It used to be coerced with `|| 1`,
    // which turned 0 into 1 and silently dropped the fractional part of 1.5, so a caller asking for a
    // heavier endpoint was charged for a lighter one and the budget under-counted.
    if (!Number.isInteger(weight) || weight < 1) {
      return { allowed: false, remaining: null, retryAfterMs: null, pressure: 100, reason: 'Rate-limit request weight is invalid' };
    }

    const key = this.getCacheKey(input.tenantId, input.venue, input.environment, input.accountId || null, input.endpointClass);
    const maxRequests = this.maxRequestsFor(venueLimit, input.endpointClass);
    const windowSeconds = 60;

    let reservedUsage: number;
    try {
      // Reserve first, decide second, in one atomic increment. Checking and then recording is two
      // steps with a gap: concurrent requests all read the same usage, all conclude they fit, and the
      // venue is the one that finds out otherwise.
      reservedUsage = await this.cache.incrementBy(key, weight, windowSeconds);
    } catch (e: any) {
      // Fail closed. The budget could not be read, so whether this request is within the venue's
      // limit is unknown - and the consequence of guessing "yes" is the venue throttling or banning
      // the API key, which stops every copy for every follower on that account. A refusal that is
      // retried costs a moment; a ban costs the account.
      this.logger.error(`Rate limit reservation failed venue=${input.venue} tenant=${input.tenantId} error=${e.message} - denying request`);
      await this.auditService.record({
        tenantId: input.tenantId,
        accountId: input.accountId || 'global',
        venue: input.venue,
        environment: input.environment,
        event: 'RATE_LIMIT_STATE_UNAVAILABLE',
        result: 'FAILURE',
        safeMetadata: { endpointClass: input.endpointClass, weight, maxRequests },
      });
      return { allowed: false, remaining: null, retryAfterMs: 1000, pressure: 100, reason: `Rate limit state unavailable for ${input.venue} ${input.endpointClass}` };
    }

    const pressure = Math.min(100, Math.floor((reservedUsage / maxRequests) * 100));

    if (reservedUsage > maxRequests) {
      // Hand the reservation back. The request is refused, so it did not consume budget, and leaving
      // the weight charged would let one burst of refusals exhaust the window for the requests that
      // are still allowed.
      try {
        await this.cache.incrementBy(key, -weight, windowSeconds);
      } catch (e: any) {
        this.logger.warn(`Rate limit refund failed venue=${input.venue} tenant=${input.tenantId} error=${e.message}`);
      }

      this.logger.warn(`Rate limit exceeded venue=${input.venue} env=${input.environment} account=${input.accountId} endpoint=${input.endpointClass} usage=${reservedUsage}/${maxRequests}`);

      await this.auditService.record({
        tenantId: input.tenantId,
        accountId: input.accountId || 'global',
        venue: input.venue,
        environment: input.environment,
        event: 'RATE_LIMIT_TRIGGERED',
        result: 'SUCCESS',
        safeMetadata: { endpointClass: input.endpointClass, currentUsage: reservedUsage, maxRequests, pressure, retryAfterMs: 1000 },
      });

      return { allowed: false, remaining: 0, retryAfterMs: 1000, pressure, reason: `Rate limit exceeded for ${input.venue} ${input.endpointClass}` };
    }

    const remaining = Math.max(0, maxRequests - reservedUsage);
    return { allowed: true, remaining, retryAfterMs: null, pressure };
  }

  /**
   * The per-minute budget for an endpoint class: the venue's own limit, halved for order placement
   * and reduced to 80% for private endpoints, so the account keeps headroom for cancellations and
   * reconciliation instead of spending the venue's whole allowance on new orders.
   */
  private maxRequestsFor(
    venueLimit: { requestsPerSecond: number; weightLimitPerMinute: number; isWeightBased: boolean },
    endpointClass: string,
  ): number {
    const base = venueLimit.isWeightBased ? venueLimit.weightLimitPerMinute : venueLimit.requestsPerSecond * 60;
    if (endpointClass === 'ORDER') return Math.max(1, Math.floor(base * 0.5));
    if (endpointClass === 'PRIVATE') return Math.max(1, Math.floor(base * 0.8));
    return base;
  }

  async recordRequest(input: {
    tenantId: string;
    venue: ExchangeVenue;
    environment: ExchangeEnvironment;
    accountId?: string | null;
    endpointClass: string;
    weight?: number;
    responseHeaders?: Record<string, string>;
  }): Promise<void> {
    const weight = input.weight || 1;
    const key = this.getCacheKey(input.tenantId, input.venue, input.environment, input.accountId || null, input.endpointClass);

    try {
      // Increment usage counter with TTL
      await this.cache.increment(key, 60);

      // Parse response headers for remaining allowance if provided
      if (input.responseHeaders) {
        const remaining = this.parseRemainingFromHeaders(input.venue, input.responseHeaders);
        const resetAt = this.parseResetFromHeaders(input.venue, input.responseHeaders);
        const retryAfter = this.parseRetryAfterFromHeaders(input.responseHeaders);

        if (remaining !== null || resetAt !== null || retryAfter !== null) {
          const stateKey = `${key}:state`;
          await this.cache.set(
            stateKey,
            {
              remaining,
              resetAtMs: resetAt,
              retryAfterMs: retryAfter,
              lastUpdated: Date.now(),
            },
            60,
          );
        }
      }
    } catch (e: any) {
      this.logger.warn(`Failed to record rate limit request venue=${input.venue} error=${e.message}`);
    }
  }

  private parseRemainingFromHeaders(venue: ExchangeVenue, headers: Record<string, string>): number | null {
    // Venue-specific header parsing
    const lowerHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) {
      lowerHeaders[k.toLowerCase()] = v;
    }

    if (venue === ExchangeVenue.BINANCE) {
      const usedWeight = lowerHeaders['x-mbx-used-weight'] || lowerHeaders['x-mbx-used-weight-1m'];
      if (usedWeight) {
        const limit = this.getVenueLimit(venue).weightLimitPerMinute;
        return Math.max(0, limit - parseInt(usedWeight, 10));
      }
    }

    if (venue === ExchangeVenue.BYBIT || venue === ExchangeVenue.OKX) {
      // Bybit/OKX don't typically return remaining in headers, use our own tracking
      return null;
    }

    // Generic fallback
    const remaining = lowerHeaders['x-ratelimit-remaining'] || lowerHeaders['x-rate-limit-remaining'];
    if (remaining) {
      return parseInt(remaining, 10);
    }

    return null;
  }

  private parseResetFromHeaders(venue: ExchangeVenue, headers: Record<string, string>): number | null {
    const lowerHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) {
      lowerHeaders[k.toLowerCase()] = v;
    }

    const reset = lowerHeaders['x-ratelimit-reset'] || lowerHeaders['x-rate-limit-reset'] || lowerHeaders['retry-after'];
    if (reset) {
      const resetSec = parseInt(reset, 10);
      if (!isNaN(resetSec)) {
        // If reset is seconds from now or timestamp
        if (resetSec < 1000000000) {
          return Date.now() + resetSec * 1000;
        }
        return resetSec * 1000;
      }
    }
    return null;
  }

  private parseRetryAfterFromHeaders(headers: Record<string, string>): number | null {
    const lowerHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) {
      lowerHeaders[k.toLowerCase()] = v;
    }

    const retryAfter = lowerHeaders['retry-after'];
    if (retryAfter) {
      const seconds = parseInt(retryAfter, 10);
      if (!isNaN(seconds)) {
        return seconds * 1000;
      }
    }
    return null;
  }

  /**
   * The current budget state for an account. Requires the tenant: without it the key fell back to the
   * shared `global` bucket, so an operator reading one tenant's pressure was reading every tenant's
   * combined usage - and the number would have been wrong in whichever direction the neighbours were
   * busier.
   */
  async getRateLimitState(input: { tenantId: string; venue: ExchangeVenue; environment: ExchangeEnvironment; accountId?: string | null; endpointClass: string }): Promise<RateLimitState | null> {
    const key = this.getCacheKey(input.tenantId, input.venue, input.environment, input.accountId || null, input.endpointClass);
    const stateKey = `${key}:state`;

    try {
      const currentUsage = (await this.cache.get<number>(key)) || 0;
      const state = (await this.cache.get<any>(stateKey)) || {};

      const venueLimit = this.getVenueLimit(input.venue);
      const maxRequests = venueLimit.isWeightBased ? venueLimit.weightLimitPerMinute : venueLimit.requestsPerSecond * 60;
      const pressure = Math.min(100, Math.floor((currentUsage / maxRequests) * 100));

      return {
        venue: input.venue,
        environment: input.environment,
        accountId: input.accountId || null,
        endpointClass: input.endpointClass,
        requestsPerInterval: venueLimit.requestsPerSecond,
        intervalMs: 60000,
        weightPerRequest: 1,
        remaining: state.remaining ?? Math.max(0, maxRequests - currentUsage),
        resetAtMs: state.resetAtMs || null,
        retryAfterMs: state.retryAfterMs || null,
        isWeightBased: venueLimit.isWeightBased,
        scope: input.accountId ? 'ACCOUNT' : 'GLOBAL',
        currentUsage,
        pressure,
      };
    } catch {
      return null;
    }
  }

  normalizeRateLimitResponse(venue: ExchangeVenue, error: any): { code: string; retryAfterMs: number | null; pressure: number } {
    // Normalize venue-specific rate limit errors into safe internal format
    const message = error.message?.toLowerCase() || '';
    const status = error.status || error.statusCode || 0;

    if (status === 429 || message.includes('rate limit') || message.includes('too many requests')) {
      const retryAfter = error.retryAfterMs || this.parseRetryAfterFromHeaders(error.headers || {}) || 1000;
      return { code: 'RATE_LIMITED', retryAfterMs: retryAfter, pressure: 90 };
    }

    if (status === 418 && venue === ExchangeVenue.BINANCE) {
      // Binance IP ban
      return { code: 'IP_BANNED', retryAfterMs: 60000, pressure: 100 };
    }

    return { code: 'UNKNOWN', retryAfterMs: null, pressure: 0 };
  }
}
