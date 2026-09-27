import { Injectable, Logger } from '@nestjs/common';
import { CacheService } from '../../../infrastructure/redis/cache.service';
import { ReportingPeriod } from './revenue-analytics.types';

/**
 * Safe cache/read-through layer for expensive analytics queries using existing Redis/cache infrastructure
 * without becoming a source of truth.
 * Cache key includes tenant/admin scope, metric, period, currency, relevant filters.
 * TTL configurable, invalidate/refresh, fallback to source on failure.
 * Cache is never a source of truth.
 */
@Injectable()
export class AnalyticsCacheService {
  private readonly logger = new Logger(AnalyticsCacheService.name);
  private readonly defaultTtlSeconds: number;

  constructor(private readonly cacheService: CacheService) {
    this.defaultTtlSeconds = parseInt(process.env.ANALYTICS_CACHE_TTL || '300', 10); // 5 min default
  }

  private buildKey(params: {
    scope: string; // tenantId or platform
    metric: string;
    period?: ReportingPeriod;
    currency?: string;
    filters?: Record<string, any>;
  }): string {
    const parts = [
      'analytics',
      params.scope,
      params.metric,
      params.currency || 'ALL',
      params.period ? `${params.period.startDate}_${params.period.endDate}_${params.period.type}` : 'NO_PERIOD',
    ];

    if (params.filters) {
      const filterStr = Object.entries(params.filters)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join('&');
      parts.push(filterStr);
    }

    // Hash long keys to avoid Redis key length issues, but keep readable prefix
    const rawKey = parts.join(':');
    if (rawKey.length > 200) {
      // Simple hash for long keys
      let hash = 0;
      for (let i = 0; i < rawKey.length; i++) {
        const char = rawKey.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash;
      }
      return `${parts.slice(0, 4).join(':')}:hash_${Math.abs(hash)}`;
    }

    return rawKey;
  }

  async get<T>(params: {
    scope: string;
    metric: string;
    period?: ReportingPeriod;
    currency?: string;
    filters?: Record<string, any>;
  }): Promise<T | null> {
    const key = this.buildKey(params);
    try {
      const cached = await this.cacheService.get<T>(key);
      if (cached) {
        this.logger.debug(`Cache hit for analytics key=${key}`);
      }
      return cached;
    } catch (e: any) {
      this.logger.warn(`Cache get failed for key=${key}: ${e.message}, falling back to source`);
      return null;
    }
  }

  async set<T>(params: {
    scope: string;
    metric: string;
    period?: ReportingPeriod;
    currency?: string;
    filters?: Record<string, any>;
    ttlSeconds?: number;
  }, value: T): Promise<void> {
    const key = this.buildKey(params);
    const ttl = params.ttlSeconds || this.defaultTtlSeconds;
    try {
      await this.cacheService.set(key, value, ttl);
      this.logger.debug(`Cache set for analytics key=${key} ttl=${ttl}s`);
    } catch (e: any) {
      this.logger.warn(`Cache set failed for key=${key}: ${e.message}, continuing without cache`);
      // Never throw - cache failure must not break source computation
    }
  }

  async remember<T>(params: {
    scope: string;
    metric: string;
    period?: ReportingPeriod;
    currency?: string;
    filters?: Record<string, any>;
    ttlSeconds?: number;
  }, factory: () => Promise<T>): Promise<T> {
    const key = this.buildKey(params);
    const ttl = params.ttlSeconds || this.defaultTtlSeconds;

    try {
      // Try cache first
      const cached = await this.cacheService.get<T>(key);
      if (cached !== null) {
        return cached;
      }
    } catch (e: any) {
      this.logger.warn(`Cache read failed for key=${key}: ${e.message}, computing from source`);
      // Fall through to factory
      return factory();
    }

    try {
      const value = await factory();
      // Try to cache, but don't fail if cache unavailable
      try {
        await this.cacheService.set(key, value, ttl);
      } catch (e: any) {
        this.logger.warn(`Cache write failed for key=${key}: ${e.message}`);
      }
      return value;
    } catch (e) {
      // Factory failed - rethrow, don't cache failure
      throw e;
    }
  }

  async invalidateScope(scope: string): Promise<number> {
    try {
      const pattern = `analytics:${scope}:*`;
      const deleted = await this.cacheService.deleteByPattern(pattern);
      this.logger.log(`Invalidated ${deleted} analytics cache keys for scope=${scope}`);
      return deleted;
    } catch (e: any) {
      this.logger.warn(`Cache invalidation failed for scope=${scope}: ${e.message}`);
      return 0;
    }
  }

  async invalidateMetric(metric: string): Promise<number> {
    try {
      const pattern = `analytics:*:${metric}:*`;
      const deleted = await this.cacheService.deleteByPattern(pattern);
      this.logger.log(`Invalidated ${deleted} analytics cache keys for metric=${metric}`);
      return deleted;
    } catch (e: any) {
      this.logger.warn(`Cache invalidation failed for metric=${metric}: ${e.message}`);
      return 0;
    }
  }

  async invalidateAll(): Promise<number> {
    try {
      const deleted = await this.cacheService.deleteByPattern('analytics:*');
      this.logger.log(`Invalidated ${deleted} analytics cache keys (all)`);
      return deleted;
    } catch (e: any) {
      this.logger.warn(`Cache invalidation failed for all analytics: ${e.message}`);
      return 0;
    }
  }

  async deleteKey(params: {
    scope: string;
    metric: string;
    period?: ReportingPeriod;
    currency?: string;
    filters?: Record<string, any>;
  }): Promise<void> {
    const key = this.buildKey(params);
    try {
      await this.cacheService.delete(key);
    } catch (e: any) {
      this.logger.warn(`Cache delete failed for key=${key}: ${e.message}`);
    }
  }
}
