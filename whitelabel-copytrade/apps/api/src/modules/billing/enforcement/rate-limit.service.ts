import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { UsageRepository } from './usage.repository';
import type { ApiRequestUsage } from './usage.types';
import {
  EnforcementDecisionCode,
  EnforcementScope,
  type QuotaCheckResult as EnforcementQuotaCheckResult,
} from './enforcement.types';

const WINDOW_SIZE_MS = 60_000;

/**
 * API request-rate limiting service.
 *
 * Enforces the `maxApiRequestsPerMinute` plan limit.  The counter uses a fixed
 * 60-second window aligned to epoch minutes.  Every API request increments the
 * counter atomically; when the configured limit is reached the request is
 * rejected with a `RATE_LIMIT_EXCEEDED` decision.
 *
 * The service is identity-aware: the scopeId is typically the tenant id, but
 * can be a user id or API key hash when finer-grained limiting is required.
 */
@Injectable()
export class RateLimitService {
  constructor(
    private readonly repository: UsageRepository,
    @InjectPinoLogger(RateLimitService.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Check whether a request is within the rate limit and increment the counter
   * atomically.  Returns a machine-readable decision.
   *
   * This method is designed to be called once per API request; the increment
   * and the check are performed in a single Redis round-trip.
   */
  async checkAndIncrement(params: {
    tenantId: string;
    limitKey: string;
    maximum: number | null;
    scopeId: string;
  }): Promise<EnforcementQuotaCheckResult> {
    const { tenantId, limitKey, maximum, scopeId } = params;

    // Unlimited plan
    if (maximum === null) {
      return {
        allowed: true,
        decision: EnforcementDecisionCode.ALLOWED,
        limitKey,
        currentUsage: 0,
        configuredMaximum: null,
        remaining: null,
        scope: EnforcementScope.TENANT,
        scopeId,
      };
    }

    const { windowEpoch, windowStart, windowEnd } = this.currentWindow();
    const windowTtlSeconds = 120;

    const newCount = await this.repository.incrementWindowed({
      tenantId,
      limitKey,
      scopeId,
      windowEpoch,
      windowTtlSeconds,
    });

    if (newCount < 0) {
      // Infrastructure failure — allow the request but log the error.
      this.logger.warn(
        { event: 'rate_limit.counter_unavailable', tenantId, limitKey },
        'Rate limit counter unavailable; allowing request',
      );
      return {
        allowed: true,
        decision: EnforcementDecisionCode.USAGE_UNAVAILABLE,
        limitKey,
        currentUsage: 0,
        configuredMaximum: maximum,
        remaining: maximum,
        scope: EnforcementScope.TENANT,
        scopeId,
        windowStart: windowStart.toISOString(),
        windowEnd: windowEnd.toISOString(),
      };
    }

    const remaining = Math.max(0, maximum - newCount);
    const allowed = newCount <= maximum;

    return {
      allowed,
      decision: allowed
        ? EnforcementDecisionCode.ALLOWED
        : EnforcementDecisionCode.RATE_LIMIT_EXCEEDED,
      limitKey,
      currentUsage: newCount,
      configuredMaximum: maximum,
      remaining,
      scope: EnforcementScope.TENANT,
      scopeId,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      retryAfterSeconds: allowed ? undefined : this.retryAfterSeconds(windowEnd),
      reason: allowed
        ? undefined
        : `Rate limit exceeded: ${newCount}/${maximum} requests in the current window.`,
    };
  }

  /**
   * Read the current request count without incrementing.
   * Useful for diagnostics and status endpoints.
   */
  async getCurrentUsage(params: {
    tenantId: string;
    limitKey: string;
    maximum: number | null;
    scopeId: string;
  }): Promise<EnforcementQuotaCheckResult> {
    const { tenantId, limitKey, maximum, scopeId } = params;
    const { windowEpoch, windowStart, windowEnd } = this.currentWindow();

    const current = await this.repository.getWindowedCurrent({
      tenantId,
      limitKey,
      scopeId,
      windowEpoch,
    });

    const remaining = maximum !== null ? Math.max(0, maximum - current) : null;

    return {
      allowed: maximum === null || current < maximum,
      decision: EnforcementDecisionCode.ALLOWED,
      limitKey,
      currentUsage: current,
      configuredMaximum: maximum,
      remaining,
      scope: EnforcementScope.TENANT,
      scopeId,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private currentWindow(): {
    windowEpoch: number;
    windowStart: Date;
    windowEnd: Date;
  } {
    const now = Date.now();
    const windowEpoch = Math.floor(now / WINDOW_SIZE_MS);
    const windowStart = new Date(windowEpoch * WINDOW_SIZE_MS);
    const windowEnd = new Date(windowStart.getTime() + WINDOW_SIZE_MS);
    return { windowEpoch, windowStart, windowEnd };
  }

  private retryAfterSeconds(windowEnd: Date): number {
    return Math.max(1, Math.ceil((windowEnd.getTime() - Date.now()) / 1000));
  }
}
