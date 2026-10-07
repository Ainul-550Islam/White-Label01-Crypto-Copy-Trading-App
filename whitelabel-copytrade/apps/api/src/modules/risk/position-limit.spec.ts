// # Responsibility: proves owner scoping, exact active-reservation counting, audited settings, fail-closed behavior, and serialized concurrent OMS admission.

import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PositionLimitService } from './position-limit.service';

const TENANT_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const USER_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3302';
const ACCOUNT_A = '3f2504e0-4f89-41d3-9a0c-0305e82c3303';
const ACCOUNT_B = '3f2504e0-4f89-41d3-9a0c-0305e82c3304';

type TestPolicy = {
  id?: string;
  tenantId?: string;
  userId?: string;
  maxConcurrentPositions: number | null;
  maxOpenOrders: number | null;
  createdAt?: Date;
  updatedAt?: Date;
};

type TestOrder = {
  accountId: string;
  symbol: string;
  clientOrderId: string;
  reduceOnly?: boolean;
};

type TestPosition = {
  accountId: string;
  symbol: string;
  quantity: string;
};

type TestTrade = {
  accountId: string;
  symbol: string;
  state: string;
};

type TestState = {
  account: { id: string; userId: string | null };
  accounts: Array<{ id: string }>;
  userExists: boolean;
  policy: TestPolicy | null;
  intents: TestOrder[];
  orders: TestOrder[];
  positions: TestPosition[];
  trades: TestTrade[];
  usageReadFails: boolean;
  auditRows: Array<Record<string, unknown>>;
};

function makeState(overrides: Partial<TestState> = {}): TestState {
  return {
    account: { id: ACCOUNT_A, userId: USER_ID },
    accounts: [{ id: ACCOUNT_A }, { id: ACCOUNT_B }],
    userExists: true,
    policy: null,
    intents: [],
    orders: [],
    positions: [],
    trades: [],
    usageReadFails: false,
    auditRows: [],
    ...overrides,
  };
}

function makeService(state: TestState) {
  const tx = {
    $queryRaw: jest.fn(async (_strings: TemplateStringsArray, _lockName: string) => []),
    user: {
      findFirst: jest.fn(async () => (state.userExists ? { id: USER_ID } : null)),
    },
    tradingAccount: {
      findFirst: jest.fn(async () => state.account),
      findMany: jest.fn(async () => state.accounts),
    },
    userPositionLimit: {
      findUnique: jest.fn(async () => state.policy),
      upsert: jest.fn(async (args: {
        create: {
          tenantId: string;
          userId: string;
          maxConcurrentPositions: number | null;
          maxOpenOrders: number | null;
        };
        update: {
          maxConcurrentPositions: number | null;
          maxOpenOrders: number | null;
        };
      }) => {
        state.policy = {
          id: state.policy?.id ?? 'limit-1',
          tenantId: args.create.tenantId,
          userId: args.create.userId,
          createdAt: state.policy?.createdAt ?? new Date('2026-10-07T00:00:00.000Z'),
          updatedAt: new Date('2026-10-07T00:01:00.000Z'),
          maxConcurrentPositions: args.update.maxConcurrentPositions,
          maxOpenOrders: args.update.maxOpenOrders,
        };
        return state.policy;
      }),
    },
    auditLog: {
      create: jest.fn(async (args: { data: Record<string, unknown> }) => {
        state.auditRows.push(args.data);
        return args.data;
      }),
    },
    omsOrderIntent: {
      findMany: jest.fn(async () => [...state.intents]),
    },
    order: {
      findMany: jest.fn(async () => [...state.orders]),
    },
    position: {
      findMany: jest.fn(async () => {
        if (state.usageReadFails) throw Object.assign(new Error('position source unavailable'), { code: 'P1001' });
        return [...state.positions];
      }),
    },
    omsTrade: {
      findMany: jest.fn(async () => {
        if (state.usageReadFails) throw Object.assign(new Error('trade source unavailable'), { code: 'P1001' });
        return [...state.trades];
      }),
    },
  };
  const prisma = {
    withTenantRls: jest.fn(async (
      tenantId: string,
      work: (client: Prisma.TransactionClient) => Promise<unknown>,
    ) => {
      expect(tenantId).toBe(TENANT_ID);
      return work(tx as unknown as Prisma.TransactionClient);
    }),
  };
  return { service: new PositionLimitService(prisma as unknown as PrismaService), prisma, tx };
}

