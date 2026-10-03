import { InMemoryPrisma } from '../../common/__fixtures__/in-memory-prisma.fixture-spec';
import { StatementService } from './statement.service';

/**
 * GET portfolio-accounting/statements validated `state` (StatementQueryDto)
 * but never passed it on: a client asking for FINAL statements got all of
 * them, drafts included.
 */
describe('StatementService.listStatements', () => {
  function build() {
    const findMany = jest.fn(async () => []);
    const count = jest.fn(async () => 0);
    const service = new (StatementService as any)({ portfolioStatement: { findMany, count } }) as StatementService;
    return { service, findMany, count };
  }

  it('applies the state filter to both the page and the total', async () => {
    const { service, findMany, count } = build();
    await service.listStatements({ tenantId: 't1', profileId: 'p1', state: 'FINAL' });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 't1', profileId: 'p1', state: 'FINAL' } }));
    expect(count).toHaveBeenCalledWith({ where: { tenantId: 't1', profileId: 'p1', state: 'FINAL' } });
  });

  it('no state -> no state filter', async () => {
    const { service, findMany } = build();
    await service.listStatements({ tenantId: 't1' });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 't1' } }));
  });
});

/**
 * The visibility restriction of a non-owner caller (profileIds) is part of the WHERE clause:
 * it is applied BEFORE skip/take, so pages are full and the total counts the visible rows.
 * Filtering one page afterwards (the previous controller behaviour) returned short or empty
 * pages and a total equal to the page length.
 */
describe('StatementService.listStatements visibility restriction', () => {
  const TENANT = 't1';

  function seeded() {
    const prisma: any = new InMemoryPrisma();
    // 6 statements of other profiles are NEWER than the 3 visible ones, so a page-then-filter
    // implementation would return an empty first page.
    for (let i = 0; i < 6; i++) {
      prisma.seed('portfolioStatement', { id: `other-${i}`, tenantId: TENANT, profileId: 'p-other', createdAt: new Date(Date.UTC(2026, 5, 20 + i)) });
    }
    for (let i = 0; i < 3; i++) {
      prisma.seed('portfolioStatement', { id: `own-${i}`, tenantId: TENANT, profileId: 'p-own', createdAt: new Date(Date.UTC(2026, 5, 1 + i)) });
    }
    return new (StatementService as any)(prisma) as StatementService;
  }

  it('applies profileIds before pagination: full pages and a total of the visible rows', async () => {
    const service = seeded();
    const first = await service.listStatements({ tenantId: TENANT, profileIds: ['p-own'], page: 1, limit: 2 });
    expect(first.data.map((s: any) => s.id)).toEqual(['own-2', 'own-1']);
    expect(first.total).toBe(3);
    const second = await service.listStatements({ tenantId: TENANT, profileIds: ['p-own'], page: 2, limit: 2 });
    expect(second.data.map((s: any) => s.id)).toEqual(['own-0']);
    expect(second.total).toBe(3);
  });

  it('an empty visibility set returns nothing', async () => {
    const result = await seeded().listStatements({ tenantId: TENANT, profileIds: [], page: 1, limit: 10 });
    expect(result).toMatchObject({ data: [], total: 0 });
  });

  it('a requested profile outside the visibility set returns nothing', async () => {
    const result = await seeded().listStatements({ tenantId: TENANT, profileId: 'p-other', profileIds: ['p-own'] });
    expect(result).toMatchObject({ data: [], total: 0 });
  });

  it('a requested profile inside the visibility set is listed alone', async () => {
    const result = await seeded().listStatements({ tenantId: TENANT, profileId: 'p-own', profileIds: ['p-own', 'p-x'] });
    expect(result.total).toBe(3);
    expect(new Set(result.data.map((s: any) => s.profileId))).toEqual(new Set(['p-own']));
  });

  it('no restriction (tenant-wide reader) lists every profile', async () => {
    const result = await seeded().listStatements({ tenantId: TENANT, page: 1, limit: 50 });
    expect(result.total).toBe(9);
  });
});
