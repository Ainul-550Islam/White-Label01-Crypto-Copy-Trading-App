// # Tests fail-closed feature checks always use the resolved tenant and authenticated user.
import { FeatureFlagGuard } from './feature-flag.guard';
import { AppException } from '../../../common/errors/app.exception';

function context(request: unknown) {
  const handler = jest.fn();
  const controller = class TestController {};
  const executionContext = {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
  return { executionContext, handler, controller };
}

describe('FeatureFlagGuard', () => {
  it('allows an unannotated route without making a flag lookup', async () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(undefined) };
    const isEnabled = jest.fn();
    const guard = new FeatureFlagGuard(reflector as never, { isEnabled } as never);
    const { executionContext } = context({});
    await expect(guard.canActivate(executionContext)).resolves.toBe(true);
    expect(isEnabled).not.toHaveBeenCalled();
  });

  it('refuses an annotated route when tenant context is absent', async () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue('copy_trading') };
    const guard = new FeatureFlagGuard(reflector as never, { isEnabled: jest.fn() } as never);
    const { executionContext } = context({ actor: { userId: 'user-a' } });
    await expect(guard.canActivate(executionContext)).rejects.toBeInstanceOf(AppException);
  });

  it('uses user-level rollout when authenticated and denies a disabled flag', async () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue('copy_trading') };
    const isEnabledForUser = jest.fn().mockResolvedValue(false);
    const guard = new FeatureFlagGuard(reflector as never, { isEnabledForUser } as never);
    const { executionContext } = context({
      tenantContext: { tenantId: 'tenant-b' },
      actor: { userId: 'user-b' },
    });
    await expect(guard.canActivate(executionContext)).rejects.toMatchObject({
      code: 'FEATURE_DISABLED',
    });
    expect(isEnabledForUser).toHaveBeenCalledWith('tenant-b', 'user-b', 'copy_trading');
  });

  it('uses tenant-level resolution for an anonymous route after tenant middleware', async () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue('public_registration') };
    const isEnabled = jest.fn().mockResolvedValue(true);
    const guard = new FeatureFlagGuard(reflector as never, { isEnabled } as never);
    const { executionContext } = context({ tenantContext: { tenantId: 'tenant-c' } });
    await expect(guard.canActivate(executionContext)).resolves.toBe(true);
    expect(isEnabled).toHaveBeenCalledWith('tenant-c', 'public_registration');
  });
});
