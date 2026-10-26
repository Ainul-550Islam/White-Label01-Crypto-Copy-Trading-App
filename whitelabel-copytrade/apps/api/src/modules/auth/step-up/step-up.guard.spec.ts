// # Verifies action-bound step-up access and audit records for every allow and deny.
import { StepUpGuard } from './step-up.guard';

function makeContext(
  action: string,
  actor: unknown = { userId: 'user-a', tenantId: 'tenant-a', sessionId: 'session-a' },
) {
  const handler = jest.fn();
  const request = {
    actor,
    tenantContext: { tenantId: 'tenant-a' },
    ipHash: 'ip-hash',
    headers: { 'user-agent': 'browser' },
    requestId: 'request-a',
    originalUrl: '/v1/payouts',
    method: 'POST',
  };
  const reflector = { getAllAndOverride: jest.fn((_key: string, _targets: unknown[]) => action) };
  const isFresh = jest.fn();
  const recordImmediate = jest.fn().mockResolvedValue(undefined);
  const guard = new StepUpGuard(
    reflector as never,
    { isFresh } as never,
    { recordImmediate } as never,
  );
  const context = {
    getHandler: () => handler,
    getClass: () => class Route {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
  return { guard, context, isFresh, recordImmediate, request, handler };
}

describe('StepUpGuard', () => {
  it('allows a fresh exact-action grant and records an allow audit event', async () => {
    const mocks = makeContext('PAYOUT_CREATE');
    mocks.isFresh.mockResolvedValue(true);
    await expect(mocks.guard.canActivate(mocks.context)).resolves.toBe(true);
    expect(mocks.isFresh).toHaveBeenCalledWith(mocks.request.actor, 'PAYOUT_CREATE');
    expect(mocks.recordImmediate).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'STEP_UP_ROUTE_ALLOWED' }),
    );
  });

  it('denies missing/expired proofs with STEP_UP_REQUIRED and audits the denied action', async () => {
    const mocks = makeContext('PAYOUT_APPROVE');
    mocks.isFresh.mockResolvedValue(false);
    await expect(mocks.guard.canActivate(mocks.context)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'STEP_UP_REQUIRED', action: 'PAYOUT_APPROVE' }),
      status: 403,
    });
    expect(mocks.recordImmediate).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'STEP_UP_ROUTE_DENIED', outcome: 'FAILURE' }),
    );
  });

  it('does not require proof for handlers without @RequireStepUp metadata', async () => {
    const mocks = makeContext('');
    const reflector = { getAllAndOverride: jest.fn(() => undefined) };
    const guard = new StepUpGuard(
      reflector as never,
      { isFresh: jest.fn() } as never,
      { recordImmediate: jest.fn() } as never,
    );
    await expect(guard.canActivate(mocks.context)).resolves.toBe(true);
  });
});
