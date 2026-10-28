// # Responsibility: checks route permissions, owner scope and action-specific verification for per-account limits.
import 'reflect-metadata';
import { Permission } from '@wlct/shared-types';
import { PERMISSIONS_KEY, PERMISSIONS_MODE_KEY } from '../../common/constants/metadata.constants';
import { REQUIRE_STEP_UP_KEY } from '../auth/step-up/require-step-up.decorator';
import { AccountOrderSizeLimitController } from './account-order-size-limit.controller';
import { AccountOrderSizeLimitService } from './account-order-size-limit.service';
import { RiskManagementModule } from './risk-management.module';

const tenant = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const user = '3f2504e0-4f89-41d3-9a0c-0305e82c3302';
const account = '3f2504e0-4f89-41d3-9a0c-0305e82c3303';

describe('AccountOrderSizeLimitController', () => {
  it('mounts the controller and provider and requires action-specific verification for mutation', () => {
    const controllers = Reflect.getMetadata('controllers', RiskManagementModule) as unknown[];
    const providers = Reflect.getMetadata('providers', RiskManagementModule) as unknown[];
    expect(controllers).toContain(AccountOrderSizeLimitController);
    expect(providers).toContain(AccountOrderSizeLimitService);
    expect(Reflect.getMetadata(REQUIRE_STEP_UP_KEY, AccountOrderSizeLimitController.prototype.update)).toBe('USER_ACCOUNT_ORDER_LIMIT_UPDATE');
    expect(Reflect.getMetadata(PERMISSIONS_KEY, AccountOrderSizeLimitController.prototype.get)).toEqual([Permission.RISK_READ, Permission.PORTFOLIO_READ]);
    expect(Reflect.getMetadata(PERMISSIONS_MODE_KEY, AccountOrderSizeLimitController.prototype.get)).toBe('any');
    expect(Reflect.getMetadata(PERMISSIONS_KEY, AccountOrderSizeLimitController.prototype.update)).toEqual([Permission.EXECUTION_SUBMIT, Permission.RISK_CONFIG_UPDATE]);
  });
  it('uses only the authenticated principal for tenant and owner scope', async () => {
    const service = { get: jest.fn(async (input) => input), list: jest.fn(async (input) => input), update: jest.fn(async (input) => input) };
    const controller = new AccountOrderSizeLimitController(service as never);
    const req = { user: { tenantId: tenant, userId: user }, headers: { 'x-tenant-id': 'wrong', 'idempotency-key': 'update-limit-key' } };
    await expect(controller.get(req, account)).resolves.toEqual({ tenantId: tenant, userId: user, accountId: account });
    await expect(controller.list(req, { page: '2', limit: '4' })).resolves.toEqual({ tenantId: tenant, userId: user, page: 2, limit: 4 });
    await controller.update(req, account, { expectedRevision: null, maxBaseQuantity: '2', maxOrderNotional: null, notionalCurrency: null });
    expect(service.update).toHaveBeenCalledWith(expect.objectContaining({ tenantId: tenant, userId: user, accountId: account, idempotencyKey: 'update-limit-key' }));
    await expect(controller.update({ user: req.user }, account, {})).rejects.toThrow('retry key');
    await expect(controller.get({ user: { tenantId: tenant } }, account)).rejects.toThrow();
  });
});
