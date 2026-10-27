import { Reflector } from '@nestjs/core';
import { Permission } from '@wlct/shared-types';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { REQUIRE_STEP_UP_KEY } from '../auth/step-up/require-step-up.decorator';
import { ClientLifecycleController } from './client-lifecycle.controller';

const handler = ClientLifecycleController.prototype.createWithdrawal;
const reflector = new Reflector();
const actor = { userId: 'user', tenantId: 'tenant', isPlatformUser: false, permissions: [], roles: [] };
const request = { actor, originalUrl: '/client-lifecycle/withdrawals', method: 'POST', headers: {} };
const context = {
  getType: () => 'http', getHandler: () => handler, getClass: () => ClientLifecycleController,
  switchToHttp: () => ({ getRequest: () => request }),
} as any;

test('withdrawal requires a live payout permission in addition to the action-specific step-up', async () => {
  const permissions = { getEffectiveAccess: jest.fn().mockResolvedValue({ permissionKeys: [Permission.PORTFOLIO_READ], roleKeys: [] }) };
  const events = { record: jest.fn().mockResolvedValue(undefined) };
  const guard = new PermissionsGuard(reflector, permissions as any, events as any);
  expect(reflector.get(REQUIRE_STEP_UP_KEY, handler)).toBe('PAYOUT_CREATE');
  await expect(guard.canActivate(context)).rejects.toThrow();
  expect(events.record).toHaveBeenCalledTimes(1);
  permissions.getEffectiveAccess.mockResolvedValue({ permissionKeys: [Permission.PAYOUT_MANAGE], roleKeys: [] });
  await expect(guard.canActivate(context)).resolves.toBe(true);
});
