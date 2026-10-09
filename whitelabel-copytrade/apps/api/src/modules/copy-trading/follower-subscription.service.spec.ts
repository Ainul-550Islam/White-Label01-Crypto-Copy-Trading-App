import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { FollowerSubscriptionService } from './follower-subscription.service';
import { MaintenanceModeService } from '../operations/maintenance-mode.service';
import { CopySizingMode, CopySubscriptionState } from './copy-trading.types';

/**
 * subscribe() and the lifecycle actions used to throw plain Errors, which the
 * global exception filter turns into a generic 500: a follower copying an
 * unpublished strategy, or pausing someone else's subscription, saw
 * "internal error" instead of the reason. The compliance BLOCK check also
 * swallowed every database error, so a failing query let blocked followers
 * subscribe.
 */

function build(overrides: {
  trader?: unknown;
  strategy?: unknown;
  complianceFindFirst?: jest.Mock;
  subscription?: unknown;
  /** An active maintenance window covering trading. */
  maintenanceWindow?: { id: string } | null;
}) {
  const complianceFindFirst = overrides.complianceFindFirst ?? jest.fn(async () => null);
  const windowFindFirst = jest.fn(async () => overrides.maintenanceWindow ?? null);
  const prisma = {
    complianceCase: { findFirst: complianceFindFirst },
    operationalMaintenanceWindow: { findFirst: windowFindFirst },
    withTenantRls: jest.fn(async (_tenantId: string, work: (tx: unknown) => Promise<unknown>) => work({})),
  };
  const subscriptionRepo = {
    findById: jest.fn(async () => overrides.subscription ?? null),
    create: jest.fn(),
    updateState: jest.fn(async (_id: string, _t: string, state: string) => ({ subscriptionId: 's-1', state })),
  };
  // The real gate, with the database and Redis stubbed.
  const maintenance = new MaintenanceModeService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    { client: { get: jest.fn(async () => null) } } as never,
  );
  const allocationService = { validateAllocation: jest.fn(async () => ({ valid: true })) };
  const traderProfileService = {
    getProfile: jest.fn(async () => (overrides.trader === undefined ? { traderId: 'tr-1' } : overrides.trader)),
  };
  const traderStrategyService = {
    getStrategy: jest.fn(async () =>
      overrides.strategy === undefined ? { strategyId: 'st-1', traderId: 'tr-1', status: 'PUBLISHED' } : overrides.strategy,
    ),
  };
  const guard = { reserve: jest.fn(async () => undefined), release: jest.fn(async () => undefined) };
  const service = new FollowerSubscriptionService(
    prisma as never,
    subscriptionRepo as never,
    allocationService as never,
    {} as never,
    traderProfileService as never,
    traderStrategyService as never,
    guard as never,
    guard as never,
    maintenance as never,
    { append: jest.fn(async () => ({ id: 'outbox-1' })) } as never,
  );
  return { service, complianceFindFirst, guard, subscriptionRepo, windowFindFirst, traderProfileService };
}

const input = {
  tenantId: 'tenant-1',
  followerId: 'user-7',
  actorId: 'user-7',
  traderId: 'tr-1',
  strategyId: 'st-1',
  allocationMode: CopySizingMode.FIXED,
  allocationAmount: '100',
};

