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

  private getCacheKey(venue: ExchangeVenue, environment: ExchangeEnvironment, accountId: string | null, endpointClass: string): string {
    return `exchange:ratelimit:${venue}:${environment}:${accountId || 'global'}:${endpointClass}`;
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
    const weight = input.weight || 1;
    const key = this.getCacheKey(input.venue, input.environment, input.accountId || null, input.endpointClass);

    try {
      // Get current usage from cache
      const current = (await this.cache.get<number>(key)) || 0;

      // Calculate limit based on endpoint class
      let maxRequests: number;
      if (venueLimit.isWeightBased) {
        maxRequests = venueLimit.weightLimitPerMinute;
      } else {
        // For request-count based, use per-second * 60 for minute window
        maxRequests = venueLimit.requestsPerSecond * 60;
      }

      // Endpoint class multipliers - ORDER is more restrictive
      if (input.endpointClass === 'ORDER') {
        maxRequests = Math.floor(maxRequests * 0.5);
      } else if (input.endpointClass === 'PRIVATE') {
        maxRequests = Math.floor(maxRequests * 0.8);
      }

      const newUsage = current + weight;
      const remaining = Math.max(0, maxRequests - newUsage);
      const pressure = Math.min(100, Math.floor((newUsage / maxRequests) * 100));

      if (newUsage > maxRequests) {
        // Rate limited
        const retryAfterMs = 1000; // Simple 1s retry for now, could be calculated from reset time
        this.logger.warn(`Rate limit exceeded venue=${input.venue} env=${input.environment} account=${input.accountId} endpoint=${input.endpointClass} usage=${newUsage}/${maxRequests}`);

        await this.auditService.record({
          tenantId: input.tenantId,
          accountId: input.accountId || 'global',
          venue: input.venue,
          environment: input.environment,
          event: 'RATE_LIMIT_TRIGGERED',
          result: 'SUCCESS',
          safeMetadata: { endpointClass: input.endpointClass, currentUsage: newUsage, maxRequests, pressure, retryAfterMs },
        });

        return { allowed: false, remaining: 0, retryAfterMs, pressure, reason: `Rate limit exceeded for ${input.venue} ${input.endpointClass}` };
      }

      return { allowed: true, remaining, retryAfterMs: null, pressure };
    } catch (e: any) {
      this.logger.warn(`Rate limit check failed venue=${input.venue} error=${e.message} - allowing request to avoid blocking`);
      // Fail open for cache errors, but log
      return { allowed: true, remaining: null, retryAfterMs: null, pressure: 0 };
    }
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
    const key = this.getCacheKey(input.venue, input.environment, input.accountId || null, input.endpointClass);

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

  async getRateLimitState(input: { venue: ExchangeVenue; environment: ExchangeEnvironment; accountId?: string | null; endpointClass: string }): Promise<RateLimitState | null> {
    const key = this.getCacheKey(input.venue, input.environment, input.accountId || null, input.endpointClass);
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
