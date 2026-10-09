/**
 * The plan limits count the entities they govern.
 *
 * Before this was fixed the counters read delegates that do not exist
 * (`prisma.trader`, `prisma.exchangeAccount`) behind `?.` and `?? 0`, so
 * maxTraders and maxExchangeAccounts always saw 0 usage, the per-X limits
 * compared a tenant-wide total, and TraderProfileService created traders
 * without ever asking the maxTraders guard.
 */
import { TraderProfileService } from '../../copy-trading/trader-profile.service';
import { TenantFeatureAccessService } from '../saas-admin/tenant-feature-access.service';
import { BillingUsageSummaryService } from '../portal/billing-usage-summary.service';
import { UsageRepository } from './usage.repository';

const TENANT = '11111111-1111-1111-1111-111111111111';

describe('TraderProfileService.createProfile enforces maxTraders', () => {
  function build(overrides: { reserve?: jest.Mock; create?: jest.Mock } = {}) {
    const order: string[] = [];
    const guard = {
      reserve: overrides.reserve ?? jest.fn(async () => order.push('reserve')),
      release: jest.fn(async () => order.push('release')),
    };
    const create =
      overrides.create ??
      jest.fn(async ({ data }: any) => {
        order.push('create');
        return data;
      });
    const prisma = {
      user: { findFirst: jest.fn(async () => ({ id: 'u1', tenantId: TENANT })) },
      traderProfile: { findFirst: jest.fn(async () => null), create },
    };
    // The two stats dependencies are not exercised by these cases - they are only reached by the
    // public-metrics read. They are still passed, because the service takes them by constructor and a
    // placeholder here would hide it if that stopped being true.
    const service = new TraderProfileService(
      prisma as any,
      guard as any,
      {} as any,
      {} as any,
      { append: jest.fn() } as never,
    );
    return { service, guard, create, order };
  }

  const input = { tenantId: TENANT, userId: 'u1', displayName: 'Alpha' };

  it('reserves a slot before inserting the profile', async () => {
    const { service, guard, order } = build();
    await service.createProfile(input);
    expect(order).toEqual(['reserve', 'create']);
    expect(guard.reserve).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, userId: 'u1' }),
    );
    expect(guard.release).not.toHaveBeenCalled();
  });

  it('creates nothing when the plan is full', async () => {
    const reserve = jest.fn(async () => {
      throw new Error('PLAN_LIMIT_EXCEEDED');
    });
    const { service, create } = build({ reserve });
    await expect(service.createProfile(input)).rejects.toThrow('PLAN_LIMIT_EXCEEDED');
    expect(create).not.toHaveBeenCalled();
  });

  it('gives the slot back when the insert fails', async () => {
    const create = jest.fn(async () => {
      throw new Error('unique violation');
    });
    const { service, guard } = build({ create });
    await expect(service.createProfile(input)).rejects.toThrow('unique violation');
    expect(guard.release).toHaveBeenCalledTimes(1);
  });

  it('does not reserve for a duplicate profile', async () => {
    const { service, guard } = build();
    const prisma = (service as any).prisma;
    prisma.traderProfile.findFirst.mockResolvedValueOnce({ id: 'existing' });
    await expect(service.createProfile(input)).rejects.toThrow('already exists');
    expect(guard.reserve).not.toHaveBeenCalled();
  });
});