describe('FollowerSubscriptionService.subscribe errors are HTTP errors', () => {
  it('unknown trader or strategy -> 404', async () => {
    await expect(build({ trader: null }).service.subscribe(input as never)).rejects.toBeInstanceOf(NotFoundException);
    await expect(build({ strategy: null }).service.subscribe(input as never)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('unpublished strategy -> 422 with the reason', async () => {
    const { service } = build({ strategy: { strategyId: 'st-1', traderId: 'tr-1', status: 'DRAFT' } });
    const err = await service.subscribe(input as never).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnprocessableEntityException);
    expect((err as Error).message).toContain('PUBLISHED');
  });

  it('strategy of another trader -> 422', async () => {
    const { service } = build({ strategy: { strategyId: 'st-1', traderId: 'tr-other', status: 'PUBLISHED' } });
    await expect(service.subscribe(input as never)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('compliance BLOCK -> 403 before any plan-limit reservation', async () => {
    const { service, guard } = build({ complianceFindFirst: jest.fn(async () => ({ id: 'case-1' })) });
    await expect(service.subscribe(input as never)).rejects.toBeInstanceOf(ForbiddenException);
    expect(guard.reserve).not.toHaveBeenCalled();
  });

  it('fails closed when the compliance lookup errors (it used to skip the check)', async () => {
    const { service, guard } = build({
      complianceFindFirst: jest.fn(async () => {
        throw new Error('db unavailable');
      }),
    });
    await expect(service.subscribe(input as never)).rejects.toThrow('db unavailable');
    expect(guard.reserve).not.toHaveBeenCalled();
  });

  it('queries only open BLOCK cases of this follower in this tenant', async () => {
    const { service, complianceFindFirst } = build({ strategy: { strategyId: 'st-1', traderId: 'tr-1', status: 'DRAFT' } });
    await service.subscribe(input as never).catch(() => undefined);
    expect(complianceFindFirst).not.toHaveBeenCalled();
    const ok = build({});
    await ok.service.subscribe(input as never).catch(() => undefined);
    expect(ok.complianceFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: 'tenant-1',
          userId: 'user-7',
          decision: 'BLOCK',
          state: { in: ['OPEN', 'IN_REVIEW', 'ESCALATED'] },
        },
      }),
    );
  });
});

describe('FollowerSubscriptionService lifecycle errors', () => {
  const sub = (state: CopySubscriptionState) => ({ subscriptionId: 's-1', followerId: 'user-7', state });

  it("acting on another follower's subscription -> 403", async () => {
    const { service } = build({ subscription: sub(CopySubscriptionState.ACTIVE) });
    await expect(service.pauseSubscription('tenant-1', 's-1', 'user-8', 'user-8')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.resumeSubscription('tenant-1', 's-1', 'user-8', 'user-8')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('invalid state transitions -> 409', async () => {
    await expect(
      build({ subscription: sub(CopySubscriptionState.PAUSED) }).service.pauseSubscription('tenant-1', 's-1', 'user-7', 'user-7'),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      build({ subscription: sub(CopySubscriptionState.ACTIVE) }).service.resumeSubscription('tenant-1', 's-1', 'user-7', 'user-7'),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      build({ subscription: sub(CopySubscriptionState.STOPPED) }).service.stopCopy('tenant-1', 's-1', 'user-7', 'user-7'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('FollowerSubscriptionService honours trading maintenance windows', () => {
  const sub = (state: CopySubscriptionState) => ({ subscriptionId: 's-1', followerId: 'user-7', state });
  const window = { id: 'mw-1' };

  it('subscribe -> 503 before any lookup or plan-limit reservation', async () => {
    const { service, guard, traderProfileService, windowFindFirst } = build({ maintenanceWindow: window });
    await expect(service.subscribe(input as never)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(traderProfileService.getProfile).not.toHaveBeenCalled();
    expect(guard.reserve).not.toHaveBeenCalled();
    // The check covers platform-wide, this tenant's and trading windows.
    const where = JSON.stringify((windowFindFirst.mock.calls[0] as unknown as [{ where: unknown }])[0].where);
    expect(where).toContain('"TRADING_CAPABILITY"');
    expect(where).toContain('"PLATFORM"');
    expect(where).toContain('{"scope":"TENANT","tenantId":"tenant-1"}');
  });

  it('resume -> 503 for an owned PAUSED subscription; ownership and state errors still come first', async () => {
    const paused = build({ subscription: sub(CopySubscriptionState.PAUSED), maintenanceWindow: window });
    await expect(paused.service.resumeSubscription('tenant-1', 's-1', 'user-7', 'user-7')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(paused.subscriptionRepo.updateState).not.toHaveBeenCalled();
    await expect(paused.service.resumeSubscription('tenant-1', 's-1', 'user-8', 'user-8')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    const active = build({ subscription: sub(CopySubscriptionState.ACTIVE), maintenanceWindow: window });
    await expect(active.service.resumeSubscription('tenant-1', 's-1', 'user-7', 'user-7')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('pause stays available during maintenance (reducing exposure must always work)', async () => {
    const { service, subscriptionRepo, windowFindFirst } = build({
      subscription: sub(CopySubscriptionState.ACTIVE),
      maintenanceWindow: window,
    });
    await expect(service.pauseSubscription('tenant-1', 's-1', 'user-7', 'user-7')).resolves.toMatchObject({ state: 'PAUSED' });
    expect(subscriptionRepo.updateState).toHaveBeenCalled();
    expect(windowFindFirst).not.toHaveBeenCalled();
  });

  it('a failing maintenance lookup blocks subscribe instead of letting it through', async () => {
    const { service, guard, windowFindFirst } = build({});
    windowFindFirst.mockRejectedValueOnce(new Error('db unavailable'));
    await expect(service.subscribe(input as never)).rejects.toThrow('db unavailable');
    expect(guard.reserve).not.toHaveBeenCalled();
  });

  it('no active window -> subscribe proceeds to the normal checks', async () => {
    const { service, traderProfileService } = build({ trader: null });
    await expect(service.subscribe(input as never)).rejects.toBeInstanceOf(NotFoundException);
    expect(traderProfileService.getProfile).toHaveBeenCalled();
  });
});
