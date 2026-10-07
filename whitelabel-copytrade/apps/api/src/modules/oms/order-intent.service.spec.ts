// # Responsibility: verifies OMS intent admission delegates persistence through the atomic user-limit wrapper without forwarding reduceOnly as a bypass input.

import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { RiskDecisionService } from '../risk-management/risk-decision.service';
import type { PositionLimitService } from '../risk/position-limit.service';
import { OrderIntentService } from './order-intent.service';

const TENANT_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const ACCOUNT_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3302';

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
    const service = new OrderIntentService(
      prisma as unknown as PrismaService,
      riskDecisionService as unknown as RiskDecisionService,
      positionLimitService as unknown as PositionLimitService,
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
  });
});
