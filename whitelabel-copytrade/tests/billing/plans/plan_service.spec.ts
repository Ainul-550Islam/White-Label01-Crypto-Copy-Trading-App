import { describe, it, expect, beforeEach } from '@jest/globals';
import { PlanService } from '../../../apps/api/src/modules/billing/plans/plan.service';
import { PlanRepository } from '../../../apps/api/src/modules/billing/plans/plan.repository';
import { DEFAULT_PLANS } from '../../../apps/api/src/modules/billing/plans/plan.catalog';
import {
  BillingInterval,
  CreatePlanRequest,
  PlanStatus,
  PlanTier,
} from '../../../apps/api/src/modules/billing/plans/plan.types';

/**
 * The real PlanRepository over a small in-memory stand-in for the Prisma
 * `plan` delegate, so the service AND the repository's tenant scoping are
 * exercised together. `update` honours every field in its unique `where`
 * the way Prisma 5's extended unique filter does.
 */
type Row = Record<string, any>;

class FakePlanDelegate {
  rows: Row[] = [];
  private seq = 0;

  private matches(row: Row, where: Row = {}): boolean {
    return Object.entries(where).every(([k, v]) => {
      if (k === 'OR') return true;
      return row[k] === v;
    });
  }

  async findFirst(args: { where: Row }) {
    return this.rows.find((r) => this.matches(r, args.where)) ?? null;
  }
  async findMany(args: { where: Row; select?: Row }) {
    const rows = this.rows.filter((r) => this.matches(r, args.where));
    if (args.select) {
      return rows.map((r) => ({
        ...r,
        _count: { features: r.features.length, limits: r.limits.length },
      }));
    }
    return rows;
  }
  async create(args: { data: Row }) {
    const { features, limits, ...rest } = args.data;
    const row = {
      id: `plan-${++this.seq}`,
      ...rest,
      features: features.create,
      limits: limits.create,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.rows.push(row);
    return row;
  }
  async update(args: { where: Row; data: Row }) {
    const row = this.rows.find((r) => this.matches(r, args.where));
    if (!row) {
      throw Object.assign(new Error('Record to update not found.'), { code: 'P2025' });
    }
    const { features, limits, ...rest } = args.data;
    Object.assign(row, rest);
    if (features) row.features = features.create;
    if (limits) row.limits = limits.create;
    return row;
  }
  async deleteMany(args: { where: Row }) {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => !this.matches(r, args.where));
    return { count: before - this.rows.length };
  }
  async count(args: { where: Row }) {
    return this.rows.filter((r) => this.matches(r, args.where)).length;
  }
}

function request(overrides: Partial<CreatePlanRequest> = {}): CreatePlanRequest {
  return {
    name: 'Pro',
    slug: 'pro',
    description: 'Pro plan',
    tier: PlanTier.PREMIUM,
    price: { amount: 99, currency: 'USD', interval: BillingInterval.MONTHLY },
    features: [
      {
        key: 'copy_trading',
        name: 'Copy Trading',
        description: 'Copy trades',
        enabled: true,
        limit: 50,
        unit: 'traders',
      },
      { key: 'api_access', name: 'API', description: 'API access', enabled: false },
    ],
    limits: [
      {
        key: 'orders_per_day',
        name: 'Orders',
        description: 'Orders per day',
        value: 500,
        unit: 'orders',
        hardLimit: true,
      },
    ],
    ...overrides,
  };
}

