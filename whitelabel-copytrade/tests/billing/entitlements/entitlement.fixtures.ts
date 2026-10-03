/**
 * Shared fixtures for the entitlement specs: a representative entitlement and
 * an in-memory repository that records what the service asked it to do.
 */
import { EntitlementRepository } from '../../../apps/api/src/modules/billing/entitlements/entitlement.service';
import {
  Entitlement,
  EntitlementFilter,
  EntitlementSource,
  EntitlementStatus,
  CreateEntitlementRequest,
  UpdateEntitlementRequest,
  UsageRecord,
} from '../../../apps/api/src/modules/billing/entitlements/entitlement.types';

export const DAY = 24 * 60 * 60 * 1000;

export function makeEntitlement(overrides: Partial<Entitlement> = {}): Entitlement {
  return {
    id: 'ent-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    planId: 'plan-premium',
    status: EntitlementStatus.ACTIVE,
    source: EntitlementSource.PLAN,
    features: [
      { key: 'copy_trading', name: 'Copy Trading', enabled: true },
      { key: 'api_access', name: 'API Access', enabled: false },
      { key: 'signals', name: 'Signals', enabled: true, limit: 10, used: 9 },
      { key: 'orders_per_day', name: 'Orders', enabled: true },
    ],
    limits: [
      {
        key: 'orders_per_day',
        name: 'Orders per day',
        value: 100,
        used: 40,
        unit: 'orders',
        hardLimit: true,
      },
      {
        key: 'api_calls',
        name: 'API calls',
        value: 1000,
        used: 950,
        unit: 'calls',
        hardLimit: false,
      },
      {
        key: 'exchanges',
        name: 'Exchanges',
        value: -1,
        used: 12,
        unit: 'accounts',
        hardLimit: true,
      },
    ],
    startsAt: new Date(Date.now() - 30 * DAY),
    metadata: {},
    createdAt: new Date(Date.now() - 30 * DAY),
    updatedAt: new Date(Date.now() - 30 * DAY),
    createdBy: 'admin',
    updatedBy: 'admin',
    ...overrides,
  };
}

/** In-memory repository that records what the service asked it to do. */
export class MemoryEntitlementRepository implements EntitlementRepository {
  readonly rows = new Map<string, Entitlement>();
  readonly usage: { entitlementId: string; record: UsageRecord }[] = [];
  readonly resets: { entitlementId: string; limitKey: string }[] = [];
  readonly created: CreateEntitlementRequest[] = [];

  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async findByUserAndTenant(userId: string, tenantId: string) {
    return (
      [...this.rows.values()].find((e) => e.userId === userId && e.tenantId === tenantId) ?? null
    );
  }
  async findMany(filter: EntitlementFilter) {
    return [...this.rows.values()].filter(
      (e) => !filter.tenantId || e.tenantId === filter.tenantId,
    );
  }
  async create(data: CreateEntitlementRequest) {
    this.created.push(data);
    const row = makeEntitlement({
      id: `ent-${this.rows.size + 1}`,
      tenantId: data.tenantId,
      userId: data.userId,
      planId: data.planId,
      source: data.source,
      startsAt: data.startsAt ?? new Date(),
    });
    this.rows.set(row.id, row);
    return row;
  }
  async update(id: string, data: UpdateEntitlementRequest) {
    const current = this.rows.get(id);
    if (!current) throw new Error('missing');
    const next = { ...current, ...data } as Entitlement;
    this.rows.set(id, next);
    return next;
  }
  async delete(id: string) {
    this.rows.delete(id);
  }
  async recordUsage(entitlementId: string, record: UsageRecord) {
    this.usage.push({ entitlementId, record });
  }
  async resetUsage(entitlementId: string, limitKey: string) {
    this.resets.push({ entitlementId, limitKey });
  }
}
