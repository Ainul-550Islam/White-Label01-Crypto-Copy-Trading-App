// # Proves copy subscription lifecycle state changes commit with schema-valid outbox events

import { FollowerSubscriptionService } from './follower-subscription.service';
import { CopySizingMode, CopySubscriptionState } from './copy-trading.types';
import { validateDeveloperEventPayload } from '../developer-platform/event-schemas/developer-event-schemas';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const SUBSCRIPTION_ID = '33333333-3333-4333-8333-333333333333';
const FOLLOWER_ID = '44444444-4444-4444-8444-444444444444';
const TRADER_ID = '55555555-5555-4555-8555-555555555555';
const STRATEGY_ID = '66666666-6666-4666-8666-666666666666';

interface CapturedEvent {
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
}

function buildHarness(options: { initialState?: CopySubscriptionState | null; failAppend?: boolean } = {}) {
  let committedState = options.initialState ?? null;
  const capturedEvents: CapturedEvent[] = [];
  const transactionStates: Array<{ staged: { state: CopySubscriptionState | null } }> = [];

  const outbox = {
    append: jest.fn(async (_tx: unknown, input: CapturedEvent) => {
      if (options.failAppend) {
        throw new Error('outbox append failed');
      }
      const validation = validateDeveloperEventPayload(input.eventType, input.payload);
      if (!validation.valid) {
        throw new Error(`invalid ${input.eventType} test event: ${validation.errors.join('; ')}`);
      }
      capturedEvents.push(input);
      return { id: `outbox-${capturedEvents.length}` };
    }),
  };

  const prisma = {
    complianceCase: { findFirst: jest.fn(async () => null) },
    withTenantRls: jest.fn(async (_tenantId: string, work: (tx: { staged: { state: CopySubscriptionState | null } }) => Promise<unknown>) => {
      const staged = { state: committedState };
      const tx = { staged };
      transactionStates.push(tx);
      const result = await work(tx);
      committedState = staged.state;
      return result;
    }),
    copyTradingAuditLog: { create: jest.fn(async () => ({})) },
  };

  const subscriptionRepo = {
    create: jest.fn(async (input: Record<string, unknown>, tx: { staged: { state: CopySubscriptionState | null } }) => {
      tx.staged.state = CopySubscriptionState.PENDING;
      return {
        id: SUBSCRIPTION_ID,
        tenantId: TENANT_ID,
        followerId: FOLLOWER_ID,
        traderId: TRADER_ID,
        strategyId: STRATEGY_ID,
        ...input,
        state: CopySubscriptionState.PENDING,
      };
    }),
    findById: jest.fn(async (subscriptionId: string, tenantId: string) => {
      if (subscriptionId !== SUBSCRIPTION_ID || tenantId !== TENANT_ID || committedState === null) {
        return null;
      }
      return {
        id: SUBSCRIPTION_ID,
        subscriptionId: SUBSCRIPTION_ID,
        tenantId: TENANT_ID,
        followerId: FOLLOWER_ID,
        traderId: TRADER_ID,
        strategyId: STRATEGY_ID,
        state: committedState,
        updatedAt: new Date('2026-10-09T00:00:00.000Z'),
      };
    }),
    updateState: jest.fn(async (
      subscriptionId: string,
      tenantId: string,
      nextState: CopySubscriptionState,
      _timestamps: Record<string, Date> | undefined,
      context: { tx: { staged: { state: CopySubscriptionState | null } }; expectedState: CopySubscriptionState },
    ) => {
      if (
        subscriptionId !== SUBSCRIPTION_ID ||
        tenantId !== TENANT_ID ||
        context.tx.staged.state !== context.expectedState
      ) {
        return null;
      }
      context.tx.staged.state = nextState;
      return {
        id: SUBSCRIPTION_ID,
        subscriptionId: SUBSCRIPTION_ID,
        tenantId: TENANT_ID,
        followerId: FOLLOWER_ID,
        traderId: TRADER_ID,
        strategyId: STRATEGY_ID,
        state: nextState,
        updatedAt: new Date('2026-10-09T00:00:00.000Z'),
      };
    }),
  };

  const traderProfileService = {
    getProfile: jest.fn(async () => ({ id: TRADER_ID, traderId: TRADER_ID })),
    incrementFollowerCount: jest.fn(async () => undefined),
    decrementFollowerCount: jest.fn(async () => undefined),
  };
  const traderStrategyService = {
    getStrategy: jest.fn(async () => ({ id: STRATEGY_ID, strategyId: STRATEGY_ID, traderId: TRADER_ID, status: 'PUBLISHED' })),
  };
  const allocationService = { validateAllocation: jest.fn(async () => ({ valid: true })) };
  const copySubsGuard = { reserve: jest.fn(async () => undefined), release: jest.fn(async () => undefined) };
  const followersGuard = { reserve: jest.fn(async () => undefined), release: jest.fn(async () => undefined) };
  const maintenance = { enforceMaintenanceGate: jest.fn(async () => undefined) };
  const policyService = { validatePolicy: jest.fn(() => ({ valid: true, errors: [] })) };

  const service = new FollowerSubscriptionService(
    prisma as never,
    subscriptionRepo as never,
    allocationService as never,
    policyService as never,
    traderProfileService as never,
    traderStrategyService as never,
    followersGuard as never,
    copySubsGuard as never,
    maintenance as never,
    outbox as never,
  );

  return {
    service,
    prisma,
    subscriptionRepo,
    outbox,
    capturedEvents,
    transactionStates,
    traderProfileService,
    committedState: () => committedState,
  };
}

