import { CopyPolicyService } from './copy-policy.service';
import { CustodyVisibilityService } from '../custody/custody-visibility.service';
import { CustodyScope } from '../custody/custody.types';

/**
 * Policy precedence is Platform -> Tenant -> Strategy -> Subscription, and a
 * lower level may only tighten. The tenant/strategy/subscription lookups used
 * to return null on any database error, so a failed lookup silently produced
 * a LOOSER effective policy. The strategy and subscription lookups also
 * ignored the tenant, so GET copy-trading/policies/effective could read
 * another tenant's strategy or subscription policy by id.
 */
describe('CopyPolicyService', () => {
  function build(opts: { failing?: 'tenant' | 'strategy' | 'subscription'; tenantPolicy?: unknown } = {}) {
    const fail = (what: string) => async () => {
      throw new Error(`${what} lookup failed`);
    };
    const prisma = {
      tenantSetting: {
        findFirst: jest.fn(opts.failing === 'tenant' ? fail('tenant') : async () => (opts.tenantPolicy ? { value: opts.tenantPolicy } : null)),
      },
      traderStrategy: {
        findFirst: jest.fn(
          opts.failing === 'strategy'
            ? fail('strategy')
            : async () => ({ riskProfile: { maxOrderNotional: '500' }, strategyConfig: { slippageToleranceBps: 25 }, supportedSymbols: ['BTC-USDT'] }),
        ),
      },
      copySubscription: {
        findFirst: jest.fn(opts.failing === 'subscription' ? fail('subscription') : async () => ({ copyPolicy: { maxDailyNotional: '2000' } })),
      },
    };
    return { service: new CopyPolicyService(prisma as never), prisma };
  }

  it.each(['tenant', 'strategy', 'subscription'] as const)('a failing %s lookup propagates instead of loosening the policy', async (failing) => {
    await expect(
      build({ failing }).service.resolveEffectivePolicy({ tenantId: 't1', strategyId: 'st-1', subscriptionId: 'sub-1' }),
    ).rejects.toThrow(`${failing} lookup failed`);
  });

  it('strategy and subscription lookups are scoped to the caller tenant', async () => {
    const { service, prisma } = build();
    await service.resolveEffectivePolicy({ tenantId: 't1', strategyId: 'st-1', subscriptionId: 'sub-1' });
    expect(prisma.traderStrategy.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'st-1', tenantId: 't1' } }));
    expect(prisma.copySubscription.findFirst).toHaveBeenCalledWith({ where: { id: 'sub-1', tenantId: 't1' } });
  });

  it('the strategy risk profile still maps into the policy', async () => {
    await expect(build().service.getTraderStrategyPolicy('st-1', 't1')).resolves.toMatchObject({
      maxOrderNotional: '500',
      slippageToleranceBps: 25,
      allowedSymbols: ['BTC-USDT'],
    });
  });
});

describe('CustodyVisibilityService.checkAccess (CLIENT scope)', () => {
  it('denies when wallet ownership cannot be verified (it used to allow)', async () => {
    const prisma = {
      custodyWallet: {
        findFirst: jest.fn(async () => {
          throw new Error('db unavailable');
        }),
      },
    };
    const service = new CustodyVisibilityService(prisma as never);
    await expect(
      service.checkAccess({
        tenantId: 't1',
        requesterTenantId: 't1',
        scope: CustodyScope.CLIENT,
        resourceTenantId: 't1',
        walletId: 'w-1',
        clientProfileId: 'cp-1',
      }),
    ).resolves.toEqual({ allowed: false, reason: 'Wallet ownership could not be verified' });
  });
});
