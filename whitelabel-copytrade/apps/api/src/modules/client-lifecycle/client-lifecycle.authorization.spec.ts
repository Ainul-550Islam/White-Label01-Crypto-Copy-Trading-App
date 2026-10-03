import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Permission } from '@wlct/shared-types';
import { ClientLifecycleController } from './client-lifecycle.controller';
import { ClientVisibilityRole } from './account-permission.service';

/**
 * Authorization of the client-lifecycle API (KYC onboarding, institutional
 * accounts, funding and withdrawal requests). Any authenticated user of the
 * tenant reaches these routes, so the controller must keep a client inside
 * their own profile and accounts, and derive administrative roles from the
 * verified JWT permissions.
 */

const TENANT = '11111111-1111-4111-8111-111111111111';
const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ADMIN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const PROFILES: Record<string, { id: string; tenantId: string; externalIdentityRef: string }> = {
  'cp-alice': { id: 'cp-alice', tenantId: TENANT, externalIdentityRef: ALICE },
  'cp-bob': { id: 'cp-bob', tenantId: TENANT, externalIdentityRef: BOB },
};

const ACCOUNTS: Record<string, { id: string; tenantId: string; clientProfileId: string; ownerId: string | null }> = {
  'acc-alice': { id: 'acc-alice', tenantId: TENANT, clientProfileId: 'cp-alice', ownerId: null },
  'acc-bob': { id: 'acc-bob', tenantId: TENANT, clientProfileId: 'cp-bob', ownerId: null },
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

function client(userId: string) {
  return { user: { userId, tenantId: TENANT, permissions: [Permission.PORTFOLIO_READ], roles: ['FOLLOWER'] }, headers: {} };
}

function tenantAdmin() {
  return { user: { userId: ADMIN, tenantId: TENANT, permissions: [Permission.TENANT_UPDATE, Permission.USER_UPDATE], roles: ['TENANT_ADMIN'] }, headers: {} };
}

function compliance() {
  return { user: { userId: ADMIN, tenantId: TENANT, permissions: [Permission.KYC_READ, Permission.KYC_REVIEW], roles: ['COMPLIANCE'] }, headers: {} };
}

describe('ClientLifecycleController authorization', () => {
  let prisma: any;
  let services: Record<string, any>;
  let controller: ClientLifecycleController;

  beforeEach(() => {
    prisma = {
      accountOwnership: { findMany: jest.fn(async () => []) },
      institutionalAccount: {
        findMany: jest.fn(async ({ where }: any) =>
          Object.values(ACCOUNTS).filter(
            (a) =>
              a.tenantId === where.tenantId &&
              (where.OR ?? []).some(
                (c: any) => (c.ownerId && a.ownerId === c.ownerId) || (c.clientProfileId?.in && c.clientProfileId.in.includes(a.clientProfileId)),
              ),
          ),
        ),
      },
      clientOnboarding: {
        findMany: jest.fn(async () => []),
        count: jest.fn(async () => 0),
      },
    };
    const names = [
      'profileService', 'onboardingService', 'workflowService', 'accountStateService', 'ownershipService', 'permissionService',
      'tradingActivationService', 'restrictionService', 'suspensionService', 'closureService', 'exchangeBindingService',
      'portfolioBindingService', 'fundingRequestService', 'withdrawalRequestService', 'fundingApprovalService',
      'fundingReconciliationService', 'reviewService', 'relationshipService', 'notificationService', 'auditService', 'reconciliationService',
    ];
    services = {};
    for (const name of names) services[name] = serviceMock();
    services.profileRepo = { getProfile: jest.fn(async ({ profileId }: any) => PROFILES[profileId] ?? null) };
    services.accountAdminService = serviceMock();
    services.accountAdminService.getAccount.mockImplementation(async ({ accountId }: any) => ACCOUNTS[accountId] ?? null);
    services.visibilityService = {
      resolveVisibleClientProfiles: jest.fn(async ({ userId, role }: any) =>
        role === ClientVisibilityRole.CLIENT
          ? Object.values(PROFILES)
              .filter((p) => p.externalIdentityRef === userId)
              .map((p) => ({ clientProfileId: p.id }))
          : [],
      ),
      canViewClientProfile: jest.fn(async () => false),
      canViewAccount: jest.fn(async () => false),
    };
    controller = new ClientLifecycleController(
      prisma,
      services.profileService,
      services.profileRepo,
      services.onboardingService,
      services.workflowService,
      services.accountAdminService,
      services.accountStateService,
      services.ownershipService,
      services.permissionService,
      services.tradingActivationService,
      services.restrictionService,
      services.suspensionService,
      services.closureService,
      services.exchangeBindingService,
      services.portfolioBindingService,
      services.fundingRequestService,
      services.withdrawalRequestService,
      services.fundingApprovalService,
      services.fundingReconciliationService,
      services.reviewService,
      services.relationshipService,
      services.notificationService,
      services.auditService,
      services.reconciliationService,
      services.visibilityService,
    );
  });

  describe('onboarding (KYC)', () => {
    it("hides another client's onboarding record", async () => {
      services.onboardingService.getOnboarding.mockResolvedValueOnce({ id: 'ob-bob', clientProfileId: 'cp-bob' });
      await expect(controller.getOnboarding(client(ALICE), 'ob-bob')).rejects.toBeInstanceOf(NotFoundException);
      await expect(controller.getOnboardingByClient(client(ALICE), 'cp-bob')).rejects.toBeInstanceOf(NotFoundException);
      await expect(controller.initiateOnboarding(client(ALICE), 'cp-bob')).rejects.toBeInstanceOf(NotFoundException);
      expect(services.onboardingService.initiateOnboarding).not.toHaveBeenCalled();
    });

    it('lets a client read and start their own onboarding', async () => {
      services.onboardingService.getOnboarding.mockResolvedValueOnce({ id: 'ob-alice', clientProfileId: 'cp-alice' });
      await expect(controller.getOnboarding(client(ALICE), 'ob-alice')).resolves.toBeDefined();
      await expect(controller.initiateOnboarding(client(ALICE), 'cp-alice')).resolves.toBeDefined();
    });

    it("restricts a client's onboarding list to their own profiles", async () => {
      await controller.listOnboardings(client(ALICE), {} as any);
      expect(prisma.clientOnboarding.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ clientProfileId: { in: ['cp-alice'] } }) }),
      );
      await expect(controller.listOnboardings(client(ALICE), { clientProfileId: 'cp-bob' } as any)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('keeps the tenant-wide onboarding list for compliance', async () => {
      await controller.listOnboardings(compliance(), {} as any);
      expect(prisma.clientOnboarding.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: TENANT } }));
    });

    it('lets a tenant administrator approve onboarding and never a client', async () => {
      await expect(controller.approveOnboarding(client(ALICE), 'ob-bob')).rejects.toBeInstanceOf(ForbiddenException);
      services.onboardingService.getOnboarding.mockResolvedValueOnce(null);
      await expect(controller.approveOnboarding(tenantAdmin(), 'ob-bob')).resolves.toBeDefined();
      expect(services.onboardingService.approveOnboarding).toHaveBeenCalledWith(expect.objectContaining({ isSelfApproval: false }));
    });
  });

  describe('money requests', () => {
    const request = { requestedAmount: '100', currency: 'USDT' };

    it("rejects a withdrawal or funding request against another client's account", async () => {
      await expect(controller.createWithdrawal(client(ALICE), { ...request, accountId: 'acc-bob' } as any)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(controller.createFunding(client(ALICE), { ...request, accountId: 'acc-bob' } as any)).rejects.toBeInstanceOf(NotFoundException);
      expect(services.withdrawalRequestService.createWithdrawalRequest).not.toHaveBeenCalled();
      expect(services.fundingRequestService.createFundingRequest).not.toHaveBeenCalled();
    });

    it("rejects attributing an own-account request to another client's profile", async () => {
      await expect(
        controller.createWithdrawal(client(ALICE), { ...request, accountId: 'acc-alice', clientProfileId: 'cp-bob' } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('accepts a request on the client’s own account', async () => {
      await expect(controller.createWithdrawal(client(ALICE), { ...request, accountId: 'acc-alice' } as any)).resolves.toBeDefined();
      expect(services.withdrawalRequestService.createWithdrawalRequest).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'acc-alice' }));
    });

    it('filters funding lists to own rows and recomputes the total', async () => {
      services.fundingRequestService.listFundingRequests.mockResolvedValueOnce({
        data: [
          { id: 'f1', accountId: 'acc-alice', clientProfileId: null },
          { id: 'f2', accountId: 'acc-bob', clientProfileId: 'cp-bob' },
        ],
        total: 2,
        page: 1,
        limit: 50,
      });
      const result = await controller.listFunding(client(ALICE), {} as any);
      expect(result.data.map((f: any) => f.id)).toEqual(['f1']);
      expect(result.total).toBe(1);
    });

    it('reads one funding request through the tenant-scoped service lookup', async () => {
      services.fundingRequestService.getFundingRequest.mockResolvedValueOnce({ id: 'f1', tenantId: TENANT, accountId: 'acc-alice', clientProfileId: null });
      const funding = await controller.getFunding(client(ALICE), 'f1');
      expect(funding.id).toBe('f1');
      expect(services.fundingRequestService.getFundingRequest).toHaveBeenCalledWith({ tenantId: TENANT, fundingRequestId: 'f1' });
    });

    it("lets a client read a funding request attributed to their own profile", async () => {
      services.fundingRequestService.getFundingRequest.mockResolvedValueOnce({ id: 'f3', tenantId: TENANT, accountId: 'acc-other', clientProfileId: 'cp-alice' });
      await expect(controller.getFunding(client(ALICE), 'f3')).resolves.toEqual(expect.objectContaining({ id: 'f3' }));
    });

    it("reports another client's funding request exactly like a missing one", async () => {
      services.fundingRequestService.getFundingRequest.mockResolvedValueOnce({ id: 'f2', tenantId: TENANT, accountId: 'acc-bob', clientProfileId: 'cp-bob' });
      const foreign = await controller.getFunding(client(ALICE), 'f2').catch((e: unknown) => e);
      services.fundingRequestService.getFundingRequest.mockResolvedValueOnce(null);
      const missing = await controller.getFunding(client(ALICE), 'f-none').catch((e: unknown) => e);
      expect(foreign).toBeInstanceOf(NotFoundException);
      expect(missing).toBeInstanceOf(NotFoundException);
      expect((foreign as NotFoundException).message).toBe((missing as NotFoundException).message);
    });

    it('lets tenant-wide staff read any funding request of the tenant', async () => {
      services.fundingRequestService.getFundingRequest.mockResolvedValue({ id: 'f2', tenantId: TENANT, accountId: 'acc-bob', clientProfileId: 'cp-bob' });
      await expect(controller.getFunding(tenantAdmin(), 'f2')).resolves.toEqual(expect.objectContaining({ id: 'f2' }));
      await expect(controller.getFunding(compliance(), 'f2')).resolves.toEqual(expect.objectContaining({ id: 'f2' }));
    });

    it('reads one withdrawal request through the tenant-scoped service lookup', async () => {
      services.withdrawalRequestService.getWithdrawalRequest.mockResolvedValueOnce({ id: 'w1', tenantId: TENANT, accountId: 'acc-alice', clientProfileId: null });
      const withdrawal = await controller.getWithdrawal(client(ALICE), 'w1');
      expect(withdrawal.id).toBe('w1');
      expect(services.withdrawalRequestService.getWithdrawalRequest).toHaveBeenCalledWith({ tenantId: TENANT, withdrawalRequestId: 'w1' });
    });

    it('lets a client read a withdrawal request attributed to their own profile', async () => {
      services.withdrawalRequestService.getWithdrawalRequest.mockResolvedValueOnce({ id: 'w3', tenantId: TENANT, accountId: 'acc-other', clientProfileId: 'cp-alice' });
      await expect(controller.getWithdrawal(client(ALICE), 'w3')).resolves.toEqual(expect.objectContaining({ id: 'w3' }));
    });

    it("reports another client's withdrawal request exactly like a missing one", async () => {
      services.withdrawalRequestService.getWithdrawalRequest.mockResolvedValueOnce({ id: 'w2', tenantId: TENANT, accountId: 'acc-bob', clientProfileId: 'cp-bob' });
      const foreign = await controller.getWithdrawal(client(ALICE), 'w2').catch((e: unknown) => e);
      services.withdrawalRequestService.getWithdrawalRequest.mockResolvedValueOnce(null);
      const missing = await controller.getWithdrawal(client(ALICE), 'w-none').catch((e: unknown) => e);
      expect(foreign).toBeInstanceOf(NotFoundException);
      expect(missing).toBeInstanceOf(NotFoundException);
      expect((foreign as NotFoundException).message).toBe((missing as NotFoundException).message);
    });

    it('lets tenant-wide staff read any withdrawal request of the tenant', async () => {
      services.withdrawalRequestService.getWithdrawalRequest.mockResolvedValue({ id: 'w2', tenantId: TENANT, accountId: 'acc-bob', clientProfileId: 'cp-bob' });
      await expect(controller.getWithdrawal(tenantAdmin(), 'w2')).resolves.toEqual(expect.objectContaining({ id: 'w2' }));
      await expect(controller.getWithdrawal(compliance(), 'w2')).resolves.toEqual(expect.objectContaining({ id: 'w2' }));
    });
  });

  describe('accounts, restrictions, relationships and reviews', () => {
    it('keeps account creation for administrators', async () => {
      const dto = { clientProfileId: 'cp-alice', accountType: 'INDIVIDUAL', displayName: 'A' };
      await expect(controller.createAccount(client(ALICE), dto as any)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(controller.createAccount(tenantAdmin(), dto as any)).resolves.toBeDefined();
    });

    it('lets a client create only their own client profile', async () => {
      await expect(controller.createClient(client(ALICE), { externalIdentityRef: ALICE } as any)).resolves.toBeDefined();
      await expect(controller.createClient(client(ALICE), { externalIdentityRef: BOB } as any)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("hides another client's eligibility and ownership", async () => {
      await expect(controller.getEligibility(client(ALICE), 'acc-bob')).rejects.toBeInstanceOf(NotFoundException);
      await expect(controller.listOwnerships(client(ALICE), 'acc-bob', {})).rejects.toBeInstanceOf(NotFoundException);
      await expect(controller.getEligibility(client(ALICE), 'acc-alice')).resolves.toBeDefined();
    });

    it('filters restrictions and relationships to the caller', async () => {
      services.restrictionService.listRestrictions.mockResolvedValueOnce({
        data: [
          { id: 'r1', clientProfileId: 'cp-alice' },
          { id: 'r2', clientProfileId: 'cp-bob' },
        ],
        total: 2,
        page: 1,
        limit: 50,
      });
      const restrictions = await controller.listRestrictions(client(ALICE), {} as any);
      expect(restrictions.data.map((r: any) => r.id)).toEqual(['r1']);
      expect(restrictions.total).toBe(1);

      services.relationshipService.listRelationships.mockResolvedValueOnce({
        data: [
          { id: 'rel1', sourceId: ALICE, targetId: BOB },
          { id: 'rel2', sourceId: BOB, targetId: ADMIN, clientProfileId: 'cp-bob' },
        ],
        total: 2,
        page: 1,
        limit: 50,
      });
      const relationships = await controller.listRelationships(client(ALICE), {} as any);
      expect(relationships.data.map((r: any) => r.id)).toEqual(['rel1']);
    });

    it('keeps review creation for compliance and the tenant owner', async () => {
      await expect(controller.createReview(client(ALICE), { clientProfileId: 'cp-alice', reviewType: 'PERIODIC' } as any)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(controller.createReview(compliance(), { clientProfileId: 'cp-bob', reviewType: 'PERIODIC' } as any)).resolves.toBeDefined();
    });
  });
});
