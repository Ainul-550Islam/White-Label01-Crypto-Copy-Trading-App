import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { SYSTEM_ROLE_DEFINITIONS, SystemRole } from '@wlct/shared-types';
import { PortfolioAccountingController } from './portfolio-accounting.controller';
import { InvestorVisibilityRole } from './investor-visibility.service';

/**
 * Authorization of the portfolio-accounting API. Every route is reachable by
 * any authenticated user of the tenant, so the controller itself must keep
 * followers inside their own profiles and keep ledger writes for tenant
 * administrators.
 */

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222';
const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ADMIN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CAROL = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const PROFILES: Record<string, { id: string; tenantId: string; scope: string; scopeId: string }> = {
  'p-alice': { id: 'p-alice', tenantId: TENANT, scope: 'FOLLOWER', scopeId: ALICE },
  'p-bob': { id: 'p-bob', tenantId: TENANT, scope: 'FOLLOWER', scopeId: BOB },
  'p-foreign': { id: 'p-foreign', tenantId: OTHER_TENANT, scope: 'FOLLOWER', scopeId: ALICE },
};

function serviceMock(): any {
  const target: Record<string | symbol, jest.Mock> = {};
  return new Proxy(target, {
    get: (store, key) => {
      if (!store[key]) store[key] = jest.fn().mockResolvedValue({ id: 'result', data: [], total: 0, page: 1, limit: 50 });
      return store[key];
    },
  });
}

/** Principals carry the real system-role permission sets, not hand-picked ones. */
function principal(userId: string, role: SystemRole) {
  const definition = SYSTEM_ROLE_DEFINITIONS.find((d) => d.key === role);
  if (!definition) throw new Error(`unknown role ${role}`);
  return { user: { userId, tenantId: TENANT, permissions: [...definition.permissions] as string[], roles: [role] }, headers: {} };
}

function follower(userId: string) {
  return principal(userId, SystemRole.FOLLOWER);
}

function trader(userId: string) {
  return principal(userId, SystemRole.TRADER);
}

function tenantAdmin() {
  return principal(ADMIN, SystemRole.TENANT_ADMIN);
}

function finance() {
  return principal(ADMIN, SystemRole.FINANCE);
}

function compliance() {
  return principal(ADMIN, SystemRole.COMPLIANCE);
}

/** Mimics StatementService.listStatements: the visibility restriction is part of the query. */
function pageOfStatements(rows: Array<{ id: string; profileId: string }>, params: { profileIds?: string[] }) {
  const visible = params.profileIds ? rows.filter((row) => params.profileIds!.includes(row.profileId)) : rows;
  return { data: visible, total: visible.length, page: 1, limit: 50 };
}

