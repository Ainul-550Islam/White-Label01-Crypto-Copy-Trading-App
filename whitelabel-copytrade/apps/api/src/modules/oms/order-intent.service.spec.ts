// # Responsibility: verifies OMS intent admission delegates persistence through the atomic user-limit wrapper without forwarding reduceOnly as a bypass input.

import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { RiskDecisionService } from '../risk-management/risk-decision.service';
import type { PositionLimitService } from '../risk/position-limit.service';
import { OrderIntentService } from './order-intent.service';

const TENANT_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const ACCOUNT_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3302';

/**
 * The user position-limit guard reaches the order path here.
 *
 * This suite was parked with `describe.skip` while the guard was dead: the call it asserts
 * (`PositionLimitService.persistOrderIntentWithLimits`) existed only in specs, the service was in
 * no module's `providers`, the controller was in no module's `controllers`, and
 * `OrderIntentService` did not import it at all. A customer could set a ceiling, read it back, and
 * never have it consulted.
 *
 * The finding is closed by wiring the guard back into intent creation rather than by retiring it,
 * so the suite is live again and the third constructor argument it always described is real. The
 * assertion that has no equivalent elsewhere is the savepoint one: the intent write has a fallback
 * to the canonical Order table, and inside a transaction a failed statement aborts the whole
 * transaction, so the fallback is unreachable unless the write is wrapped in a savepoint. Remove
 * those two statements and the fallback silently stops working.
 */
describe('OrderIntentService user-position-limit integration', () => {
  it('persists the reduce-only order through the shared limit transaction without forwarding reduceOnly to the guard', async () => {
    const createdIntent = { id: 'intent-1', state: 'CREATED' };
    const transaction = {
      $executeRaw: jest.fn(async (_strings: TemplateStringsArray) => 1),
      omsOrderIntent: {
        create: jest.fn(async () => createdIntent),
      },
    };
    const account = {
      id: ACCOUNT_ID,
      tenantId: TENANT_ID,
      status: 'ACTIVE',
      liveTradingEnabled: false,
    };
    const prisma = {
      tradingAccount: {
        findFirst: jest.fn(async () => account),
        findUnique: jest.fn(async () => account),
      },
      tradingSymbol: {
        findFirst: jest.fn(async () => ({
          id: 'symbol-1',
          tenantId: TENANT_ID,
          symbol: 'BTC-USDT',
          minQuantity: '0.0001',
          maxQuantity: null,
          tickSize: '0.01',
          minNotional: null,
          quantityStep: '0.0001',
          exchange: {
            id: 'exchange-1',
            venue: 'PAPER',
            isEnabled: true,
            tradingEnabled: false,
          },
        })),
      },
      complianceScreeningRequest: {
        findFirst: jest.fn(async () => null),
      },
      securityThreatSignal: {
        findFirst: jest.fn(async () => null),
      },
    };
    const riskDecisionService = {
      evaluateUnifiedRisk: jest.fn(async () => ({
        id: 'risk-decision-1',
        policyVersion: 'policy-v1',
        decision: 'ALLOW',
        blockingReasons: [],
      })),
    };
    const positionLimitService = {
      persistOrderIntentWithLimits: jest.fn(async (input: {
        tenantId: string;
        accountId: string;
        symbol: string;
        persist: (tx: Prisma.TransactionClient) => Promise<unknown>;
      }) => input.persist(transaction as unknown as Prisma.TransactionClient)),
    };
    const outbox = { append: jest.fn(async () => undefined) };
    const service = new OrderIntentService(
      prisma as unknown as PrismaService,
      riskDecisionService as unknown as RiskDecisionService,
      positionLimitService as unknown as PositionLimitService,
      outbox as never,
    );

    const result = await service.createIntent({
      tenantId: TENANT_ID,
      accountId: ACCOUNT_ID,
      symbol: 'BTC-USDT',
      side: 'SELL',
      orderType: 'MARKET',
      quantity: '0.01',
      reduceOnly: true,
      environment: 'PAPER',
      source: 'MANUAL',
    });

    expect(result).toBe(createdIntent);
    expect(positionLimitService.persistOrderIntentWithLimits).toHaveBeenCalledTimes(1);
    const guardInput = positionLimitService.persistOrderIntentWithLimits.mock.calls[0]?.[0];
    expect(guardInput).toEqual(expect.objectContaining({
      tenantId: TENANT_ID,
      accountId: ACCOUNT_ID,
      symbol: 'BTC-USDT',
      persist: expect.any(Function),
    }));
    expect(Object.prototype.hasOwnProperty.call(guardInput, 'reduceOnly')).toBe(false);
    const savepointSql = transaction.$executeRaw.mock.calls.map(([query]) => Array.from(query).join(''));
    expect(savepointSql).toEqual([
      'SAVEPOINT oms_order_intent_persist',
      'RELEASE SAVEPOINT oms_order_intent_persist',
    ]);
    expect(transaction.omsOrderIntent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: TENANT_ID,
        accountId: ACCOUNT_ID,
        symbol: 'BTC-USDT',
        reduceOnly: true,
        environment: 'PAPER',
      }),
    });
    expect(outbox.append).toHaveBeenCalledWith(transaction, expect.objectContaining({
      tenantId: TENANT_ID,
      aggregateType: 'order',
      aggregateId: 'intent-1',
      eventType: 'order.created',
      payload: expect.objectContaining({
        orderId: 'intent-1',
        status: 'CREATED',
        symbol: 'BTC-USDT',
        side: 'SELL',
        quantity: '0.01',
        price: null,
      }),
    }));
  });
});
