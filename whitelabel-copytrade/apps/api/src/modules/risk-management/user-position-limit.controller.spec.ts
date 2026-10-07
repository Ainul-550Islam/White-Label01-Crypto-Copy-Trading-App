// # Responsibility: verifies self-service position-limit routes derive tenant/user scope only from the authenticated principal.

import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import { Permission } from '@wlct/shared-types';
import { PERMISSIONS_KEY, PERMISSIONS_MODE_KEY } from '../../common/constants/metadata.constants';
import { PositionLimitService } from '../risk/position-limit.service';
import { UserPositionLimitController } from './user-position-limit.controller';
import { UpdateUserPositionLimitDto } from './dto/user-position-limit.dto';

const TENANT_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const USER_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3302';

describe('UserPositionLimitController', () => {
  it('uses authenticated tenant and user for reads even when a tenant header is supplied', async () => {
    const service = {
      getMyLimits: jest.fn(async (input: { tenantId: string; userId: string }) => input),
    };
    const controller = new UserPositionLimitController(service as unknown as PositionLimitService);

    const response = await controller.getMyLimits({
      user: { tenantId: TENANT_ID, userId: USER_ID },
      headers: { 'x-tenant-id': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    });

    expect(response).toEqual({ tenantId: TENANT_ID, userId: USER_ID });
    expect(service.getMyLimits).toHaveBeenCalledWith({ tenantId: TENANT_ID, userId: USER_ID });
  });

  it('rejects missing authenticated tenant or user context before service access', async () => {
    const service = {
      getMyLimits: jest.fn(),
      updateMyLimits: jest.fn(),
    };
    const controller = new UserPositionLimitController(service as unknown as PositionLimitService);

    await expect(controller.getMyLimits({ user: { userId: USER_ID } })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.getMyLimits({ user: { tenantId: TENANT_ID } })).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.getMyLimits).not.toHaveBeenCalled();
  });

  it('writes only for the authenticated owner and retains request correlation metadata', async () => {
    const service = {
      updateMyLimits: jest.fn(async (input: {
        tenantId: string;
        userId: string;
        patch: UpdateUserPositionLimitDto;
        requestId: string | null;
      }) => input),
    };
    const controller = new UserPositionLimitController(service as unknown as PositionLimitService);
    const patch = Object.assign(new UpdateUserPositionLimitDto(), {
      maxConcurrentPositions: 4,
      maxOpenOrders: 9,
    });

    const result = await controller.updateMyLimits(
      {
        user: { tenantId: TENANT_ID, userId: USER_ID },
        requestId: 'position-limit-request-1',
        headers: { 'x-tenant-id': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      },
      patch,
    );

    expect(result).toEqual({ tenantId: TENANT_ID, userId: USER_ID, patch, requestId: 'position-limit-request-1' });
    expect(service.updateMyLimits).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      userId: USER_ID,
      patch,
      requestId: 'position-limit-request-1',
    });
  });

  it('requires explicit risk-read or portfolio-read permission for reads and execution-submit or risk-config-update for writes', () => {
    const getPermissions = Reflect.getMetadata(PERMISSIONS_KEY, UserPositionLimitController.prototype.getMyLimits);
    const getMode = Reflect.getMetadata(PERMISSIONS_MODE_KEY, UserPositionLimitController.prototype.getMyLimits);
    const putPermissions = Reflect.getMetadata(PERMISSIONS_KEY, UserPositionLimitController.prototype.updateMyLimits);
    const putMode = Reflect.getMetadata(PERMISSIONS_MODE_KEY, UserPositionLimitController.prototype.updateMyLimits);

    expect(getPermissions).toEqual([Permission.RISK_READ, Permission.PORTFOLIO_READ]);
    expect(getMode).toBe('any');
    expect(putPermissions).toEqual([Permission.EXECUTION_SUBMIT, Permission.RISK_CONFIG_UPDATE]);
    expect(putMode).toBe('any');
  });
});
