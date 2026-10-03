/**
 * Shared fixtures for the limit specs: limit definitions and an in-memory
 * repository that keeps usage per (limit, entity) the way a store would.
 */
import { LimitRepository } from '../../../apps/api/src/modules/billing/limits/limit.service';
import {
  CreateLimitRequest,
  Limit,
  LimitFilter,
  LimitPeriod,
  LimitResetResult,
  LimitScope,
  LimitStatus,
  LimitType,
  LimitUsage,
  LimitUsageSummary,
  UpdateLimitRequest,
} from '../../../apps/api/src/modules/billing/limits/limit.types';

export const EPOCH = new Date('2026-01-01T00:00:00.000Z');

export function makeLimit(overrides: Partial<Limit> = {}): Limit {
  return {
    id: 'lim-orders',
    tenantId: 'tenant-1',
    key: 'orders_per_day',
    name: 'Orders per day',
    description: 'Maximum orders per day',
    type: LimitType.HARD,
    scope: LimitScope.USER,
    period: LimitPeriod.DAY,
    value: 100,
    unit: 'orders',
    status: LimitStatus.ACTIVE,
    metadata: {},
    createdAt: EPOCH,
    updatedAt: EPOCH,
    ...overrides,
  };
}

export function standardLimits(): Limit[] {
  return [
    makeLimit(),
    makeLimit({
      id: 'lim-value',
      key: 'max_order_value',
      name: 'Max order value',
      value: 10_000,
      unit: 'USD',
    }),
    makeLimit({
      id: 'lim-api',
      key: 'api_requests_per_minute',
      name: 'API rpm',
      type: LimitType.RATE,
      value: 60,
      unit: 'requests',
      period: LimitPeriod.MINUTE,
    }),
    makeLimit({
      id: 'lim-portfolios',
      key: 'max_portfolios',
      name: 'Portfolios',
      type: LimitType.SOFT,
      value: 5,
      unit: 'portfolios',
      period: LimitPeriod.LIFETIME,
    }),
    makeLimit({
      id: 'lim-exchanges',
      key: 'max_exchanges',
      name: 'Exchanges',
      value: -1,
      unit: 'accounts',
      period: LimitPeriod.LIFETIME,
    }),
    makeLimit({
      id: 'lim-suspended',
      key: 'max_strategies',
      name: 'Strategies',
      value: 10,
      unit: 'strategies',
      status: LimitStatus.SUSPENDED,
    }),
    makeLimit({ id: 'lim-other-tenant', tenantId: 'tenant-2', key: 'orders_per_day', value: 1 }),
  ];
}

export class MemoryLimitRepository implements LimitRepository {
  readonly limits = new Map<string, Limit>();
  /** key: `${limitId}|${entityId}` */
  readonly usage = new Map<string, LimitUsage>();
  readonly resetCalls: { limitId: string; entityId: string }[] = [];

  constructor(limits: Limit[] = standardLimits()) {
    for (const l of limits) this.limits.set(l.id, l);
  }

  setUsage(limitId: string, entityId: string, used: number, extra: Partial<LimitUsage> = {}): void {
    const limit = this.limits.get(limitId)!;
    this.usage.set(`${limitId}|${entityId}`, {
      id: `${limitId}-${entityId}`,
      limitId,
      entityId,
      entityType: 'user',
      used,
      remaining: limit.value === -1 ? -1 : limit.value - used,
      metadata: {},
      createdAt: EPOCH,
      updatedAt: EPOCH,
      ...extra,
    });
  }

  async findById(id: string) {
    return this.limits.get(id) ?? null;
  }
  async findByKey(key: string, tenantId: string) {
    return [...this.limits.values()].find((l) => l.key === key && l.tenantId === tenantId) ?? null;
  }
  async findMany(filter: LimitFilter, tenantId: string) {
    return [...this.limits.values()].filter(
      (l) =>
        l.tenantId === tenantId &&
        (!filter.type || l.type === filter.type) &&
        (!filter.status || l.status === filter.status),
    );
  }
  async create(data: CreateLimitRequest, tenantId: string) {
    const row = makeLimit({
      ...data,
      id: `lim-${this.limits.size + 1}`,
      tenantId,
      metadata: data.metadata ?? {},
    });
    this.limits.set(row.id, row);
    return row;
  }
  async update(id: string, data: UpdateLimitRequest) {
    const row = { ...this.limits.get(id)!, ...data } as Limit;
    this.limits.set(id, row);
    return row;
  }
  async delete(id: string) {
    this.limits.delete(id);
  }
  async getUsage(limitId: string, entityId: string) {
    return this.usage.get(`${limitId}|${entityId}`) ?? null;
  }
  async updateUsage(limitId: string, entityId: string, amount: number) {
    const current = this.usage.get(`${limitId}|${entityId}`)?.used ?? 0;
    this.setUsage(limitId, entityId, current + amount);
    return this.usage.get(`${limitId}|${entityId}`)!;
  }
  async resetUsage(limitId: string, entityId: string): Promise<LimitResetResult> {
    this.resetCalls.push({ limitId, entityId });
    const previousUsed = this.usage.get(`${limitId}|${entityId}`)?.used ?? 0;
    this.setUsage(limitId, entityId, 0);
    return { limitId, entityId, previousUsed, resetAt: EPOCH };
  }
  async getUsageSummary(entityId: string, entityType: string): Promise<LimitUsageSummary> {
    const rows = [...this.usage.values()].filter((u) => u.entityId === entityId);
    return {
      entityId,
      entityType,
      limits: rows.map((u) => {
        const limit = this.limits.get(u.limitId)!;
        return {
          limit,
          used: u.used,
          remaining: u.remaining,
          percentage: limit.value > 0 ? (u.used / limit.value) * 100 : 0,
          resetsAt: u.resetAt,
        };
      }),
    };
  }
}
