import { InMemoryPrisma } from '../../common/__fixtures__/in-memory-prisma.fixture-spec';
import { ApiKeyRepository } from './api-key.repository';
import { ApiKeyState } from './security.types';

/**
 * ApiKeyRepository.listByTenant merges two stores: EnterpriseApiKey (stored
 * state) and TenantApiKey (state derived from revokedAt / expiresAt). The state
 * filter must apply to both, `total` must count every matching row of both, and
 * pages must be cut from one list ordered by createdAt descending, so paging
 * through the list returns every key exactly once.
 */

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const DAY = 24 * 60 * 60 * 1000;
const at = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY);

describe('ApiKeyRepository', () => {
  let prisma: any;
  let repo: ApiKeyRepository;

  beforeEach(() => {
    prisma = new InMemoryPrisma({ enterpriseApiKey: [['tenantId', 'idempotencyKey']] });
    repo = new ApiKeyRepository(prisma);

    prisma.seed('enterpriseApiKey', { id: 'e-active', tenantId: TENANT, userId: 'u1', state: ApiKeyState.ACTIVE, createdAt: at(2), idempotencyKey: 'k-1' });
    prisma.seed('enterpriseApiKey', { id: 'e-revoked', tenantId: TENANT, userId: 'u2', state: ApiKeyState.REVOKED, createdAt: at(4) });
    prisma.seed('enterpriseApiKey', { id: 'e-rotated', tenantId: TENANT, userId: 'u1', state: ApiKeyState.ROTATED, createdAt: at(7) });
    prisma.seed('enterpriseApiKey', { id: 'e-other', tenantId: OTHER, userId: 'u9', state: ApiKeyState.ACTIVE, createdAt: at(1) });

    prisma.seed('tenantApiKey', { id: 't-active-future', tenantId: TENANT, keyId: 'tk1', createdById: 'u3', revokedAt: null, expiresAt: new Date(Date.now() + DAY), createdAt: at(1) });
    prisma.seed('tenantApiKey', { id: 't-active', tenantId: TENANT, keyId: 'tk2', createdById: null, revokedAt: null, expiresAt: null, createdAt: at(3) });
    prisma.seed('tenantApiKey', { id: 't-revoked', tenantId: TENANT, keyId: 'tk3', createdById: null, revokedAt: at(1), expiresAt: null, createdAt: at(5) });
    prisma.seed('tenantApiKey', { id: 't-expired', tenantId: TENANT, keyId: 'tk4', createdById: null, revokedAt: null, expiresAt: at(1), createdAt: at(6) });
    prisma.seed('tenantApiKey', { id: 't-other', tenantId: OTHER, keyId: 'tk9', createdById: null, revokedAt: null, expiresAt: null, createdAt: at(1) });
  });

  describe('listByTenant', () => {
    it('pages through the merged list in createdAt order, every key exactly once, with the full total', async () => {
      const page1 = await repo.listByTenant(TENANT, { page: 1, limit: 3 });
      const page2 = await repo.listByTenant(TENANT, { page: 2, limit: 3 });
      const page3 = await repo.listByTenant(TENANT, { page: 3, limit: 3 });

      expect(page1.data.map((k) => k.id)).toEqual(['t-active-future', 'e-active', 't-active']);
      expect(page2.data.map((k) => k.id)).toEqual(['e-revoked', 't-revoked', 't-expired']);
      expect(page3.data.map((k) => k.id)).toEqual(['e-rotated']);
      expect([page1.total, page2.total, page3.total]).toEqual([7, 7, 7]);
    });

    it('derives the state of TenantApiKey rows in the list shape', async () => {
      const { data } = await repo.listByTenant(TENANT, { limit: 50 });
      const byId = new Map(data.map((k) => [k.id, k]));
      expect(byId.get('t-active-future')).toMatchObject({ state: ApiKeyState.ACTIVE, userId: 'u3', fingerprint: 'tk1' });
      expect(byId.get('t-active')).toMatchObject({ state: ApiKeyState.ACTIVE, userId: 'unknown' });
      expect(byId.get('t-revoked')).toMatchObject({ state: ApiKeyState.REVOKED });
      expect(byId.get('t-expired')).toMatchObject({ state: ApiKeyState.EXPIRED });
    });

    it.each([
      [ApiKeyState.ACTIVE, ['t-active-future', 'e-active', 't-active']],
      [ApiKeyState.REVOKED, ['e-revoked', 't-revoked']],
      [ApiKeyState.EXPIRED, ['t-expired']],
      [ApiKeyState.ROTATED, ['e-rotated']],
    ])('applies the %s filter to both stores and counts only matching rows', async (state, expected) => {
      const result = await repo.listByTenant(TENANT, { state, limit: 50 });
      expect(result.data.map((k) => k.id)).toEqual(expected);
      expect(result.data.every((k) => k.state === state)).toBe(true);
      expect(result.total).toBe(expected.length);
    });

    it('lists only the enterprise keys of a user when a userId filter is given', async () => {
      const result = await repo.listByTenant(TENANT, { userId: 'u1', limit: 50 });
      expect(result.data.map((k) => k.id)).toEqual(['e-active', 'e-rotated']);
      expect(result.total).toBe(2);
    });

    it("never includes another tenant's keys", async () => {
      const result = await repo.listByTenant(TENANT, { limit: 50 });
      expect(result.data.some((k) => k.tenantId !== TENANT)).toBe(false);
    });

    it('falls back to the enterprise keys alone when TenantApiKey cannot be read', async () => {
      const broken: any = new Proxy(prisma, {
        get: (target, prop) => (prop === 'tenantApiKey' ? { findMany: async () => { throw new Error('unavailable'); }, count: async () => 0 } : target[prop]),
      });
      const result = await new ApiKeyRepository(broken).listByTenant(TENANT, { page: 1, limit: 2 });
      expect(result.data.map((k) => k.id)).toEqual(['e-active', 'e-revoked']);
      expect(result.total).toBe(3);
    });
  });

  describe('tenant-scoped writes', () => {
    it("revoke and updateLastUsed do not touch another tenant's key", async () => {
      await expect(repo.revoke('e-active', OTHER)).resolves.toBeNull();
      await expect(repo.revoke('t-active', OTHER)).resolves.toBeNull();
      await repo.updateLastUsed('e-active', OTHER);
      expect(prisma.rows('enterpriseApiKey').find((k: any) => k.id === 'e-active')).toMatchObject({ state: ApiKeyState.ACTIVE });
      expect(prisma.rows('enterpriseApiKey').find((k: any) => k.id === 'e-active').lastUsedAt).toBeUndefined();
      expect(prisma.rows('tenantApiKey').find((k: any) => k.id === 't-active').revokedAt).toBeNull();

      await expect(repo.revoke('e-active', TENANT)).resolves.toMatchObject({ state: ApiKeyState.REVOKED });
    });

    it("rotate marks only the caller tenant's key as rotated", async () => {
      jest.spyOn(repo, 'create').mockResolvedValue({ id: 'new' } as any);
      await repo.rotate('e-active', { tenantId: OTHER });
      expect(prisma.rows('enterpriseApiKey').find((k: any) => k.id === 'e-active')).toMatchObject({ state: ApiKeyState.ACTIVE });
      await repo.rotate('e-active', { tenantId: TENANT });
      expect(prisma.rows('enterpriseApiKey').find((k: any) => k.id === 'e-active')).toMatchObject({ state: ApiKeyState.ROTATED });
    });
  });
});
