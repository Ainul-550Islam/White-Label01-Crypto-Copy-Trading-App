// # Responsibility: verifies trader-profile ownership disclosure is derived from the authenticated principal and never from request filters.

import { CopyTradingController } from './copy-trading.controller';

const TENANT_ID = 'tenant-1';
const TRADER_ID = 'trader-profile-1';
const OWNER_ID = 'trader-owner-1';

function buildController() {
  const controller = Object.create(CopyTradingController.prototype) as CopyTradingController;
  const traderProfileService = {
    getProfile: jest.fn(async () => ({
      traderId: TRADER_ID,
      tenantId: TENANT_ID,
      userId: OWNER_ID,
      riskProfile: { internalAssessment: 'not-public' },
      isPublic: true,
      displayName: 'Public trader',
    })),
    getSafePublicStatistics: jest.fn(async () => ({ activeFollowers: { status: 'UNAVAILABLE', value: null } })),
    listPublicProfiles: jest.fn(async () => ({
      data: [{
        traderId: TRADER_ID,
        tenantId: TENANT_ID,
        userId: OWNER_ID,
        riskProfile: { internalAssessment: 'not-public' },
        isPublic: true,
        displayName: 'Public trader',
      }],
      total: 1,
    })),
  };
  Reflect.set(controller, 'traderProfileService', traderProfileService);
  return { controller, traderProfileService };
}

describe('CopyTradingController.getTraderProfile viewer ownership flag', () => {
  test('marks the profile owner only when the authenticated user owns the tenant-scoped profile', async () => {
    const { controller, traderProfileService } = buildController();

    const response = await controller.getTraderProfile({
      user: { tenantId: TENANT_ID, userId: OWNER_ID },
      query: { userId: 'attacker-selected-user' },
    }, TRADER_ID);

    expect(traderProfileService.getProfile).toHaveBeenCalledWith(TENANT_ID, TRADER_ID);
    expect(response.viewerIsOwner).toBe(true);
    expect(response.publicMetrics).toBeTruthy();
    expect(response).not.toHaveProperty('userId');
    expect(response).not.toHaveProperty('tenantId');
    expect(response).not.toHaveProperty('riskProfile');
    expect(response).not.toHaveProperty('updatedAt');
  });

  test('keeps a public profile non-owner view-only for another authenticated tenant member', async () => {
    const { controller } = buildController();

    const response = await controller.getTraderProfile({
      user: { tenantId: TENANT_ID, userId: 'other-tenant-user' },
    }, TRADER_ID);

    expect(response.viewerIsOwner).toBe(false);
    expect(response.traderId).toBe(TRADER_ID);
    expect(response).not.toHaveProperty('userId');
  });

  test('projects public trader listings without serializing tenant or owner identity', async () => {
    const { controller, traderProfileService } = buildController();

    const response = await controller.listTraders({
      user: { tenantId: TENANT_ID, userId: 'other-tenant-user' },
    }, {});
    const listedProfile = response.data[0];

    expect(traderProfileService.listPublicProfiles).toHaveBeenCalledWith(TENANT_ID, expect.objectContaining({ page: 1, limit: 20 }));
    expect(listedProfile).toMatchObject({ traderId: TRADER_ID, displayName: 'Public trader' });
    expect(listedProfile).not.toHaveProperty('userId');
    expect(listedProfile).not.toHaveProperty('tenantId');
    expect(listedProfile).not.toHaveProperty('riskProfile');
    expect(listedProfile).not.toHaveProperty('updatedAt');
  });
});
