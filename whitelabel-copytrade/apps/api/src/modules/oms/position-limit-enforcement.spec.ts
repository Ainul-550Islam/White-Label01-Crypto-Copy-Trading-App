// # Proves the order path enforces the user's position and open-order ceilings
//
// The ceiling service was complete, tested and correct, and it was in no module's `providers`;
// `UserPositionLimitController` was in no module's `controllers`; and nothing on the order path
// called `persistOrderIntentWithLimits`. A customer could set a limit, read it back from the API,
// and have it never consulted when an order was placed.
//
// This file is the evidence that the wiring exists, and it is written so that removing the wiring
// fails it. Two independent angles:
//
// 1. Behaviour - `createIntent` is driven with a limiter whose reservation refuses, and with a
//    limiter that hands back a transaction client. If `createIntent` stops routing through the
//    limiter, the refusal is never seen and the intent is written on the plain client: both halves
//    of that are asserted, so either change fails here.
// 2. Structure - the module metadata is read directly, so deleting `PositionLimitService` from
//    `RiskManagementModule` or the controller from `controllers` fails a test even if some other
//    path kept the behaviour alive.
import 'reflect-metadata';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { RiskManagementModule } from '../risk-management/risk-management.module';
import { UserPositionLimitController } from '../risk-management/user-position-limit.controller';
import { PositionLimitService } from '../risk/position-limit.service';
import { OrderIntentService } from './order-intent.service';
import { OrderIntentState } from './oms.types';

const TENANT_ID = 'tenant-1';
const ACCOUNT_ID = 'account-1';
const SYMBOL = 'BTC-USDT';

/**
 * A limiter that records every reservation it is asked to make and answers with the given verdict.
 * `verified` is what an intent must reach when the reservation is allowed, so a test can tell a
 * written intent from a refused one.
 */
function limiterThat(verdict: 'ALLOW' | 'REFUSE') {
  const reservations: { tenantId: string; accountId: string; symbol: string }[] = [];
  const tx = {
    // Tagged-template call, matching how the service issues its savepoint statements.
    $executeRaw: jest.fn(async (_strings: TemplateStringsArray) => 1),
    omsOrderIntent: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'intent-1',
        ...data,
        state: OrderIntentState.CREATED,
      })),
    },
    order: { create: jest.fn() },
  };
  const service = {
    persistOrderIntentWithLimits: jest.fn(
      async (params: {
        tenantId: string;
        accountId: string;
        symbol: string;
        persist: (client: unknown) => Promise<unknown>;
      }) => {
        reservations.push({ tenantId: params.tenantId, accountId: params.accountId, symbol: params.symbol });
        if (verdict === 'REFUSE') {
          const refusal = new Error('USER_CONCURRENT_POSITION_LIMIT_EXCEEDED');
          (refusal as Error & { code?: string }).code = 'USER_CONCURRENT_POSITION_LIMIT_EXCEEDED';
          throw refusal;
        }
        return params.persist(tx);
      },
    ),
  };
  return { service, reservations, tx };
}

function buildService(limiter: { persistOrderIntentWithLimits: jest.Mock }, prismaOverrides: Record<string, unknown> = {}) {
  const prisma = {
    tradingAccount: {
      findFirst: jest.fn(async () => ({ id: ACCOUNT_ID, userId: 'user-1', status: 'ACTIVE', liveTradingEnabled: true })),
      findUnique: jest.fn(async () => ({ id: ACCOUNT_ID, userId: 'user-1', status: 'ACTIVE', liveTradingEnabled: true })),
    },
    tradingSymbol: {
      findFirst: jest.fn(async () => ({
        id: 'symbol-1',
        symbol: SYMBOL,
        minQuantity: '0.0001',
        maxQuantity: '100',
        quantityStep: '0.0001',
        priceStep: '0.01',
        exchange: { id: 'exchange-1', venue: 'BINANCE', isEnabled: true, tradingEnabled: true },
      })),
    },
    exchangeCredential: { findFirst: jest.fn(async () => ({ id: 'cred-1' })) },
    complianceScreeningRequest: { findFirst: jest.fn(async () => null) },
    securityThreatSignal: { findFirst: jest.fn(async () => null) },
    ...prismaOverrides,
  };
  const riskDecisionService = {
    evaluateUnifiedRisk: jest.fn(async () => ({ decision: 'ALLOW', blockingReasons: [], policyVersion: 'v1' })),
  };
  const outbox = { append: jest.fn(async () => undefined) };
  const service = new OrderIntentService(
    prisma as never,
    riskDecisionService as never,
    limiter as unknown as PositionLimitService,
    outbox as never,
  );
  return { service, prisma, riskDecisionService, outbox };
}

