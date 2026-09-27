/**
 * Policy-driven, backend-enforced rate limiting for developer API traffic.
 *
 * Hierarchy: platform -> tenant -> application -> identity -> endpoint.
 * Every counter lives in the existing Redis infrastructure (an atomic
 * INCR-with-TTL port); internal Redis state never leaves this service —
 * callers receive only the standard RateLimit-* headers. All numbers come
 * from the resolved DeveloperPolicy; there are no hardcoded plan limits.
 */

import { Inject, Injectable } from '@nestjs/common';

import type { DeveloperPolicy } from './developer-policy.service';
import { type RateLimitDecision } from './developer.types';
export type { RateLimitDecision };

/** Minimal atomic counter port — adapter wraps RedisService in the module. */
export interface RateLimitStore {
  /** Increments the key and returns its TTL-met window count. */
  incrementWithin(key: string, windowSeconds: number): Promise<number>;
  /** Remaining TTL of the key's window in seconds (for deterministic reset). */
  ttlSeconds(key: string): Promise<number>;
}

export const DEVELOPER_RATE_LIMIT_STORE = Symbol('DEVELOPER_RATE_LIMIT_STORE');

export interface RateLimitSubject {
  tenantId: string;
  applicationId: string;
  /** User id or token id behind the request. */
  identityId: string;
  endpointClass: string;
  apiVersion: string;
}

@Injectable()
export class ApiRateLimitService {
  constructor(
    @Inject(DEVELOPER_RATE_LIMIT_STORE) private readonly store: RateLimitStore,
  ) {}

  private key(level: RateLimitDecision['tier'], subject: RateLimitSubject, windowEpochMinute: number): string {
    const base = 'devrl';
    switch (level) {
      case 'platform':
        return `${base}:platform:${windowEpochMinute}`;
      case 'tenant':
        return `${base}:tenant:${subject.tenantId}:${windowEpochMinute}`;
      case 'application':
        return `${base}:app:${subject.applicationId}:${windowEpochMinute}`;
      case 'identity':
        return `${base}:ident:${subject.identityId}:${windowEpochMinute}`;
      case 'endpoint':
        return `${base}:ep:${subject.applicationId}:${subject.endpointClass}:${windowEpochMinute}`;
    }
  }

  /**
   * Enforces one level with a specific limit. The window is a fixed minute
   * bucket (floor(epoch/60)) so reset behavior is deterministic: the counter
   * expires at the next minute boundary.
   */
  private async enforceLevel(
    level: RateLimitDecision['tier'],
    limit: number,
    subject: RateLimitSubject,
    nowSeconds: number,
  ): Promise<RateLimitDecision> {
    const windowEpochMinute = Math.floor(nowSeconds / 60);
    const key = this.key(level, subject, windowEpochMinute);
    const count = await this.store.incrementWithin(key, 60);
    const ttl = await this.store.ttlSeconds(key);
    const resetAt = (windowEpochMinute + 1) * 60;
    const remaining = Math.max(0, limit - count);
    const allowed = count <= limit;
    return {
      allowed,
      limit,
      remaining,
      resetAt,
      retryAfterSeconds: allowed ? undefined : Math.max(1, ttl > 0 ? ttl : resetAt - nowSeconds),
      tier: level,
    };
  }

  /**
   * Full hierarchy evaluation. Limits come exclusively from policy: burst on
   * application+identity, sustained on tenant, and a per-endpoint ceiling is
   * derived from burst (endpoint classes may be further limited by policy in
   * future without changing this shape).
   */
  async enforce(
    policy: DeveloperPolicy,
    subject: RateLimitSubject,
    nowSeconds: number,
  ): Promise<RateLimitDecision> {
    // 1. platform guard exists so a runaway tenant cannot starve others.
    const platformLimit = policy.rateLimit.sustainedPerMinute * 1000;
    const platform = await this.enforceLevel('platform', platformLimit, subject, nowSeconds);
    if (!platform.allowed) return platform;

    // 2. sustained per tenant.
    const tenant = await this.enforceLevel('tenant', policy.rateLimit.sustainedPerMinute, subject, nowSeconds);
    if (!tenant.allowed) return tenant;

    // 3. burst per application.
    const application = await this.enforceLevel('application', policy.rateLimit.burstPerMinute, subject, nowSeconds);
    if (!application.allowed) return application;

    // 4. burst per identity.
    const identity = await this.enforceLevel('identity', policy.rateLimit.burstPerMinute, subject, nowSeconds);
    if (!identity.allowed) return identity;

    // 5. per-endpoint class ceiling (same burst budget, independent bucket).
    const endpoint = await this.enforceLevel('endpoint', policy.rateLimit.burstPerMinute, subject, nowSeconds);
    if (!endpoint.allowed) return endpoint;

    // The tightest remaining budget wins for header reporting.
    const tightest = [application, identity, endpoint].sort((a, b) => a.remaining - b.remaining)[0];
    return { ...tightest, allowed: true };
  }

  /** Safe response headers (CHECK 28) — never exposes internal store state. */
  headersFor(decision: RateLimitDecision): Record<string, string> {
    const headers: Record<string, string> = {
      'RateLimit-Limit': String(decision.limit),
      'RateLimit-Remaining': String(decision.remaining),
      'RateLimit-Reset': String(decision.resetAt),
    };
    if (decision.retryAfterSeconds !== undefined) {
      headers['Retry-After'] = String(decision.retryAfterSeconds);
    }
    return headers;
  }
}
