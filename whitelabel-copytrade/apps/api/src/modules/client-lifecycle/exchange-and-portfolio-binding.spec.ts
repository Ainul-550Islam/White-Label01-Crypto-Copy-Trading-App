/**
 * Client-lifecycle bindings resolve the real models.
 *
 * Exchange accounts are TradingAccount rows and portfolios are
 * PortfolioAccountingProfile rows. The services used to read delegates that do
 * not exist (`exchangeAccount`, `portfolio`) behind `?.`, which made binding
 * accept any id, trading activation fail for every client, and lifecycle
 * reconciliation flag every binding as orphaned.
 */
import { BadRequestException } from '@nestjs/common';

import { ExchangeAccountBindingService } from './exchange-account-binding.service';
import { LifecycleReconciliationService } from './lifecycle-reconciliation.service';
import { PortfolioBindingService } from './portfolio-binding.service';
import { TradingActivationService } from './trading-activation.service';

const TENANT = '11111111-1111-1111-1111-111111111111';

/** A PrismaService stand-in: named delegates as given, every other delegate empty. */
function fakePrisma(delegates: Record<string, Record<string, jest.Mock>>) {
  const empty = () => ({
    findFirst: jest.fn(async () => null),
    findUnique: jest.fn(async () => null),
    findMany: jest.fn(async () => []),
    count: jest.fn(async () => 0),
    create: jest.fn(async ({ data }: any) => ({ id: 'new', ...data })),
    update: jest.fn(async ({ data }: any) => ({ id: 'upd', ...data })),
  });
  const cache: Record<string, unknown> = {};
  return new Proxy(delegates, {
    get(target, prop: string) {
      if (prop in target) {
        return { ...empty(), ...target[prop] };
      }
      cache[prop] ??= empty();
      return cache[prop];
    },
  }) as any;
}

const ACCOUNT = {
  id: 'acc-1',
  tenantId: TENANT,
  clientProfileId: 'cp-1',
  exchangeAccountId: null,
  portfolioId: null,
};