function responseCode(error: unknown): unknown {
  if (!(error instanceof ConflictException)) return undefined;
  const response = error.getResponse();
  return typeof response === 'object' && response !== null && 'code' in response
    ? (response as { code?: unknown }).code
    : undefined;
}

describe('PositionLimitService', () => {
  it('counts positions, active trades, and open order reservations as a deduplicated user-wide union', async () => {
    const state = makeState({
      positions: [
        { accountId: ACCOUNT_A, symbol: 'BTC-USDT', quantity: '0.125000000000' },
        { accountId: ACCOUNT_A, symbol: 'FLAT-USDT', quantity: '0' },
      ],
      trades: [
        { accountId: ACCOUNT_A, symbol: 'BTC-USDT', state: 'OPEN' },
        { accountId: ACCOUNT_B, symbol: 'ETH-USDT', state: 'PARTIAL' },
      ],
      intents: [
        { accountId: ACCOUNT_A, symbol: 'SOL-USDT', clientOrderId: 'client-sol', reduceOnly: false },
      ],
      orders: [
        { accountId: ACCOUNT_A, symbol: 'SOL-USDT', clientOrderId: 'client-sol', reduceOnly: false },
        { accountId: ACCOUNT_B, symbol: 'XRP-USDT', clientOrderId: 'client-xrp', reduceOnly: true },
      ],
    });
    const { service, tx } = makeService(state);

    const view = await service.getMyLimits({ tenantId: TENANT_ID, userId: USER_ID });

    expect(view).toMatchObject({
      tenantId: TENANT_ID,
      limits: { maxConcurrentPositions: null, maxOpenOrders: null },
      configured: false,
      usageState: 'CURRENT',
      usage: { ownedAccountCount: 2, openPositionSlots: 4, openOrderCount: 2 },
    });
    expect(tx.tradingAccount.findMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT_ID, userId: USER_ID, deletedAt: null },
      select: { id: true },
    });
  });

  it('blocks a new symbol when the per-user concurrent position ceiling is full', async () => {
    const state = makeState({
      policy: { maxConcurrentPositions: 1, maxOpenOrders: null },
      positions: [{ accountId: ACCOUNT_A, symbol: 'BTC-USDT', quantity: '1' }],
    });
    const { service } = makeService(state);
    const persist = jest.fn(async () => ({ id: 'must-not-persist' }));

    const rejection = await service
      .persistOrderIntentWithLimits({
        tenantId: TENANT_ID,
        accountId: ACCOUNT_A,
        symbol: 'ETH-USDT',
        persist,
      })
      .catch((error: unknown) => error);

    expect(responseCode(rejection)).toBe('USER_CONCURRENT_POSITION_LIMIT_EXCEEDED');
    expect(persist).not.toHaveBeenCalled();
  });

  it('allows another order in an already-counted account/symbol slot without trusting reduceOnly to bypass a new slot', async () => {
    const state = makeState({
      policy: { maxConcurrentPositions: 1, maxOpenOrders: null },
      positions: [{ accountId: ACCOUNT_A, symbol: 'BTC-USDT', quantity: '0.5' }],
    });
    const { service, tx } = makeService(state);
    const persist = jest.fn(async () => ({ id: 'intent-btc' }));

    const result = await service.persistOrderIntentWithLimits({
      tenantId: TENANT_ID,
      accountId: ACCOUNT_A,
      symbol: 'btc-usdt',
      persist,
    });

    expect(result).toEqual({ id: 'intent-btc' });
    expect(persist).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    const lockCall = tx.$queryRaw.mock.calls[0] as unknown as [TemplateStringsArray, string];
    expect(lockCall[0][0]).toContain('pg_advisory_xact_lock(hashtextextended(');
    expect(lockCall[1]).toBe(`user-position-limits:${TENANT_ID}:${USER_ID}`);
  });

  it('deduplicates OMS intent and canonical order by clientOrderId, then blocks the next order at the ceiling', async () => {
    const state = makeState({
      policy: { maxConcurrentPositions: null, maxOpenOrders: 1 },
      intents: [
        { accountId: ACCOUNT_A, symbol: 'BTC-USDT', clientOrderId: 'same-client-id', reduceOnly: false },
      ],
      orders: [
        { accountId: ACCOUNT_A, symbol: 'BTC-USDT', clientOrderId: 'same-client-id', reduceOnly: false },
      ],
    });
    const { service } = makeService(state);
    const persist = jest.fn(async () => ({ id: 'must-not-persist' }));

    const rejection = await service
      .persistOrderIntentWithLimits({
        tenantId: TENANT_ID,
        accountId: ACCOUNT_B,
        symbol: 'ETH-USDT',
        persist,
      })
      .catch((error: unknown) => error);

    expect(responseCode(rejection)).toBe('USER_OPEN_ORDER_LIMIT_EXCEEDED');
    expect(persist).not.toHaveBeenCalled();
  });

  it('serializes concurrent submissions so exactly one intent consumes a one-order user ceiling', async () => {
    const activeIntents: TestOrder[] = [];
    let lockTail = Promise.resolve();
    const state = makeState({
      accounts: [{ id: ACCOUNT_A }],
      policy: { maxConcurrentPositions: null, maxOpenOrders: 1 },
    });

    const createTransactionClient = (setRelease: (release: () => void) => void) => ({
      $queryRaw: async (_strings: TemplateStringsArray, lockName: string) => {
        expect(lockName).toBe(`user-position-limits:${TENANT_ID}:${USER_ID}`);
        const previous = lockTail;
        let releaseCurrent: () => void = () => undefined;
        const current = new Promise<void>((resolve) => {
          releaseCurrent = resolve;
        });
        lockTail = previous.then(() => current);
        await previous;
        setRelease(releaseCurrent);
        return [];
      },
      tradingAccount: {
        findFirst: async () => ({ id: ACCOUNT_A, userId: USER_ID }),
        findMany: async () => [{ id: ACCOUNT_A }],
      },
      userPositionLimit: {
        findUnique: async () => state.policy,
      },
      omsOrderIntent: {
        findMany: async () => [...activeIntents],
      },
      order: {
        findMany: async () => [],
      },
      position: {
        findMany: async () => [],
      },
      omsTrade: {
        findMany: async () => [],
      },
    });

    const prisma = {
      withTenantRls: async (
        _tenantId: string,
        work: (client: Prisma.TransactionClient) => Promise<unknown>,
      ) => {
        const releaseRef: { unlock?: () => void } = {};
        const tx = createTransactionClient((unlock) => {
          releaseRef.unlock = unlock;
        });
        try {
          return await work(tx as unknown as Prisma.TransactionClient);
        } finally {
          releaseRef.unlock?.();
        }
      },
    };
    const service = new PositionLimitService(prisma as unknown as PrismaService);

    const submit = (symbol: string) =>
      service.persistOrderIntentWithLimits({
        tenantId: TENANT_ID,
        accountId: ACCOUNT_A,
        symbol,
        persist: async () => {
          activeIntents.push({
            accountId: ACCOUNT_A,
            symbol,
            clientOrderId: `client-${symbol}`,
            reduceOnly: false,
          });
          await Promise.resolve();
          return { symbol };
        },
      });

    const results = await Promise.allSettled([submit('BTC-USDT'), submit('ETH-USDT')]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(responseCode((rejected[0] as PromiseRejectedResult).reason)).toBe('USER_OPEN_ORDER_LIMIT_EXCEEDED');
    expect(activeIntents).toHaveLength(1);
  });

  it('saves limits and an audit record in one tenant transaction while preserving omitted settings', async () => {
    const state = makeState({
      policy: {
        id: 'limit-1',
        tenantId: TENANT_ID,
        userId: USER_ID,
        maxConcurrentPositions: 7,
        maxOpenOrders: null,
        createdAt: new Date('2026-10-01T00:00:00.000Z'),
        updatedAt: new Date('2026-10-01T00:00:00.000Z'),
      },
      accounts: [],
    });
    const { service, prisma, tx } = makeService(state);

    const view = await service.updateMyLimits({
      tenantId: TENANT_ID,
      userId: USER_ID,
      patch: { maxOpenOrders: 0 },
      requestId: 'request-position-limits-1',
    });

    expect(view.limits).toEqual({ maxConcurrentPositions: 7, maxOpenOrders: 0 });
    expect(view.configured).toBe(true);
    expect(view.usage).toEqual({ ownedAccountCount: 0, openPositionSlots: 0, openOrderCount: 0 });
    expect(prisma.withTenantRls).toHaveBeenCalledWith(TENANT_ID, expect.any(Function));
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: TENANT_ID,
        actorId: USER_ID,
        action: 'USER_POSITION_LIMIT_UPDATED',
        resourceType: 'USER_POSITION_LIMIT',
        requestId: 'request-position-limits-1',
        changes: expect.objectContaining({
          maxConcurrentPositions: { before: 7, after: 7 },
          maxOpenOrders: { before: null, after: 0 },
        }),
      }),
    });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('rejects writes for a user identity that is not active in the authenticated tenant', async () => {
    const state = makeState({ userExists: false });
    const { service, tx } = makeService(state);

    await expect(
      service.updateMyLimits({
        tenantId: TENANT_ID,
        userId: USER_ID,
        patch: { maxConcurrentPositions: 2 },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(tx.userPositionLimit.upsert).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('fails closed on a zero order ceiling and null restores the unlimited setting', async () => {
    const state = makeState({
      policy: { maxConcurrentPositions: null, maxOpenOrders: 0 },
      accounts: [{ id: ACCOUNT_A }],
    });
    const { service } = makeService(state);
    const persist = jest.fn(async () => ({ id: 'intent-after-clear' }));

    const blocked = await service
      .persistOrderIntentWithLimits({
        tenantId: TENANT_ID,
        accountId: ACCOUNT_A,
        symbol: 'BTC-USDT',
        persist,
      })
      .catch((error: unknown) => error);
    expect(responseCode(blocked)).toBe('USER_OPEN_ORDER_LIMIT_EXCEEDED');
    expect(persist).not.toHaveBeenCalled();

    const cleared = await service.updateMyLimits({
      tenantId: TENANT_ID,
      userId: USER_ID,
      patch: { maxOpenOrders: null },
    });
    expect(cleared.limits).toEqual({ maxConcurrentPositions: null, maxOpenOrders: null });
    expect(cleared.configured).toBe(false);

    await expect(
      service.persistOrderIntentWithLimits({
        tenantId: TENANT_ID,
        accountId: ACCOUNT_A,
        symbol: 'BTC-USDT',
        persist,
      }),
    ).resolves.toEqual({ id: 'intent-after-clear' });
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('fails closed before persistence when any canonical usage source is unreadable', async () => {
    const state = makeState({
      policy: { maxConcurrentPositions: null, maxOpenOrders: 1 },
      usageReadFails: true,
    });
    const { service } = makeService(state);
    const persist = jest.fn(async () => ({ id: 'must-not-persist' }));

    await expect(
      service.persistOrderIntentWithLimits({
        tenantId: TENANT_ID,
        accountId: ACCOUNT_A,
        symbol: 'BTC-USDT',
        persist,
      }),
    ).rejects.toBeInstanceOf(Error);
    expect(persist).not.toHaveBeenCalled();
  });

  it('returns UNKNOWN usage rather than fabricated zero counts when canonical usage reads fail', async () => {
    const state = makeState({
      policy: { maxConcurrentPositions: 3, maxOpenOrders: 4 },
      usageReadFails: true,
    });
    const { service } = makeService(state);

    const view = await service.getMyLimits({ tenantId: TENANT_ID, userId: USER_ID });

    expect(view.usageState).toBe('UNKNOWN');
    expect(view.usage).toBeNull();
    expect(view.limits).toEqual({ maxConcurrentPositions: 3, maxOpenOrders: 4 });
  });

  it('rejects negative, fractional, and out-of-database-range input before opening a tenant transaction', async () => {
    const invalidPatches: Array<{
      maxConcurrentPositions?: number | null;
      maxOpenOrders?: number | null;
    }> = [
      { maxConcurrentPositions: -1 },
      { maxConcurrentPositions: 1.5 },
      { maxOpenOrders: 2_147_483_648 },
    ];

    for (const patch of invalidPatches) {
      const { service, prisma, tx } = makeService(makeState());
      await expect(
        service.updateMyLimits({ tenantId: TENANT_ID, userId: USER_ID, patch }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.withTenantRls).not.toHaveBeenCalled();
      expect(tx.userPositionLimit.upsert).not.toHaveBeenCalled();
      expect(tx.auditLog.create).not.toHaveBeenCalled();
    }
  });

  it('fails closed on malformed configured limits and rejects an empty settings update', async () => {
    const malformed = makeState({ policy: { maxConcurrentPositions: -1, maxOpenOrders: null } });
    const { service: malformedService } = makeService(malformed);
    await expect(malformedService.getMyLimits({ tenantId: TENANT_ID, userId: USER_ID })).rejects.toThrow(
      /Stored maxConcurrentPositions/,
    );

    const empty = makeState();
    const { service: emptyService } = makeService(empty);
    await expect(
      emptyService.updateMyLimits({ tenantId: TENANT_ID, userId: USER_ID, patch: {} }),
    ).rejects.toThrow(/At least one position or open-order limit/);
  });
});