describe('PlanService', () => {
  let delegate: FakePlanDelegate;
  let service: PlanService;

  beforeEach(() => {
    delegate = new FakePlanDelegate();
    const prisma = { plan: delegate } as unknown as ConstructorParameters<typeof PlanRepository>[0];
    service = new PlanService(new PlanRepository(prisma));
  });

  describe('getPlan / getPlanBySlug', () => {
    it('should return plan when found', async () => {
      const created = await service.createPlan(request(), 'tenant-1', 'admin-1');
      const plan = await service.getPlan(created.id, 'tenant-1');
      expect(plan).toMatchObject({
        id: created.id,
        tenantId: 'tenant-1',
        slug: 'pro',
        status: PlanStatus.ACTIVE,
      });
      expect(plan.features).toHaveLength(2);
      expect(plan.limits).toHaveLength(1);
    });

    it('should throw when plan not found', async () => {
      await expect(service.getPlan('missing', 'tenant-1')).rejects.toThrow(
        'Plan not found: missing',
      );
    });

    it("should not find another tenant's plan by id or slug", async () => {
      const created = await service.createPlan(request(), 'tenant-1', 'admin-1');
      await expect(service.getPlan(created.id, 'tenant-2')).rejects.toThrow('Plan not found');
      await expect(service.getPlanBySlug('pro', 'tenant-2')).rejects.toThrow(
        'Plan not found with slug: pro',
      );
    });

    it('should return plan when found by slug', async () => {
      await service.createPlan(request(), 'tenant-1', 'admin-1');
      expect((await service.getPlanBySlug('pro', 'tenant-1')).name).toBe('Pro');
    });
  });

  describe('listPlans', () => {
    it('should return all plans of the tenant, filtered', async () => {
      await service.createPlan(request(), 'tenant-1', 'a');
      await service.createPlan(
        request({ slug: 'basic', name: 'Basic', tier: PlanTier.BASIC }),
        'tenant-1',
        'a',
      );
      await service.createPlan(request(), 'tenant-2', 'b');
      expect(await service.listPlans({}, 'tenant-1')).toHaveLength(2);
      expect(
        (await service.listPlans({ tier: PlanTier.BASIC }, 'tenant-1')).map((p) => p.slug),
      ).toEqual(['basic']);
    });

    it('should summarise active plans with feature and limit counts', async () => {
      await service.createPlan(request(), 'tenant-1', 'a');
      expect(await service.listPlanSummaries('tenant-1')).toEqual([
        expect.objectContaining({
          name: 'Pro',
          tier: PlanTier.PREMIUM,
          featureCount: 2,
          limitCount: 1,
        }),
      ]);
    });
  });

  describe('createPlan', () => {
    it('should create a new plan in the given tenant, recording the creator', async () => {
      const plan = await service.createPlan(request(), 'tenant-1', 'admin-1');
      expect(plan).toMatchObject({
        tenantId: 'tenant-1',
        createdBy: 'admin-1',
        updatedBy: 'admin-1',
      });
    });

    it('should reject an invalid request before touching storage', async () => {
      await expect(
        service.createPlan(request({ slug: 'Not A Slug' }), 'tenant-1', 'a'),
      ).rejects.toThrow(
        'Validation failed: Plan slug must contain only lowercase letters, numbers, and hyphens',
      );
      expect(delegate.rows).toHaveLength(0);
    });

    it('should reject a duplicate slug in the same tenant only', async () => {
      await service.createPlan(request(), 'tenant-1', 'a');
      await expect(service.createPlan(request(), 'tenant-1', 'a')).rejects.toThrow(
        "Plan with slug 'pro' already exists",
      );
      await expect(service.createPlan(request(), 'tenant-2', 'b')).resolves.toMatchObject({
        tenantId: 'tenant-2',
      });
    });
  });

  describe('updatePlan', () => {
    it('should update an existing plan', async () => {
      const created = await service.createPlan(request(), 'tenant-1', 'admin-1');
      const updated = await service.updatePlan(
        created.id,
        { name: 'Pro Max', description: 'More' },
        'tenant-1',
        'admin-2',
      );
      expect(updated).toMatchObject({ name: 'Pro Max', description: 'More', updatedBy: 'admin-2' });
    });

    it('should activate and deactivate a plan through its status', async () => {
      const created = await service.createPlan(request(), 'tenant-1', 'a');
      expect(
        (await service.updatePlan(created.id, { status: PlanStatus.INACTIVE }, 'tenant-1', 'a'))
          .status,
      ).toBe(PlanStatus.INACTIVE);
      expect(await service.listPlanSummaries('tenant-1')).toHaveLength(0);
      expect(
        (await service.updatePlan(created.id, { status: PlanStatus.ACTIVE }, 'tenant-1', 'a'))
          .status,
      ).toBe(PlanStatus.ACTIVE);
    });

    it('should replace features and limits wholesale when provided', async () => {
      const created = await service.createPlan(request(), 'tenant-1', 'a');
      const updated = await service.updatePlan(
        created.id,
        { features: [{ key: 'signals', name: 'Signals', description: 'Signals', enabled: true }] },
        'tenant-1',
        'a',
      );
      expect(updated.features.map((f) => f.key)).toEqual(['signals']);
      expect(updated.limits).toHaveLength(1);
    });

    it('should reject an invalid update and an unknown or foreign plan', async () => {
      const created = await service.createPlan(request(), 'tenant-1', 'a');
      await expect(service.updatePlan(created.id, { name: '' }, 'tenant-1', 'a')).rejects.toThrow(
        'Plan name cannot be empty',
      );
      await expect(service.updatePlan('missing', { name: 'x' }, 'tenant-1', 'a')).rejects.toThrow(
        'Plan not found: missing',
      );
      await expect(
        service.updatePlan(created.id, { name: 'hijack' }, 'tenant-2', 'b'),
      ).rejects.toThrow('Plan not found');
      expect((await service.getPlan(created.id, 'tenant-1')).name).toBe('Pro');
    });

    it('repository update itself is tenant-scoped (no write by id alone)', async () => {
      const created = await service.createPlan(request(), 'tenant-1', 'a');
      const repo = new PlanRepository({ plan: delegate } as unknown as ConstructorParameters<
        typeof PlanRepository
      >[0]);
      await expect(repo.update(created.id, { name: 'hijack' }, 'tenant-2', 'b')).rejects.toThrow(
        'Record to update not found',
      );
      expect(delegate.rows[0].name).toBe('Pro');
    });
  });

  describe('deletePlan', () => {
    it('should delete a plan of the tenant', async () => {
      const created = await service.createPlan(request(), 'tenant-1', 'a');
      await service.deletePlan(created.id, 'tenant-1');
      expect(delegate.rows).toHaveLength(0);
    });

    it("should not delete another tenant's plan", async () => {
      const created = await service.createPlan(request(), 'tenant-1', 'a');
      await expect(service.deletePlan(created.id, 'tenant-2')).rejects.toThrow('Plan not found');
      expect(delegate.rows).toHaveLength(1);
    });
  });

  describe('comparePlans', () => {
    it('should build a feature / limit matrix across plans', async () => {
      const a = await service.createPlan(request(), 'tenant-1', 'x');
      const b = await service.createPlan(
        request({
          slug: 'lite',
          name: 'Lite',
          features: [{ key: 'copy_trading', name: 'Copy', description: 'Copy', enabled: false }],
          limits: [],
        }),
        'tenant-1',
        'x',
      );
      const cmp = await service.comparePlans([a.id, b.id], 'tenant-1');
      expect(cmp.features.sort()).toEqual(['api_access', 'copy_trading']);
      expect(cmp.differences.copy_trading).toEqual({ [a.id]: true, [b.id]: false });
      expect(cmp.differences.orders_per_day).toEqual({ [a.id]: 500, [b.id]: 0 });
    });

    it('should need at least two plans visible to the tenant', async () => {
      const a = await service.createPlan(request(), 'tenant-1', 'x');
      const foreign = await service.createPlan(request(), 'tenant-2', 'y');
      await expect(service.comparePlans([a.id, foreign.id], 'tenant-1')).rejects.toThrow(
        'At least 2 valid plans are required for comparison',
      );
    });
  });

  describe('default plans', () => {
    it('should seed the default catalogue once per tenant', async () => {
      const plans = await service.initializeDefaultPlans('tenant-1', 'system');
      expect(plans.map((p) => p.slug)).toEqual(DEFAULT_PLANS.map((p) => p.slug));
      await expect(service.initializeDefaultPlans('tenant-1', 'system')).rejects.toThrow(
        'Plans already exist for this tenant',
      );
      await expect(service.initializeDefaultPlans('tenant-2', 'system')).resolves.toHaveLength(
        DEFAULT_PLANS.length,
      );
    });

    it('default plans are valid create requests', async () => {
      const { validateCreatePlan } =
        await import('../../../apps/api/src/modules/billing/plans/plan.validation');
      for (const template of await service.getDefaultPlans()) {
        const result = validateCreatePlan({
          name: template.name,
          slug: template.slug,
          description: template.description,
          tier: template.tier,
          price: template.price,
          features: template.features,
          limits: template.limits,
          metadata: template.metadata,
        });
        expect({ slug: template.slug, errors: result.errors }).toEqual({
          slug: template.slug,
          errors: [],
        });
      }
    });
  });
});