describe('TenantFeatureAccessService usage counters', () => {
  function build(prisma: Record<string, unknown>) {
    const service = new TenantFeatureAccessService(prisma as any, {} as any, {} as any, {} as any);
    return (limitKey: string): Promise<number> =>
      (service as any).getCurrentUsage(TENANT, limitKey);
  }

  it('maxTraders counts live trader profiles', async () => {
    const count = jest.fn(async () => 7);
    const usage = build({ traderProfile: { count } });
    await expect(usage('maxTraders')).resolves.toBe(7);
    expect(count).toHaveBeenCalledWith({ where: { tenantId: TENANT, deletedAt: null } });
  });

  it('maxFollowersPerTrader is the busiest trader, not the tenant total', async () => {
    const groupBy = jest.fn(async () => [
      { traderId: 't1', _count: { _all: 5 } },
      { traderId: 't2', _count: { _all: 9 } },
      { traderId: 't3', _count: { _all: 2 } },
    ]);
    const usage = build({ copySubscription: { groupBy } });
    await expect(usage('maxFollowersPerTrader')).resolves.toBe(9);
    expect(groupBy).toHaveBeenCalledWith({
      by: ['traderId'],
      where: { tenantId: TENANT, state: 'ACTIVE' },
      _count: { _all: true },
    });
  });

  it('maxExchangeAccountsPerUser groups live trading accounts by owner', async () => {
    const groupBy = jest.fn(async () => [
      { userId: 'u1', _count: { _all: 3 } },
      { userId: 'u2', _count: { _all: 1 } },
    ]);
    const usage = build({ tradingAccount: { groupBy } });
    await expect(usage('maxExchangeAccountsPerUser')).resolves.toBe(3);
    expect(groupBy).toHaveBeenCalledWith({
      by: ['userId'],
      where: { tenantId: TENANT, deletedAt: null, userId: { not: null } },
      _count: { _all: true },
    });
  });

  it('maxCopySubscriptionsPerFollower groups by follower', async () => {
    const groupBy = jest.fn(async () => [{ followerId: 'f1', _count: { _all: 4 } }]);
    const usage = build({ copySubscription: { groupBy } });
    await expect(usage('maxCopySubscriptionsPerFollower')).resolves.toBe(4);
    expect(groupBy).toHaveBeenCalledWith(expect.objectContaining({ by: ['followerId'] }));
  });

  it('an empty tenant is 0 for every per-X limit', async () => {
    const groupBy = jest.fn(async () => []);
    const usage = build({ copySubscription: { groupBy }, tradingAccount: { groupBy } });
    await expect(usage('maxFollowersPerTrader')).resolves.toBe(0);
    await expect(usage('maxExchangeAccountsPerUser')).resolves.toBe(0);
    await expect(usage('maxCopySubscriptionsPerFollower')).resolves.toBe(0);
  });
});

describe('UsageRepository.countActiveTraders', () => {
  it('counts TraderProfile rows, not trading accounts', async () => {
    const traderCount = jest.fn(async () => 4);
    const accountCount = jest.fn(async () => 99);
    const repo = new UsageRepository(
      {} as any,
      { traderProfile: { count: traderCount }, tradingAccount: { count: accountCount } } as any,
      {} as any,
    );
    await expect(repo.countActiveTraders(TENANT)).resolves.toBe(4);
    expect(traderCount).toHaveBeenCalledWith({ where: { tenantId: TENANT, deletedAt: null } });
    expect(accountCount).not.toHaveBeenCalled();
  });
});

describe('BillingUsageSummaryService counters', () => {
  function build(prisma: Record<string, unknown>) {
    return new BillingUsageSummaryService(prisma as any, {} as any, {} as any, {} as any) as any;
  }

  it('traders are live trader profiles', async () => {
    const service = build({ traderProfile: { count: jest.fn(async () => 3) } });
    await expect(service.countTraders(TENANT)).resolves.toBe(3);
  });

  it('followers are distinct users with a live copy subscription', async () => {
    const findMany = jest.fn(async () => [{ followerId: 'a' }, { followerId: 'b' }]);
    const service = build({ copySubscription: { findMany } });
    await expect(service.countFollowers(TENANT)).resolves.toBe(2);
    expect(findMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT, state: { in: ['ACTIVE', 'PAUSED'] } },
      distinct: ['followerId'],
      select: { followerId: true },
    });
  });

  it('exchange accounts are live trading accounts', async () => {
    const count = jest.fn(async () => 6);
    const service = build({ tradingAccount: { count } });
    await expect(service.countExchangeAccounts(TENANT)).resolves.toBe(6);
    expect(count).toHaveBeenCalledWith({ where: { tenantId: TENANT, deletedAt: null } });
  });
});
