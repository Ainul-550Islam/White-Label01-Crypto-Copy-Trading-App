import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/** Called while the tenant/owner budget locks are held by a budget writer. */
export async function assertNoActiveCopyIntents(tx: Prisma.TransactionClient, tenantId: string, userId: string): Promise<void> {
  const active = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT i.id FROM "oms_order_intents" i
    LEFT JOIN "trading_accounts" a ON a.id = i.account_id AND a.tenant_id = i.tenant_id
    WHERE i.tenant_id = ${tenantId}::uuid AND i.source = 'COPY_TRADING'
      AND wlct_copy_intent_unresolved(i)
      AND (i.follower_id = ${userId}::uuid OR a.user_id = ${userId}::uuid)
    LIMIT 1`;
  if (active.length > 0) {
    throw new ConflictException({ code: 'COPY_BUDGET_ACTIVE_ORDERS',
      message: 'Resolve active copy orders before changing the copy budget.' });
  }
}

/**
 * Final transactional guard, not an exposure estimate. A configured cap may
 * only authorize orders once complete position evidence and an atomic budget
 * reservation exist. Until then it blocks rather than guessing at the amount.
 * Writers and this reader share migration-backed locks, so a cap cannot be
 * inserted between this decision and the OMS intent commit.
 */
export async function assertCopyBudgetAdmission(tx: Prisma.TransactionClient, tenantId: string, userId: string): Promise<void> {
  const ceilingLock = `copy-budget-ceiling:${tenantId}`;
  const ownerLock = `copy-budget:${tenantId}:${userId}`;
  await tx.$queryRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${ceilingLock}, 0))::text`;
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ownerLock}, 0))::text`;
  const [budget, ceiling] = await Promise.all([
    tx.copyBudget.findFirst({ where: { tenantId, userId }, select: { id: true } }),
    tx.tenantSetting.findFirst({ where: { tenantId, key: 'copy_budget.tenant_ceiling' }, select: { id: true } }),
  ]);
  // A malformed ceiling is still a configured ceiling: it must not be treated
  // as permission to trade. Reads failing also abort the enclosing transaction.
  if (budget || ceiling) {
    throw new ConflictException({ code: 'BLOCKED_EXPOSURE_UNVERIFIED',
      message: 'Copy budget exposure and reservations could not be verified; the order was not created.' });
  }
}