function intentParams() {
  return {
    tenantId: TENANT_ID,
    accountId: ACCOUNT_ID,
    symbol: SYMBOL,
    side: 'BUY',
    orderType: 'LIMIT',
    quantity: '0.5',
    price: '60000',
    environment: 'PAPER',
    source: 'MANUAL',
    userId: 'user-1',
  } as never;
}

describe('OrderIntentService routes every intent through the position-limit reservation', () => {
  it('asks the limiter to reserve before it writes anything', async () => {
    const limiter = limiterThat('ALLOW');
    const { service } = buildService(limiter.service);

    await service.createIntent(intentParams());

    expect(limiter.service.persistOrderIntentWithLimits).toHaveBeenCalledTimes(1);
    expect(limiter.reservations).toEqual([
      { tenantId: TENANT_ID, accountId: ACCOUNT_ID, symbol: SYMBOL },
    ]);
  });

  it('writes the intent on the limiter\'s client, not on this.prisma', async () => {
    // The lock only means anything if the insert commits inside it. A write on the plain client
    // would slip past the reservation and two concurrent intents could both pass a ceiling they
    // jointly exceed, so the client identity is asserted rather than assumed.
    const limiter = limiterThat('ALLOW');
    const plainCreate = jest.fn(async () => ({ id: 'wrong-client' }));
    const { service, prisma } = buildService(limiter.service, {
      omsOrderIntent: { create: plainCreate },
      order: { create: plainCreate },
    });

    const created = await service.createIntent(intentParams());

    expect(limiter.tx.omsOrderIntent.create).toHaveBeenCalledTimes(1);
    expect(plainCreate).not.toHaveBeenCalled();
    expect((created as { id: string }).id).toBe('intent-1');
  });

  it('surfaces the limiter\'s refusal instead of placing the order', async () => {
    const limiter = limiterThat('REFUSE');
    const omsCreate = jest.fn();
    const orderCreate = jest.fn();
    const { service } = buildService(limiter.service, {
      omsOrderIntent: { create: omsCreate },
      order: { create: orderCreate },
    });

    await expect(service.createIntent(intentParams())).rejects.toThrow(
      'USER_CONCURRENT_POSITION_LIMIT_EXCEEDED',
    );
    // Nothing was written anywhere: the refusal is a refusal, not a warning.
    expect(omsCreate).not.toHaveBeenCalled();
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it('reserves against the account the intent names, not a caller-supplied owner', async () => {
    // The limiter derives the user from the TradingAccount owner row internally; this asserts the
    // order path hands it the account identity to do that with, so a caller cannot nominate which
    // user's ceiling applies.
    const limiter = limiterThat('ALLOW');
    const { service } = buildService(limiter.service);

    await service.createIntent(intentParams());

    const call = limiter.service.persistOrderIntentWithLimits.mock.calls[0]?.[0] as {
      tenantId: string;
      accountId: string;
    };
    expect(call.tenantId).toBe(TENANT_ID);
    expect(call.accountId).toBe(ACCOUNT_ID);
  });
});

describe('the ceiling is registered where Nest can mount and inject it', () => {
  it('mounts the settings controller', () => {
    // Without this the routes do not exist and a customer has nowhere to set the limit that the
    // order path enforces. Read through Reflect because that is where @Module records the arrays
    // Nest builds the module from - a static property would prove nothing.
    const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, RiskManagementModule) as unknown[];
    expect(controllers).toContain(UserPositionLimitController);
  });

  it('provides and exports one PositionLimitService for both the settings route and the order path', () => {
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, RiskManagementModule) as unknown[];
    const exports = Reflect.getMetadata(MODULE_METADATA.EXPORTS, RiskManagementModule) as unknown[];
    expect(providers).toContain(PositionLimitService);
    // Exported, so the order path resolves the same instance the settings route writes to.
    expect(exports).toContain(PositionLimitService);
  });
});
