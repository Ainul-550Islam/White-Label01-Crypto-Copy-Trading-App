// # Covers authenticated verification/status behavior, per-user throttling, and every sensitive controller decorator.
import { StepUpController } from './step-up.controller';
import { StepUpGuard } from './step-up.guard';
import { StepUpAuthService } from '../step-up-auth.service';
import { REQUIRE_STEP_UP_KEY } from './require-step-up.decorator';
import { THROTTLER_LIMIT, THROTTLER_TTL } from '@nestjs/throttler/dist/throttler.constants';
import { ExchangesController } from '../../exchanges/exchanges.controller';
import { TwoFactorController } from '../two-factor.controller';
import { SecurityController } from '../../security/security.controller';
import { CustodyController } from '../../custody/custody.controller';
import { PartnerPortalController } from '../../partner/partner.controller';

const actorData = { userId: 'user-a', tenantId: 'tenant-a', sessionId: 'session-a' };
const actor = actorData as never;

describe('StepUpController and protected routes', () => {
  it('delegates verification and status using authenticated actor identity only', async () => {
    const stepUp = {
      verify: jest.fn().mockResolvedValue({ fresh: true }),
      status: jest.fn().mockResolvedValue({ fresh: false }),
    };
    const controller = new StepUpController(stepUp as never);
    const dto = { method: 'PASSWORD', password: 'secret', action: 'API_KEY_CREATE' } as never;
    const meta = { ipHash: 'ip-hash', requestId: 'request-a', userAgent: 'browser' } as never;
    await controller.verify(dto, actor, meta);
    await controller.status(actor, 'API_KEY_CREATE');
    expect(stepUp.verify).toHaveBeenCalledWith(actor, dto, {
      ipHash: 'ip-hash',
      requestId: 'request-a',
      userAgent: 'browser',
    });
    expect(stepUp.status).toHaveBeenCalledWith(actor, 'API_KEY_CREATE');
    await expect(controller.status(actor, 'tenant-b:PAYOUT_CREATE')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('sets verification throttling to five attempts per minute', () => {
    const verify = StepUpController.prototype.verify;
    expect(Reflect.getMetadata(`${THROTTLER_LIMIT}auth`, verify)).toBe(5);
    expect(Reflect.getMetadata(`${THROTTLER_TTL}auth`, verify)).toBe(60_000);
  });

  it('denies every step-up-decorated sensitive route when proof is absent', async () => {
    const controllers = [
      ExchangesController,
      TwoFactorController,
      SecurityController,
      CustodyController,
      PartnerPortalController,
    ];
    const decorated: Array<{
      controller: object & { name: string; prototype: object };
      method: string;
      action: string;
      handler: object;
    }> = [];
    for (const controller of controllers) {
      const prototype = controller.prototype as unknown as Record<string, unknown>;
      for (const method of Object.getOwnPropertyNames(prototype)) {
        const handler = prototype[method];
        if (typeof handler !== 'function') continue;
        const action = Reflect.getMetadata(REQUIRE_STEP_UP_KEY, handler) as string | undefined;
        if (action) decorated.push({ controller, method, action, handler });
      }
    }
    expect(decorated.length).toBeGreaterThanOrEqual(10);
    for (const route of decorated) {
      const request = {
        actor,
        tenantContext: { tenantId: actorData.tenantId },
        ipHash: 'ip-hash',
        headers: {},
        requestId: 'request-a',
        originalUrl: `/${route.controller.name}/${route.method}`,
        method: 'POST',
      };
      const reflector = {
        getAllAndOverride: (_key: string, targets: unknown[]) =>
          Reflect.getMetadata(REQUIRE_STEP_UP_KEY, targets[0] as object),
      };
      const recordImmediate = jest.fn().mockResolvedValue(undefined);
      const evalProof = jest.fn().mockResolvedValue('NO_PROOF');
      // Exercise the real consumer and denial audit; only the empty Redis store
      // is faked. The guard no longer checks a reusable freshness grant.
      const stepUp = new StepUpAuthService({} as never, { client: { eval: evalProof } } as never,
        {} as never, {} as never, {} as never, {} as never, { recordImmediate } as never);
      const guard = new StepUpGuard(reflector as never, stepUp);
      const context = {
        getHandler: () => route.handler,
        getClass: () => route.controller,
        switchToHttp: () => ({ getRequest: () => request }),
      } as never;
      await expect(guard.canActivate(context)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'STEP_UP_REQUIRED', action: route.action }),
        status: 403,
      });
      expect(evalProof).toHaveBeenCalledTimes(1);
      expect(recordImmediate).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'STEP_UP_ROUTE_DENIED', metadata: expect.objectContaining({ action: route.action, reason: 'NO_PROOF' }) }),
      );
    }
  });
});
