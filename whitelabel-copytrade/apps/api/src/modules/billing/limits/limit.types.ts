/**
 * Limit Types - Type definitions for billing limits
 * 
 * These types define the structure of limits which control
 * resource usage and rate limiting in the system.
 */

export enum LimitType {
  HARD = 'hard',
  SOFT = 'soft',
  RATE = 'rate',
  BURST = 'burst',
}

export enum LimitScope {
  USER = 'user',
  TENANT = 'tenant',
  ACCOUNT = 'account',
  PORTFOLIO = 'portfolio',
  API_KEY = 'api_key',
}

export enum LimitPeriod {
  MINUTE = 'minute',
  HOUR = 'hour',
  DAY = 'day',
  WEEK = 'week',
  MONTH = 'month',
  YEAR = 'year',
  LIFETIME = 'lifetime',
}

export enum LimitStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  EXCEEDED = 'exceeded',
  RESET_PENDING = 'reset_pending',
}

export interface Limit {
  id: string;
  tenantId: string;
  key: string;
  name: string;
  description: string;
  type: LimitType;
  scope: LimitScope;
  period: LimitPeriod;
  value: number;
  unit: string;
  status: LimitStatus;
  metadata: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
}

export interface LimitUsage {
  id: string;
  limitId: string;
  entityId: string;
  entityType: string;
  used: number;
  remaining: number;
  resetAt?: Date;
  lastUsedAt?: Date;
  metadata: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateLimitRequest {
  key: string;
  name: string;
  description: string;
  type: LimitType;
  scope: LimitScope;
  period: LimitPeriod;
  value: number;
  unit: string;
  metadata?: Record<string, string>;
}

export interface UpdateLimitRequest {
  name?: string;
  description?: string;
  type?: LimitType;
  scope?: LimitScope;
  period?: LimitPeriod;
  value?: number;
  unit?: string;
  status?: LimitStatus;
  metadata?: Record<string, string>;
}

export interface LimitFilter {
  type?: LimitType;
  scope?: LimitScope;
  period?: LimitPeriod;
  status?: LimitStatus;
  search?: string;
}

export interface LimitCheckResult {
  allowed: boolean;
  limit: Limit;
  used: number;
  remaining: number;
  resetsAt?: Date;
  retryAfter?: number;
}

export interface LimitUsageSummary {
  entityId: string;
  entityType: string;
  limits: {
    limit: Limit;
    used: number;
    remaining: number;
    percentage: number;
    resetsAt?: Date;
  }[];
}

export interface RateLimitConfig {
  requests: number;
  window: number;
  burst?: number;
  burstWindow?: number;
}

export interface LimitResetResult {
  limitId: string;
  entityId: string;
  previousUsed: number;
  resetAt: Date;
}