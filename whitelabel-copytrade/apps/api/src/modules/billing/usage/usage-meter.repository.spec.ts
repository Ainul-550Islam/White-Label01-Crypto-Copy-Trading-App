import { UsageMeterRepository } from './usage-meter.repository';

const KEY_FIELDS = ['tenantId', 'meterKey', 'scope', 'subjectId', 'periodId'] as const;

/**
 * usageBucket delegate that matches the compound unique key the way
 * PostgreSQL does: by the stored column values, so a row created with a
 * NULL subjectId is never found again by a lookup for ''.
 */
function fakeBuckets() {
  const rows: Array<Record<string, any>> = [];
  const same = (row: Record<string, any>, key: Record<string, any>) =>
    KEY_FIELDS.every((f) => row[f] === key[f]);
  return {
    rows,
    findFirst: jest.fn(async ({ where }: any) => rows.find((r) => same(r, where)) ?? null),
    upsert: jest.fn(async ({ where, create, update }: any) => {
      const key = where.tenantId_meterKey_scope_subjectId_periodId;
      const existing = rows.find((r) => same(r, key));
      if (existing) {
        existing.totalQuantity += update.totalQuantity.increment;
        existing.eventCount += update.eventCount.increment;
        return existing;
      }
      const row = { ...create };
      rows.push(row);
      return row;
    }),
  };
}

const BASE = {
  tenantId: '11111111-1111-1111-1111-111111111111',
  meterKey: 'API_REQUESTS' as any,
  scope: 'TENANT' as any,
  unit: 'request',
  window: 'MONTHLY' as any,
  periodId: '2026-09',
  periodStart: new Date('2026-09-01T00:00:00Z'),
  periodEnd: new Date('2026-10-01T00:00:00Z'),
};

describe('UsageMeterRepository tenant-level buckets', () => {
  let buckets: ReturnType<typeof fakeBuckets>;
  let repo: UsageMeterRepository;

  beforeEach(() => {
    buckets = fakeBuckets();
    const usageEvent = { findFirst: jest.fn(async () => null) };
    repo = new UsageMeterRepository({ usageBucket: buckets, usageEvent } as any);
  });

  it('accumulates repeated tenant-level usage into ONE bucket', async () => {
    await repo.incrementUsageAtomic({
      ...BASE,
      quantity: 2,
      sourceEventId: 's1',
      idempotencyKey: 'k1',
    });
    await repo.incrementUsageAtomic({
      ...BASE,
      quantity: 3,
      sourceEventId: 's2',
      idempotencyKey: 'k2',
    });
    await repo.incrementUsageAtomic({
      ...BASE,
      quantity: 5,
      sourceEventId: 's3',
      idempotencyKey: 'k3',
    });
    expect(buckets.rows).toHaveLength(1);
    expect(buckets.rows[0]).toMatchObject({ totalQuantity: 10, eventCount: 3 });
  });

  it("stores '' (never NULL) as the subject of a tenant-level bucket", async () => {
    await repo.incrementUsageAtomic({
      ...BASE,
      quantity: 1,
      sourceEventId: 's1',
      idempotencyKey: 'k1',
    });
    const call = buckets.upsert.mock.calls[0][0];
    expect(call.create.subjectId).toBe('');
    expect(call.where.tenantId_meterKey_scope_subjectId_periodId.subjectId).toBe('');
  });

  it('reads the running total back through the same key', async () => {
    await repo.incrementUsageAtomic({
      ...BASE,
      quantity: 4,
      sourceEventId: 's1',
      idempotencyKey: 'k1',
    });
    const total = await repo.getCurrentPeriodTotal({ ...BASE });
    expect(total.totalQuantity).toBe(4);
    expect(total.eventCount).toBe(1);
  });

  it('keeps per-subject buckets apart from the tenant-level one', async () => {
    await repo.incrementUsageAtomic({
      ...BASE,
      quantity: 1,
      sourceEventId: 's1',
      idempotencyKey: 'k1',
    });
    await repo.incrementUsageAtomic({
      ...BASE,
      subjectId: 'user-7',
      quantity: 1,
      sourceEventId: 's2',
      idempotencyKey: 'k2',
    });
    expect(buckets.rows.map((r) => r.subjectId).sort()).toEqual(['', 'user-7']);
  });

  it("maps the stored '' back to an absent subjectId in the domain object", async () => {
    const bucket = await repo.incrementUsageAtomic({
      ...BASE,
      quantity: 1,
      sourceEventId: 's1',
      idempotencyKey: 'k1',
    });
    expect(bucket.subjectId).toBeUndefined();
  });
});
