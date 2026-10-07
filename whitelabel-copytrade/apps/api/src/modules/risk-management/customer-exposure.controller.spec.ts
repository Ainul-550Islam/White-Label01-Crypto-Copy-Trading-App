// # Responsibility: verifies self-service and trader-profile exposure routes enforce authenticated tenant/user ownership and hide unauthorized profile existence.

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { RiskManagementController } from './risk.controller';

const AUTH_TENANT = 'tenant-from-verified-token';
const AUTH_USER = 'user-from-verified-token';

describe('RiskManagementController.getMyExposure', () => {
  function buildController() {
    const controller = Object.create(RiskManagementController.prototype) as RiskManagementController;
    const customerExposureService = {
      calculateMyExposure: jest.fn(async () => ({ state: 'EMPTY' })),
      calculateTraderExposure: jest.fn(async () => ({ state: 'EMPTY', dataScope: 'TRADER_PROFILE_OWNER_NON_SANDBOX_NON_SIMULATED_ACCOUNTS' })),
    };
    Reflect.set(controller, 'customerExposureService', customerExposureService);
    return { controller, customerExposureService };
  }

  it('passes only the tenant and user taken from the authenticated principal', async () => {
    const { controller, customerExposureService } = buildController();
    const result = await controller.getMyExposure({
      user: { tenantId: AUTH_TENANT, userId: AUTH_USER },
      query: {
        tenantId: 'attacker-selected-tenant',
        userId: 'attacker-selected-user',
        accountId: 'attacker-selected-account',
      },
    });

    expect(customerExposureService.calculateMyExposure).toHaveBeenCalledTimes(1);
    expect(customerExposureService.calculateMyExposure).toHaveBeenCalledWith({
      tenantId: AUTH_TENANT,
      userId: AUTH_USER,
    });
    expect(result).toEqual({ state: 'EMPTY' });
  });

  it('refuses a missing authenticated user instead of widening to tenant exposure', async () => {
    const { controller, customerExposureService } = buildController();

    await expect(controller.getMyExposure({
      user: { tenantId: AUTH_TENANT },
      query: { userId: 'attacker-selected-user' },
    })).rejects.toBeInstanceOf(ForbiddenException);
    expect(customerExposureService.calculateMyExposure).not.toHaveBeenCalled();
  });

  it('refuses a missing tenant even if a tenant query parameter is present', async () => {
    const { controller, customerExposureService } = buildController();

    await expect(controller.getMyExposure({
      user: { userId: AUTH_USER },
      query: { tenantId: 'attacker-selected-tenant' },
    })).rejects.toBeInstanceOf(ForbiddenException);
    expect(customerExposureService.calculateMyExposure).not.toHaveBeenCalled();
  });
});

describe('RiskManagementController.getTraderExposure', () => {
  const TRADER_ID = 'trader-profile-owner-scoped';

  function buildController() {
    const controller = Object.create(RiskManagementController.prototype) as RiskManagementController;
    const customerExposureService = {
      calculateMyExposure: jest.fn(async () => ({ state: 'EMPTY' })),
      calculateTraderExposure: jest.fn(async () => ({
        state: 'CURRENT',
        traderId: TRADER_ID,
        dataScope: 'TRADER_PROFILE_OWNER_NON_SANDBOX_NON_SIMULATED_ACCOUNTS',
      })),
    };
    Reflect.set(controller, 'customerExposureService', customerExposureService);
    return { controller, customerExposureService };
  }

  it('binds the target trader to the route and tenant/user exclusively to the authenticated principal', async () => {
    const { controller, customerExposureService } = buildController();
    const result = await controller.getTraderExposure({
      user: { tenantId: AUTH_TENANT, userId: AUTH_USER },
      query: {
        tenantId: 'attacker-selected-tenant',
        userId: 'attacker-selected-user',
        accountId: 'attacker-selected-account',
      },
    }, TRADER_ID);

    expect(customerExposureService.calculateTraderExposure).toHaveBeenCalledTimes(1);
    expect(customerExposureService.calculateTraderExposure).toHaveBeenCalledWith({
      tenantId: AUTH_TENANT,
      traderId: TRADER_ID,
      userId: AUTH_USER,
    });
    expect(result).toMatchObject({
      traderId: TRADER_ID,
      dataScope: 'TRADER_PROFILE_OWNER_NON_SANDBOX_NON_SIMULATED_ACCOUNTS',
    });
  });

  it('refuses a missing authenticated user without calling the exposure service', async () => {
    const { controller, customerExposureService } = buildController();

    await expect(controller.getTraderExposure({
      user: { tenantId: AUTH_TENANT },
      query: { userId: AUTH_USER },
    }, TRADER_ID)).rejects.toBeInstanceOf(ForbiddenException);
    expect(customerExposureService.calculateTraderExposure).not.toHaveBeenCalled();
  });

  it('returns not found when the service cannot prove trader ownership', async () => {
    const { controller, customerExposureService } = buildController();
    customerExposureService.calculateTraderExposure.mockResolvedValueOnce(null as never);

    await expect(controller.getTraderExposure({
      user: { tenantId: AUTH_TENANT, userId: AUTH_USER },
    }, TRADER_ID)).rejects.toBeInstanceOf(NotFoundException);
  });
});
