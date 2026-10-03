import type { PrismaService } from '../../../infrastructure/prisma/prisma.service';

/**
 * Phase 3: the tenant set that platform-wide billing jobs iterate (replaces
 * the "would iterate tenants" placeholders that silently returned []).
 * ACTIVE and SUSPENDED tenants are included - a suspended tenant still has
 * fees, payouts and usage that must reconcile; PENDING (never onboarded) and
 * ARCHIVED tenants are not. Ordered by id so a capped run is deterministic.
 */
export async function listBillableTenantIds(prisma: PrismaService | undefined | null, limit = 1000): Promise<string[]> {
  if (!prisma) {
    // Fail loudly: an empty result would read as "all tenants reconciled".
    throw new Error('Tenant iteration unavailable: PrismaService is not wired into this service');
  }
  const rows = await prisma.tenant.findMany({
    where: { status: { in: ['ACTIVE', 'SUSPENDED'] } },
    select: { id: true },
    orderBy: { id: 'asc' },
    take: Math.max(1, Math.min(limit, 10_000)),
  });
  return rows.map((r) => r.id);
}

/** Run `fn` per tenant; one tenant's failure is reported, never fatal to the run. */
export async function forEachTenant<T>(tenantIds: string[], fn: (tenantId: string) => Promise<T>): Promise<Array<{ tenantId: string; result?: T; error?: string }>> {
  const out: Array<{ tenantId: string; result?: T; error?: string }> = [];
  for (const tenantId of tenantIds) {
    try {
      out.push({ tenantId, result: await fn(tenantId) });
    } catch (e) {
      out.push({ tenantId, error: (e as Error)?.message ?? String(e) });
    }
  }
  return out;
}
