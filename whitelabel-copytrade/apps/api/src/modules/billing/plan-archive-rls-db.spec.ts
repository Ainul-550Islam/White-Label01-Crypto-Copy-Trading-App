/** Opt in only against a disposable, fully migrated PostgreSQL database. */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PlanLimitsDto, UpdatePlanDto } from './dto/plan.dto';
import { PlansService } from './plans.service';

const adminUrl = process.env.BATCH02_TEST_DATABASE_URL;
const rlsUrl = process.env.BATCH02_TEST_RLS_DATABASE_URL;
(adminUrl && rlsUrl ? describe : describe.skip)('plan mutation and archive safety with forced RLS', () => {
  const tenant = randomUUID(), otherTenant = randomUUID(), operator = randomUUID();
  const logger = { info() {}, warn() {}, debug() {}, error() {} };
  const client = (url: string) => new PrismaService({ databaseUrl: url, isProduction: false, databaseReadEnabled: false } as never, logger as never);
  const scope = { tenantId: tenant, isPlatformUser: true };
  const ctx = (key: string) => ({ actorId: operator, auditTenantId: tenant, ipHash: 'test', requestId: 'plan-test', idempotencyKey: key });
  const cache = { delete: jest.fn().mockResolvedValue(undefined) };
  let admin: PrismaService, db: PrismaService, service: PlansService;
  let prior: { relrowsecurity: boolean; relforcerowsecurity: boolean };
  const plans: string[] = [];
  async function makePlan(limits: object = {}): Promise<string> {
    const id = randomUUID(); plans.push(id);
    await admin.subscriptionPlan.create({ data: { id, code: `p-${id}`, name: 'Test', price: '0', limits } });
    return id;
  }
  beforeAll(async () => {
    admin = client(adminUrl!); db = client(rlsUrl!);
    [prior] = await admin.$queryRaw`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'tenant_subscriptions'`;
    await admin.$executeRaw`ALTER TABLE tenant_subscriptions ENABLE ROW LEVEL SECURITY`;
    await admin.$executeRaw`ALTER TABLE tenant_subscriptions FORCE ROW LEVEL SECURITY`;
    await admin.tenant.createMany({ data: [tenant, otherTenant].map((id) => ({ id, slug: `plan-${id}`, name: 'Plan test' })) });
    service = new PlansService(db, cache as never, {} as never);
  });
  afterAll(async () => {
    if (!admin) return;
    await admin.$executeRaw`DELETE FROM audit_logs WHERE tenant_id IN (${tenant}::uuid, ${otherTenant}::uuid)`;
    await admin.tenant.deleteMany({ where: { id: { in: [tenant, otherTenant] } } });
    await admin.subscriptionPlan.deleteMany({ where: { id: { in: plans } } });
    if (prior && !prior.relforcerowsecurity) await admin.$executeRaw`ALTER TABLE tenant_subscriptions NO FORCE ROW LEVEL SECURITY`;
    if (prior && !prior.relrowsecurity) await admin.$executeRaw`ALTER TABLE tenant_subscriptions DISABLE ROW LEVEL SECURITY`;
    await db?.$disconnect(); await admin.$disconnect();
  });
  it('denies archive for a live subscription hidden by tenant RLS', async () => {
    const planId = await makePlan();
    await admin.tenantSubscription.create({ data: { tenantId: otherTenant, planId, status: 'ACTIVE', currentPeriodEnd: new Date(Date.now() + 86400000) } });
    const visible = await db.withTenantRls(tenant, (tx) => tx.tenantSubscription.count({ where: { planId } }));
    expect(visible).toBe(0);
    await expect(service.archive(planId, scope, ctx('hidden-live-plan'))).rejects.toThrow('active subscriptions');
    expect((await admin.subscriptionPlan.findUniqueOrThrow({ where: { id: planId } })).deletedAt).toBeNull();
    await admin.tenantSubscription.updateMany({ where: { planId }, data: { status: 'CANCELED' } });
    await expect(service.archive(planId, scope, ctx('no-live-plan-0001'))).resolves.toEqual({ id: planId, archived: true });
    await expect(db.withTenantRls(otherTenant, (tx) => tx.tenantSubscription.create({ data: { tenantId: otherTenant, planId, status: 'ACTIVE', currentPeriodEnd: new Date(Date.now() + 86400000) } }))).rejects.toThrow();
  });
  it('waits for a concurrent subscription assignment before deciding archive safety', async () => {
    const planId = await makePlan();
    let ready!: () => void, release!: () => void, holderPid = 0;
    const inserted = new Promise<void>((resolve) => { ready = resolve; });
    const mayCommit = new Promise<void>((resolve) => { release = resolve; });
    const subscription = db.withTenantRls(otherTenant, async (tx) => {
      await tx.tenantSubscription.create({ data: { tenantId: otherTenant, planId, status: 'ACTIVE', currentPeriodEnd: new Date(Date.now() + 86400000) } });
      [{ pid: holderPid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      ready(); await mayCommit;
    });
    await inserted;
    const result = expect(service.archive(planId, scope, ctx('concurrent-plan-archive'))).rejects.toThrow('active subscriptions');
    try {
      let blocked = false;
      for (let i = 0; i < 100 && !blocked; i++) {
        const rows = await admin.$queryRaw<Array<{ pid: number }>>`SELECT pid FROM pg_stat_activity WHERE wait_event_type='Lock' AND ${holderPid}=ANY(pg_blocking_pids(pid))`;
        blocked = rows.length > 0;
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(blocked).toBe(true);
    } finally { release(); await subscription; }
    await result;
    expect((await admin.subscriptionPlan.findUniqueOrThrow({ where: { id: planId } })).deletedAt).toBeNull();
  });
  it('fails closed if the definer role cannot see through forced subscription RLS', async () => {
    const planId = await makePlan();
    await admin.$executeRaw`ALTER FUNCTION plan_has_live_subscribers(uuid) OWNER TO batch02_rls`;
    try {
      await expect(service.archive(planId, scope, ctx('unprivileged-definer-1'))).rejects.toThrow();
      expect((await admin.subscriptionPlan.findUniqueOrThrow({ where: { id: planId } })).deletedAt).toBeNull();
    } finally {
      await admin.$executeRaw`ALTER FUNCTION plan_has_live_subscribers(uuid) OWNER TO postgres`;
    }
  });
  it('prevents an assignment racing an already-locked archive', async () => {
    const planId = await makePlan();
    let ready!: () => void, release!: () => void, holderPid = 0;
    const archived = new Promise<void>((resolve) => { ready = resolve; });
    const mayCommit = new Promise<void>((resolve) => { release = resolve; });
    const writer = db.withTenantRls(tenant, async (tx) => {
      await tx.subscriptionPlan.update({ where: { id: planId }, data: { isActive: false, deletedAt: new Date() } });
      [{ pid: holderPid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      ready(); await mayCommit;
    });
    await archived;
    const assignment = db.withTenantRls(otherTenant, (tx) => tx.tenantSubscription.create({ data: { tenantId: otherTenant, planId, status: 'ACTIVE', currentPeriodEnd: new Date(Date.now() + 86400000) } }));
    // Attach the rejection handler before releasing the lock to avoid an unhandled rejection.
    const result = expect(assignment).rejects.toThrow();
    try {
      let blocked = false;
      for (let i = 0; i < 100 && !blocked; i++) {
        const rows = await admin.$queryRaw<Array<{ pid: number }>>`SELECT pid FROM pg_stat_activity WHERE wait_event_type='Lock' AND ${holderPid}=ANY(pg_blocking_pids(pid))`;
        blocked = rows.length > 0;
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(blocked).toBe(true);
    } finally { release(); await writer; }
    await result;
    expect(await admin.tenantSubscription.count({ where: { planId, status: 'ACTIVE' } })).toBe(0);
  });
  it('preserves unsubmitted limits and rejects grant changes outside the platform', async () => {
    const planId = await makePlan({ maxUsers: 5, maxTraders: 3, customDomain: true, developer_applications: 7 });
    const dto = plainToInstance(UpdatePlanDto, { limits: { maxUsers: 8 } });
    expect(await validate(dto)).toHaveLength(0);
    expect(Object.fromEntries(Object.entries(dto.limits!).filter(([, value]) => value !== undefined))).toEqual({ maxUsers: 8 });
    const changed = await service.update(planId, dto, scope, ctx('partial-limits-update'));
    expect(changed.limits).toMatchObject({ maxUsers: 8, maxTraders: 3, customDomain: true, developer_applications: 7 });
    await expect(service.updateGrants(planId, {} as never, { isPlatformUser: false }, ctx('tenant-grants-denied'))).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('confirms submitted provider identifiers and does not disguise a committed write on cache failure', async () => {
    const planId = await makePlan();
    cache.delete.mockRejectedValueOnce(new Error('cache offline'));
    const response = await service.update(planId, { externalPriceId: 'price-test' }, scope, ctx('provider-price-update'));
    expect(response).toMatchObject({ id: planId, externalPriceId: 'price-test' });
    expect((await admin.subscriptionPlan.findUniqueOrThrow({ where: { id: planId } })).externalPriceId).toBe('price-test');
    expect(service.toDto(await admin.subscriptionPlan.findUniqueOrThrow({ where: { id: planId } }))).not.toHaveProperty('externalPriceId');
  });
  it('accepts null for unlimited numeric limits but not nullable boolean grants', async () => {
    const dto = plainToInstance(PlanLimitsDto, { maxUsers: null });
    expect(await validate(dto)).toHaveLength(0);
    expect(Object.fromEntries(Object.entries(dto).filter(([, value]) => value !== undefined))).toEqual({ maxUsers: null });
    for (const key of ['customDomain', 'whiteLabelMobileApp', 'prioritySupport']) {
      expect(await validate(plainToInstance(PlanLimitsDto, { [key]: null }))).not.toHaveLength(0);
    }
  });
});
