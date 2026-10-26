// # Verifies action-bound step-up access and audit records for every allow and deny.
import { ForbiddenException } from '@nestjs/common';
import { ErrorCode } from '@wlct/shared-types';

import { StepUpGuard } from './step-up.guard';

function makeContext(action: string | undefined, actor: unknown = { userId: 'user-a', tenantId: 'tenant-a', sessionId: 'session-a' }) {
  const request = {
    actor,
    tenantContext: { tenantId: 'tenant-a' },
    ipHash: 'ip-hash',
    headers: { 'user-agent': 'browser' },
    requestId: 'request-a',
    originalUrl: '/v1/payouts?limit=1',
    method: 'POST',
  };
  const reflector = { getAllAndOverride: jest.fn((_key: string, _targets: unknown[]) => action) };
  const consumeForRoute = jest.fn();
  const guard = new StepUpGuard(reflector as never, { consumeForRoute } as never);
  const context = {
    getHandler: () => () => undefined,
    getClass: () => class Route {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
  return { guard, context, consumeForRoute, request };
}

describe('StepUpGuard', () => {
  it('allows a consumed exact-action proof without writing a second audit row', async () => {
    const { guard, context, consumeForRoute, request } = makeContext('PAYOUT_CREATE');
    consumeForRoute.mockResolvedValue(true);

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(consumeForRoute).toHaveBeenCalledWith(
      request.actor,
      'PAYOUT_CREATE',
      expect.objectContaining({ ipHash: 'ip-hash', requestId: 'request-a', method: 'POST', path: '/v1/payouts' }),
    );
  });

  it('denies a missing/expired proof with STEP_UP_REQUIRED and 403', async () => {
    const { guard, context, consumeForRoute } = makeContext('PAYOUT_APPROVE');
    consumeForRoute.mockResolvedValue(false);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      response: expect.objectContaining({ code: ErrorCode.STEP_UP_REQUIRED, action: 'PAYOUT_APPROVE' }),
      status: 403,
    });
  });

  it('does not require a proof for handlers without @RequireStepUp metadata', async () => {
    const { guard, context, consumeForRoute } = makeContext(undefined);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(consumeForRoute).not.toHaveBeenCalled();
  });

  it('refuses an unauthenticated caller on a sensitive route without consulting the store', async () => {
    const { guard, context, consumeForRoute } = makeContext('EXCHANGE_KEY_ROTATE', null);
    consumeForRoute.mockResolvedValue(false);

    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 401 });
  });

  it('reads the metadata from the handler before the class', async () => {
    const getAllAndOverride = jest.fn(() => 'CUSTODY_SWEEP');
    const guard = new StepUpGuard(
      { getAllAndOverride } as never,
      { consumeForRoute: jest.fn().mockResolvedValue(true) } as never,
    );
    const handler = () => undefined;
    const controller = class Route {};
    const context = {
      getHandler: () => handler,
      getClass: () => controller,
      switchToHttp: () => ({
        getRequest: () => ({
          actor: { userId: 'user-a', tenantId: 'tenant-a', sessionId: 'session-a' },
          ipHash: 'ip-hash',
          headers: {},
          requestId: 'request-a',
          originalUrl: '/v1/custody/sweep',
          method: 'POST',
        }),
      }),
    } as never;

    await guard.canActivate(context);

    expect(getAllAndOverride).toHaveBeenCalledWith('security:require-step-up', [handler, controller]);
  });
});
