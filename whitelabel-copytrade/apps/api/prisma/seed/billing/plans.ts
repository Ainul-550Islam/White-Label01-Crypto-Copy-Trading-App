/**
 * Plans Seed Data
 *
 * This file contains seed data for billing plans.
 *
 * Shape note: rows here match the `Plan` model in prisma/schema.prisma.
 * `tenantId` is left null so these are platform-catalogue plans every tenant
 * sees (the same convention `subscription_plans` uses), and the price is the
 * structured object the repository reads and writes as one JSON column.
 */

import { PlanStatus, PlanTier, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SEEDED_BY = 'seed:billing-plans';

export async function seedPlans() {
  console.log('Seeding plans...');

  const plans = [
    {
      id: 'plan-free',
      tenantId: null,
      name: 'Free',
      slug: 'free',
      description: 'Get started with basic trading features',
      tier: PlanTier.free,
      status: PlanStatus.active,
      price: { amount: 0, currency: 'USD', interval: 'monthly', trialDays: 0 },
      metadata: {},
    },
    {
      id: 'plan-basic',
      tenantId: null,
      name: 'Basic',
      slug: 'basic',
      description: 'Perfect for individual traders getting started',
      tier: PlanTier.basic,
      status: PlanStatus.active,
      price: { amount: 29, currency: 'USD', interval: 'monthly', trialDays: 7 },
      metadata: {},
    },
    {
      id: 'plan-standard',
      tenantId: null,
      name: 'Standard',
      slug: 'standard',
      description: 'For serious traders who need more power',
      tier: PlanTier.standard,
      status: PlanStatus.active,
      price: { amount: 79, currency: 'USD', interval: 'monthly', trialDays: 7 },
      metadata: {},
    },
    {
      id: 'plan-premium',
      tenantId: null,
      name: 'Premium',
      slug: 'premium',
      description: 'Advanced features for professional trading teams',
      tier: PlanTier.premium,
      status: PlanStatus.active,
      price: { amount: 199, currency: 'USD', interval: 'monthly', trialDays: 14 },
      metadata: {},
    },
    {
      id: 'plan-enterprise',
      tenantId: null,
      name: 'Enterprise',
      slug: 'enterprise',
      description: 'Custom solutions for large organizations',
      tier: PlanTier.enterprise,
      status: PlanStatus.active,
      price: { amount: 499, currency: 'USD', interval: 'monthly', trialDays: 14 },
      metadata: {},
    },
  ];

  for (const plan of plans) {
    await prisma.plan.upsert({
      where: { id: plan.id },
      update: {
        name: plan.name,
        slug: plan.slug,
        description: plan.description,
        tier: plan.tier,
        status: plan.status,
        price: plan.price,
        metadata: plan.metadata,
        updatedBy: SEEDED_BY,
      },
      create: {
        id: plan.id,
        tenantId: plan.tenantId,
        name: plan.name,
        slug: plan.slug,
        description: plan.description,
        tier: plan.tier,
        status: plan.status,
        price: plan.price,
        metadata: plan.metadata,
        createdBy: SEEDED_BY,
        updatedBy: SEEDED_BY,
      },
    });
  }

  console.log(`Seeded ${plans.length} plans.`);
}

// Allow running directly: `npx ts-node --transpile-only prisma/seed/billing/plans.ts`
if (require.main === module) {
  seedPlans()
    .catch((error) => {
      console.error('Plan seeding failed:', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