describe('ExchangeAccountBindingService', () => {
  const audit = { log: jest.fn(async () => undefined) };

  function build(tradingAccount: unknown) {
    const tradingAccountFindFirst = jest.fn(async () => tradingAccount);
    const prisma = fakePrisma({
      institutionalAccount: {
        findFirst: jest.fn(async ({ where }: any) => (where.id === ACCOUNT.id ? ACCOUNT : null)),
        update: jest.fn(async () => ACCOUNT),
      },
      tradingAccount: { findFirst: tradingAccountFindFirst },
    });
    return {
      service: new ExchangeAccountBindingService(prisma, audit as any),
      tradingAccountFindFirst,
    };
  }

  const params = { tenantId: TENANT, accountId: ACCOUNT.id, exchangeAccountId: 'ta-1' };

  it('looks the exchange account up as a live TradingAccount in the same tenant', async () => {
    const { service, tradingAccountFindFirst } = build({
      id: 'ta-1',
      tenantId: TENANT,
      status: 'ACTIVE',
    });
    await service.bindExchangeAccount(params);
    expect(tradingAccountFindFirst).toHaveBeenCalledWith({
      where: { id: 'ta-1', tenantId: TENANT, deletedAt: null },
    });
  });

  it('refuses to bind an account that does not exist in this tenant', async () => {
    const { service } = build(null);
    await expect(service.bindExchangeAccount(params)).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each(['CREDENTIALS_INVALID', 'DISABLED', 'WITHDRAWAL_ENABLED_REJECTED'])(
    'refuses a %s account',
    async (status) => {
      const { service } = build({ id: 'ta-1', tenantId: TENANT, status });
      await expect(service.bindExchangeAccount(params)).rejects.toThrow(
        `Exchange account status ${status} invalid`,
      );
    },
  );
});

describe('TradingActivationService exchange-account check', () => {
  const policy = {
    resolvePolicy: jest.fn(async () => ({
      tradingActivationPrerequisites: {
        requireCompliance: false,
        requireKyc: false,
        requireAml: false,
        requireSecurityMfa: false,
        requireRisk: false,
        requireExchangeBinding: true,
        requirePortfolioBinding: false,
        requireCredential: false,
      },
    })),
  };

  async function exchangeCheck(tradingAccount: unknown) {
    const prisma = fakePrisma({
      institutionalAccount: {
        findFirst: jest.fn(async () => ({ ...ACCOUNT, exchangeAccountId: 'ta-1' })),
      },
      tradingAccount: { findFirst: jest.fn(async () => tradingAccount) },
    });
    const service = new TradingActivationService(prisma, policy as any);
    const result = await service.evaluateEligibility({ tenantId: TENANT, accountId: ACCOUNT.id });
    return result.blockingEvidence.find(
      (c: { check: string }) => c.check === 'exchangeAccountState',
    );
  }

  it('passes for a verified ACTIVE trading account', async () => {
    await expect(
      exchangeCheck({ id: 'ta-1', tenantId: TENANT, status: 'ACTIVE' }),
    ).resolves.toMatchObject({ passed: true });
  });

  it.each(['PENDING_VALIDATION', 'CREDENTIALS_INVALID', 'DISABLED', 'WITHDRAWAL_ENABLED_REJECTED'])(
    'fails for %s',
    async (status) => {
      await expect(exchangeCheck({ id: 'ta-1', tenantId: TENANT, status })).resolves.toMatchObject({
        passed: false,
      });
    },
  );

  it('fails when the bound account no longer exists', async () => {
    await expect(exchangeCheck(null)).resolves.toMatchObject({ passed: false });
  });
});

describe('LifecycleReconciliationService exchange bindings', () => {
  async function reconcile(tradingAccount: unknown) {
    const prisma = fakePrisma({
      clientProfile: {
        findFirst: jest.fn(async () => ({ id: 'cp-1', tenantId: TENANT, status: 'PENDING' })),
      },
      institutionalAccount: {
        findMany: jest.fn(async () => [{ ...ACCOUNT, exchangeAccountId: 'ta-1' }]),
      },
      accountOwnership: { findFirst: jest.fn(async () => ({ id: 'own-1' })) },
      tradingAccount: { findFirst: jest.fn(async () => tradingAccount) },
    });
    const service = new LifecycleReconciliationService(prisma);
    const { discrepancies } = await service.reconcileClientProfile({
      tenantId: TENANT,
      clientProfileId: 'cp-1',
    });
    return discrepancies.map((d) => d.type);
  }

  it('does not flag a binding whose trading account exists', async () => {
    await expect(
      reconcile({ id: 'ta-1', tenantId: TENANT, status: 'ACTIVE' }),
    ).resolves.not.toContain('EXCHANGE_BINDING_ORPHANED');
  });

  it('flags a binding whose trading account is gone', async () => {
    await expect(reconcile(null)).resolves.toContain('EXCHANGE_BINDING_ORPHANED');
  });
});

describe('PortfolioBindingService', () => {
  const audit = { log: jest.fn(async () => undefined) };

  function build(portfolio: unknown) {
    const portfolioFindFirst = jest.fn(async () => portfolio);
    const prisma = fakePrisma({
      institutionalAccount: {
        findFirst: jest.fn(async ({ where }: any) => (where.id === ACCOUNT.id ? ACCOUNT : null)),
        update: jest.fn(async () => ACCOUNT),
      },
      portfolioAccountingProfile: { findFirst: portfolioFindFirst },
    });
    return { service: new PortfolioBindingService(prisma, audit as any), portfolioFindFirst };
  }

  const params = { tenantId: TENANT, accountId: ACCOUNT.id, portfolioId: 'pf-1' };

  it('resolves the portfolio as a PortfolioAccountingProfile in the same tenant', async () => {
    const { service, portfolioFindFirst } = build({
      id: 'pf-1',
      tenantId: TENANT,
      clientProfileId: 'cp-1',
    });
    await service.bindPortfolio(params);
    expect(portfolioFindFirst).toHaveBeenCalledWith({ where: { id: 'pf-1', tenantId: TENANT } });
  });

  it('refuses a portfolio that does not exist in this tenant', async () => {
    const { service } = build(null);
    await expect(service.bindPortfolio(params)).rejects.toBeInstanceOf(BadRequestException);
  });
});
