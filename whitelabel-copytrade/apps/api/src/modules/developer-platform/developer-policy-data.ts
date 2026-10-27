import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { DeveloperPolicyDataPort, PlanLimitView } from './developer-policy.service';

/** Read the tenant's actual SubscriptionPlan, under a transaction-local RLS context. */
export function createDeveloperPolicyData(prisma: PrismaService): DeveloperPolicyDataPort {
  return {
    async planLimitViewForTenant(tenantId: string, transaction?: Prisma.TransactionClient): Promise<PlanLimitView> {
      const read = async (tx: Prisma.TransactionClient): Promise<PlanLimitView> => {
        // External sends share a tenant selection lock with subscription writers
        // (enforced by a database trigger). This also serializes an insertion or
        // an update of a different row that becomes the new current plan.
        // Keep the selected plan row locked against grant edits as well. Do
        // not row-lock s here: an UPDATE already holds that row before its
        // trigger waits for the advisory lock, so doing both could deadlock.
        let selectedId: string | undefined;
        if (transaction) {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock_shared(hashtext('wlct.developer.plan-selection'), hashtext(${tenantId}))::text`;
          const selected = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT s.id FROM tenant_subscriptions AS s
            JOIN subscription_plans AS p ON p.id=s.plan_id
            WHERE s.tenant_id=${tenantId}::uuid AND s.status::text IN ('ACTIVE','TRIALING','PAST_DUE')
            ORDER BY s.current_period_start DESC, s.id DESC LIMIT 1 FOR SHARE OF p`;
          if (!selected[0]) return { planKey: 'none', limits: {}, features: [] };
          selectedId = selected[0].id;
        }
        // TenantSubscription references SubscriptionPlan, not the unrelated
        // Plan/PlanFeature catalogue. Read the actual subscribed plan's grants.
        const subscription = await tx.tenantSubscription.findFirst({
          where: { tenantId, status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] }, ...(selectedId ? { id: selectedId } : {}) },
          orderBy: [{ currentPeriodStart: 'desc' }, { id: 'desc' }],
          select: { plan: { select: { id: true, limits: true, features: true } } },
        });
        if (!subscription) return { planKey: 'none', limits: {}, features: [] };
        const raw = subscription.plan.limits;
        const limits: Record<string, number> = {};
        // Marketing copy is not an authority for machine grants. Only typed plan limits can grant developer capabilities.
        const features = new Set(subscription.plan.features.filter((feature) => !feature.startsWith('developer_')));
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
          for (const [key, value] of Object.entries(raw)) {
            if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) limits[key] = value;
            // Machine grants stay separate from the plan's marketing copy. The
            // policy service subsequently recognises only its scope catalogue.
            if (value === true && /^developer_feature_[a-z_]+$/.test(key)) {
              features.add(`developer_${key.slice('developer_feature_'.length)}`);
            }
          }
        }
        return { planKey: subscription.plan.id, limits, features: [...features] };
      };
      return transaction ? read(transaction) : prisma.withTenantRls(tenantId, read);
    },
    async tenantEntitlementKeys(tenantId: string, transaction?: Prisma.TransactionClient): Promise<string[]> {
      const read = async (tx: Prisma.TransactionClient): Promise<string[]> => {
        const rows = await tx.tenantFeatureFlag.findMany({
          where: { tenantId, enabled: true },
          select: { featureFlag: { select: { key: true } } },
        });
        return rows.map((row) => row.featureFlag.key);
      };
      return transaction ? read(transaction) : prisma.withTenantRls(tenantId, read);
    },
  };
}