describe('PortfolioAccountingController authorization', () => {
  let prisma: any;
  let visibility: any;
  let services: Record<string, any>;
  let controller: PortfolioAccountingController;

  beforeEach(() => {
    prisma = {
      portfolioAccountingProfile: {
        findFirst: jest.fn(async ({ where }: any) => PROFILES[where.id] ?? null),
        findMany: jest.fn(async ({ where }: any) =>
          Object.values(PROFILES).filter((p) => p.tenantId === where.tenantId && (!where.id?.in || where.id.in.includes(p.id))),
        ),
      },
    };
    visibility = {
      resolveVisibleProfiles: jest.fn(async ({ userId, role }: any) => {
        if (role === InvestorVisibilityRole.FOLLOWER) {
          return Object.values(PROFILES)
            .filter((p) => p.tenantId === TENANT && p.scope === 'FOLLOWER' && p.scopeId === userId)
            .map((p) => ({ profileId: p.id }));
        }
        return [];
      }),
      canViewStatement: jest.fn(async () => false),
    };
    services = {};
    const names = [
      'policyService', 'eventService', 'eventRepo', 'cashLedger', 'positionAccounting', 'costBasis', 'valuation', 'navService',
      'pnlService', 'performanceService', 'benchmarkService', 'attributionService', 'snapshotService', 'periodService',
      'periodCloseService', 'statementService', 'exportService', 'reconciliationService', 'adjustmentService', 'auditService',
    ];
    for (const name of names) services[name] = serviceMock();
    controller = new PortfolioAccountingController(
      prisma,
      services.policyService,
      services.eventService,
      services.eventRepo,
      services.cashLedger,
      services.positionAccounting,
      services.costBasis,
      services.valuation,
      services.navService,
      services.pnlService,
      services.performanceService,
      services.benchmarkService,
      services.attributionService,
      services.snapshotService,
      services.periodService,
      services.periodCloseService,
      services.statementService,
      services.exportService,
      services.reconciliationService,
      services.adjustmentService,
      visibility,
      services.auditService,
    );
  });

  describe('profile reads', () => {
    it('lets a follower read the holdings of their own profile', async () => {
      await expect(controller.getHoldings(follower(ALICE), { profileId: 'p-alice' } as any)).resolves.toBeDefined();
    });

    it("hides another follower's profile of the same tenant as 404", async () => {
      await expect(controller.getHoldings(follower(ALICE), { profileId: 'p-bob' } as any)).rejects.toBeInstanceOf(NotFoundException);
      await expect(controller.getNav(follower(ALICE), { profileId: 'p-bob' } as any)).rejects.toBeInstanceOf(NotFoundException);
      await expect(controller.getPnl(follower(ALICE), { profileId: 'p-bob' } as any)).rejects.toBeInstanceOf(NotFoundException);
      await expect(controller.listCash(follower(ALICE), { profileId: 'p-bob' } as any)).rejects.toBeInstanceOf(NotFoundException);
      await expect(controller.listPositions(follower(ALICE), { profileId: 'p-bob' } as any)).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        controller.getPerformance(follower(ALICE), { profileId: 'p-bob', periodStart: '2026-01-01', periodEnd: '2026-02-01' } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        controller.getAttribution(follower(ALICE), { profileId: 'p-bob', periodStart: '2026-01-01', periodEnd: '2026-02-01' } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(services.positionAccounting.getHoldings).not.toHaveBeenCalled();
    });

    it('answers 404 for a profile of another tenant, even for a tenant administrator', async () => {
      await expect(controller.getHoldings(tenantAdmin(), { profileId: 'p-foreign' } as any)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('never skips the tenant check when the profile lookup fails', async () => {
      prisma.portfolioAccountingProfile.findFirst.mockRejectedValueOnce(new Error('invalid input syntax for type uuid'));
      await expect(controller.getHoldings(tenantAdmin(), { profileId: 'not-a-uuid' } as any)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lets tenant staff (finance, compliance, tenant admin) read any profile of their tenant', async () => {
      await expect(controller.getHoldings(finance(), { profileId: 'p-bob' } as any)).resolves.toBeDefined();
      await expect(controller.getHoldings(compliance(), { profileId: 'p-bob' } as any)).resolves.toBeDefined();
      await expect(controller.getHoldings(tenantAdmin(), { profileId: 'p-alice' } as any)).resolves.toBeDefined();
    });

    it('keeps a trader inside their own profiles although the TRADER role holds report:read', async () => {
      await expect(controller.getHoldings(trader(CAROL), { profileId: 'p-bob' } as any)).rejects.toBeInstanceOf(NotFoundException);
      await expect(controller.getNav(trader(CAROL), { profileId: 'p-alice' } as any)).rejects.toBeInstanceOf(NotFoundException);
      await expect(controller.listEvents(trader(CAROL), {} as any)).rejects.toBeInstanceOf(BadRequestException);
      const profiles = await controller.listProfiles(trader(CAROL), {} as any);
      expect(profiles.data).toEqual([]);

      services.statementService.getStatement.mockResolvedValueOnce({ id: 'st1', profileId: 'p-bob' });
      await expect(controller.getStatement(trader(CAROL), 'st1')).rejects.toBeInstanceOf(NotFoundException);
      services.statementService.listStatements.mockImplementationOnce(async (params: any) =>
        pageOfStatements([{ id: 'st-b', profileId: 'p-bob' }], params),
      );
      const statements = await controller.listStatements(trader(CAROL), {} as any);
      expect(services.statementService.listStatements).toHaveBeenLastCalledWith(expect.objectContaining({ profileIds: [] }));
      expect(statements).toMatchObject({ data: [], total: 0 });
      expect(services.positionAccounting.getHoldings).not.toHaveBeenCalled();
    });

    it('answers 404 (not 400) for an unknown statement id', async () => {
      services.statementService.getStatement.mockResolvedValueOnce(null);
      await expect(controller.getStatement(tenantAdmin(), 'missing')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lists only the profiles a follower owns', async () => {
      const own = await controller.listProfiles(follower(ALICE), {} as any);
      expect(own.data.map((p: any) => p.id)).toEqual(['p-alice']);
      const all = await controller.listProfiles(tenantAdmin(), {} as any);
      expect(all.data.map((p: any) => p.id).sort()).toEqual(['p-alice', 'p-bob']);
    });

    it('requires a follower to name an owned profile on list endpoints', async () => {
      await expect(controller.listEvents(follower(ALICE), {} as any)).rejects.toBeInstanceOf(BadRequestException);
      await expect(controller.listSnapshots(follower(ALICE), {} as any)).rejects.toBeInstanceOf(BadRequestException);
      await expect(controller.listPeriods(follower(ALICE), {} as any)).rejects.toBeInstanceOf(BadRequestException);
      await expect(controller.listAdjustments(follower(ALICE), {} as any)).rejects.toBeInstanceOf(BadRequestException);
      await expect(controller.listReconciliations(follower(ALICE), {} as any)).rejects.toBeInstanceOf(BadRequestException);
      await expect(controller.listEvents(follower(ALICE), { profileId: 'p-bob' } as any)).rejects.toBeInstanceOf(NotFoundException);
      await controller.listEvents(follower(ALICE), { profileId: 'p-alice' } as any);
      expect(services.eventRepo.listEvents).toHaveBeenCalledWith(expect.objectContaining({ profileId: 'p-alice' }));
    });

    it('keeps tenant-wide lists for tenant staff', async () => {
      await controller.listEvents(finance(), {} as any);
      expect(services.eventRepo.listEvents).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT, profileId: undefined }));
    });

    it("hides another follower's snapshot, statement and export", async () => {
      services.snapshotService.getSnapshot.mockResolvedValueOnce({ id: 's1', profileId: 'p-bob' });
      await expect(controller.getSnapshot(follower(ALICE), 's1')).rejects.toBeInstanceOf(NotFoundException);

      services.statementService.getStatement.mockResolvedValueOnce({ id: 'st1', profileId: 'p-bob' });
      await expect(controller.getStatement(follower(ALICE), 'st1')).rejects.toBeInstanceOf(NotFoundException);

      services.statementService.getStatement.mockResolvedValueOnce({ id: 'st1', profileId: 'p-bob' });
      await expect(controller.exportStatement(follower(ALICE), 'st1', 'CSV')).rejects.toBeInstanceOf(NotFoundException);
      expect(services.exportService.exportStatementCsv).not.toHaveBeenCalled();
    });

    it('restricts statement lists to owned profiles inside the query, so the total counts visible rows only', async () => {
      services.statementService.listStatements.mockImplementationOnce(async (params: any) =>
        pageOfStatements(
          [
            { id: 'st-a', profileId: 'p-alice' },
            { id: 'st-b', profileId: 'p-bob' },
          ],
          params,
        ),
      );
      const result = await controller.listStatements(follower(ALICE), {} as any);
      expect(services.statementService.listStatements).toHaveBeenLastCalledWith(expect.objectContaining({ profileIds: ['p-alice'] }));
      expect(result.data.map((s: any) => s.id)).toEqual(['st-a']);
      expect(result.total).toBe(1);
    });

    it('does not restrict statement lists for tenant-wide readers', async () => {
      services.statementService.listStatements.mockImplementationOnce(async (params: any) =>
        pageOfStatements(
          [
            { id: 'st-a', profileId: 'p-alice' },
            { id: 'st-b', profileId: 'p-bob' },
          ],
          params,
        ),
      );
      const result = await controller.listStatements(tenantAdmin(), {} as any);
      expect(services.statementService.listStatements).toHaveBeenLastCalledWith(expect.objectContaining({ profileIds: undefined }));
      expect(result.total).toBe(2);
    });
  });

  describe('ledger writes', () => {
    const periodDto = { profileId: 'p-alice', periodStart: '2026-01-01', periodEnd: '2026-02-01', periodType: 'MONTHLY' };

    it('rejects every ledger-changing call from a follower, even on their own profile', async () => {
      await expect(controller.createSnapshot(follower(ALICE), { profileId: 'p-alice' } as any)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(controller.createPeriod(follower(ALICE), periodDto as any)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(controller.closePeriod(follower(ALICE), { periodId: 'period-1' } as any)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(controller.generateStatement(follower(ALICE), { profileId: 'p-alice', periodId: 'period-1' } as any)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(
        controller.createAdjustment(follower(ALICE), { profileId: 'p-alice', adjustmentType: 'CORRECTION', reason: 'x' } as any),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(controller.runReconciliation(follower(ALICE), { profileId: 'p-alice' } as any)).rejects.toBeInstanceOf(ForbiddenException);
      expect(services.adjustmentService.createAdjustment).not.toHaveBeenCalled();
      expect(services.periodCloseService.initiateClose).not.toHaveBeenCalled();
    });

    it('rejects ledger writes from report-only roles such as finance', async () => {
      await expect(
        controller.createAdjustment(finance(), { profileId: 'p-alice', adjustmentType: 'CORRECTION', reason: 'x' } as any),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets a tenant administrator write the ledger', async () => {
      services.adjustmentService.createAdjustment.mockResolvedValueOnce({ id: 'adj-1' });
      await expect(
        controller.createAdjustment(tenantAdmin(), { profileId: 'p-bob', adjustmentType: 'CORRECTION', reason: 'x' } as any),
      ).resolves.toBeDefined();
      services.periodService.getPeriod.mockResolvedValueOnce({ id: 'period-1', profileId: 'p-bob' });
      services.periodCloseService.initiateClose.mockResolvedValueOnce({ id: 'period-1', nav: '1' });
      await expect(controller.closePeriod(tenantAdmin(), { periodId: 'period-1' } as any)).resolves.toBeDefined();
    });
  });

  describe('profile creation', () => {
    it('lets a follower create their own follower profile', async () => {
      await expect(controller.createProfile(follower(ALICE), { scope: 'FOLLOWER', scopeId: ALICE } as any)).resolves.toBeDefined();
    });

    it('rejects a follower creating a profile for someone else or a tenant-level profile', async () => {
      await expect(controller.createProfile(follower(ALICE), { scope: 'FOLLOWER', scopeId: BOB } as any)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(controller.createProfile(follower(ALICE), { scope: 'TENANT', scopeId: TENANT } as any)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(services.policyService.createOrUpdateProfile).not.toHaveBeenCalled();
    });
  });
});