describe('FollowerSubscriptionService transactional outbox events', () => {
  it('emits copy.subscription.created in the same tenant transaction as activation', async () => {
    const harness = buildHarness();

    const subscription = await harness.service.subscribe({
      tenantId: TENANT_ID,
      followerId: FOLLOWER_ID,
      traderId: TRADER_ID,
      strategyId: STRATEGY_ID,
      allocationMode: CopySizingMode.FIXED,
      allocationAmount: '100',
      actorId: FOLLOWER_ID,
    });

    expect(subscription).toMatchObject({ id: SUBSCRIPTION_ID, state: CopySubscriptionState.ACTIVE });
    expect(harness.committedState()).toBe(CopySubscriptionState.ACTIVE);
    expect(harness.outbox.append).toHaveBeenCalledTimes(1);
    expect(harness.outbox.append.mock.calls[0]?.[0]).toBe(harness.transactionStates[0]);
    expect(harness.capturedEvents[0]).toMatchObject({
      tenantId: TENANT_ID,
      aggregateType: 'copy.subscription',
      aggregateId: SUBSCRIPTION_ID,
      eventType: 'copy.subscription.created',
      payload: {
        subscriptionId: SUBSCRIPTION_ID,
        followerId: FOLLOWER_ID,
        traderId: TRADER_ID,
        strategyId: STRATEGY_ID,
        state: CopySubscriptionState.ACTIVE,
      },
    });
  });

  it('emits every copy subscription lifecycle event with distinct same-aggregate identities', async () => {
    const harness = buildHarness({ initialState: CopySubscriptionState.ACTIVE });

    await harness.service.pauseSubscription(TENANT_ID, SUBSCRIPTION_ID, FOLLOWER_ID, FOLLOWER_ID);
    await harness.service.resumeSubscription(TENANT_ID, SUBSCRIPTION_ID, FOLLOWER_ID, FOLLOWER_ID);
    await harness.service.pauseSubscription(TENANT_ID, SUBSCRIPTION_ID, FOLLOWER_ID, FOLLOWER_ID);
    await harness.service.stopCopy(TENANT_ID, SUBSCRIPTION_ID, FOLLOWER_ID, FOLLOWER_ID);
    await harness.service.cancelSubscription(TENANT_ID, SUBSCRIPTION_ID, FOLLOWER_ID, FOLLOWER_ID);

    expect(harness.capturedEvents.map((event) => event.eventType)).toEqual([
      'copy.subscription.paused',
      'copy.subscription.resumed',
      'copy.subscription.paused',
      'copy.subscription.stopped',
      'copy.subscription.cancelled',
    ]);
    const idempotencyKeys = harness.capturedEvents.map((event) => event.idempotencyKey);
    expect(new Set(idempotencyKeys).size).toBe(harness.capturedEvents.length);
    expect(idempotencyKeys[0]).not.toBe(idempotencyKeys[2]);
    for (const event of harness.capturedEvents) {
      expect(validateDeveloperEventPayload(event.eventType, event.payload)).toEqual({ valid: true, errors: [] });
    }
    expect(harness.committedState()).toBe(CopySubscriptionState.CANCELLED);
  });

  it('rolls a lifecycle state transition back when its outbox append fails', async () => {
    const harness = buildHarness({ initialState: CopySubscriptionState.ACTIVE, failAppend: true });

    await expect(
      harness.service.pauseSubscription(TENANT_ID, SUBSCRIPTION_ID, FOLLOWER_ID, FOLLOWER_ID),
    ).rejects.toThrow('outbox append failed');

    expect(harness.committedState()).toBe(CopySubscriptionState.ACTIVE);
    expect(harness.outbox.append).toHaveBeenCalledTimes(1);
    expect(harness.prisma.copyTradingAuditLog.create).not.toHaveBeenCalled();
  });
});
