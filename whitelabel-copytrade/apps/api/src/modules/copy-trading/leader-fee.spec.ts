// # Responsibility: protects versioned leader-fee policy, tenant isolation, idempotency, audit, exact rounding, and fail-closed preview semantics.

import { describe, expect, it, jest } from '@jest/globals';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { LeadTraderHighWaterMarkScope } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { FeePolicyService } from '../billing/fees/fee-policy.service';
import { AuditService } from '../audit/audit.service';
import { LeaderFeeService, calculateLeaderFeePreview } from './leader-fee.service';
import { SetLeaderFeePolicyDto } from './dto/leader-fee.dto';

const TENANT_ID = '11111111-2222-4333-8444-555555555555';
const TRADER_ID = '22222222-3333-4444-8555-666666666666';
const ACTOR_ID = '33333333-4444-4555-8666-777777777777';

function policyRecord(overrides: Partial<{
  id: string;
  tenantId: string;
  traderId: string;
  currency: string;
  profitShareBps: number;
  highWaterMarkScope: LeadTraderHighWaterMarkScope;
  version: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  createdAt: Date;
  requestFingerprint: string;
  idempotencyKey: string;
}> = {}) {
  return {
    id: '44444444-5555-4666-8777-888888888888',
    tenantId: TENANT_ID,
    traderId: TRADER_ID,
    currency: 'USD',
    profitShareBps: 500,
    highWaterMarkScope: LeadTraderHighWaterMarkScope.PER_FOLLOWER_CURRENCY,
    version: 1,
    effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    effectiveTo: null,
    createdByUserId: ACTOR_ID,
    requestFingerprint: 'f'.repeat(64),
    idempotencyKey: 'leader-fee-policy-key-0001',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function buildTransactionHarness() {
  const transaction = {
    leaderFeePolicy: {
      findFirst: jest.fn<() => Promise<unknown>>(),
      findMany: jest.fn<() => Promise<unknown>>(),
      create: jest.fn<() => Promise<unknown>>(),
      updateMany: jest.fn<() => Promise<unknown>>(),
    },
    traderProfile: { findFirst: jest.fn<() => Promise<unknown>>() },
    tenant: { findUnique: jest.fn<() => Promise<unknown>>() },
    user: { findFirst: jest.fn<() => Promise<unknown>>().mockResolvedValue({ id: ACTOR_ID }) },
  };
  const prismaMock = {
    ...transaction,
    $transaction: jest.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction)),
  };
  const auditService = { recordImmediate: jest.fn<() => Promise<void>>().mockResolvedValue(undefined) } as unknown as AuditService;
  const feePolicyService = {
    resolvePerformanceFeePolicy: jest.fn<() => Promise<unknown>>().mockResolvedValue({
      performanceFeeBps: 1000,
      source: 'plan',
      planId: 'plan-1',
      planCode: 'canonical-plan',
    }),
  };
  const service = new LeaderFeeService(
    prismaMock as unknown as PrismaService,
    auditService,
    feePolicyService as unknown as FeePolicyService,
  );
  return { service, prisma: prismaMock, transaction, auditService, feePolicyService };
}

const setPolicyInput: SetLeaderFeePolicyDto = {
  idempotencyKey: 'leader-fee-policy-key-0001',
  currency: 'USD',
  profitShareBps: 500,
  highWaterMarkScope: LeadTraderHighWaterMarkScope.PER_FOLLOWER_CURRENCY,
  effectiveFrom: '2030-01-01T00:00:00.000Z',
};

describe('calculateLeaderFeePreview', () => {
  it('uses exact integer arithmetic, a high-water-mark basis, and currency minor-unit half-up rounding', () => {
    const result = calculateLeaderFeePreview({
      currency: 'USD',
      cumulativeRealizedProfit: '100.05',
      openingHighWaterMark: '100.00',
      profitShareBps: 5000,
    });

    expect(result.eligibleProfitAboveHighWaterMark).toBe('0.05');
    expect(result.closingHighWaterMark).toBe('100.05');
    expect(result.feeAmount).toBe('0.03');
    expect(result.status).toBe('PREVIEW_ONLY');
    expect(result.calculationVersion).toBe('leader-fee-hwm-v1-integer-decimal');
  });

  it('does not create fee-eligible profit below the HWM or on a loss', () => {
    const below = calculateLeaderFeePreview({ currency: 'USDT', cumulativeRealizedProfit: '99.999999', openingHighWaterMark: '100', profitShareBps: 2500 });
    const loss = calculateLeaderFeePreview({ currency: 'USD', cumulativeRealizedProfit: '-12.34', openingHighWaterMark: '0', profitShareBps: 2000 });
    expect(below.eligibleProfitAboveHighWaterMark).toBe('0');
    expect(below.closingHighWaterMark).toBe('100');
    expect(below.feeAmount).toBe('0.000000');
    expect(loss.eligibleProfitAboveHighWaterMark).toBe('0');
    expect(loss.feeAmount).toBe('0.00');
  });

  it('rejects unsupported currencies, excess precision inputs, and out-of-range rates', () => {
    expect(() => calculateLeaderFeePreview({ currency: 'XYZ', cumulativeRealizedProfit: '1', openingHighWaterMark: '0', profitShareBps: 1 })).toThrow();
    expect(() => calculateLeaderFeePreview({ currency: 'USD', cumulativeRealizedProfit: '1.0000000000001', openingHighWaterMark: '0', profitShareBps: 1 })).toThrow();
    expect(() => calculateLeaderFeePreview({ currency: 'USD', cumulativeRealizedProfit: '1', openingHighWaterMark: '0', profitShareBps: 10001 })).toThrow();
  });
});

describe('LeaderFeeService public disclosure', () => {
  it('requires a public verified trader and returns the tenant-scoped active policy without claiming a charge', async () => {
    const { service, prisma } = buildTransactionHarness();
    const policy = policyRecord();
    prisma.traderProfile.findFirst = jest.fn<() => Promise<unknown>>().mockResolvedValue({ id: TRADER_ID });
    prisma.leaderFeePolicy.findFirst = jest.fn<() => Promise<unknown>>().mockResolvedValue(policy);

    const result = await service.getPublicPolicy(TENANT_ID, TRADER_ID, 'usd', new Date('2026-06-01T00:00:00.000Z'));

    expect(prisma.traderProfile.findFirst).toHaveBeenCalledWith({
      where: { id: TRADER_ID, tenantId: TENANT_ID, deletedAt: null, isPublic: true, verificationState: 'VERIFIED' },
      select: { id: true },
    });
    expect(prisma.leaderFeePolicy.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantId: TENANT_ID, traderId: TRADER_ID, currency: 'USD' }),
    }));
    expect(result.status).toBe('AVAILABLE');
    expect(result.policy?.profitShareBps).toBe(500);
    expect(result.feeCalculation.status).toBe('UNAVAILABLE');
    expect(result.feeCalculation.reason).toMatch(/posted follower-profit source/);
  });

  it('does not reveal a fee policy for a private or unverified trader', async () => {
    const { service, prisma } = buildTransactionHarness();
    prisma.traderProfile.findFirst = jest.fn<() => Promise<unknown>>().mockResolvedValue(null);
    await expect(service.getPublicPolicy(TENANT_ID, TRADER_ID, 'USD')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.leaderFeePolicy.findFirst).not.toHaveBeenCalled();
  });
});

describe('LeaderFeeService policy versioning', () => {
  it('creates a new version, closes the prior effective interval, and records an audit event', async () => {
    const { service, transaction, auditService } = buildTransactionHarness();
    const previous = policyRecord({ effectiveFrom: new Date('2026-01-01T00:00:00.000Z') });
    const created = policyRecord({
      id: '55555555-6666-4777-8888-999999999999',
      version: 2,
      profitShareBps: 750,
      effectiveFrom: new Date(setPolicyInput.effectiveFrom!),
      idempotencyKey: setPolicyInput.idempotencyKey,
    });
    transaction.leaderFeePolicy.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(previous);
    transaction.traderProfile.findFirst.mockResolvedValue({ id: TRADER_ID, verificationState: 'VERIFIED' });
    transaction.leaderFeePolicy.updateMany.mockResolvedValue({ count: 1 });
    transaction.leaderFeePolicy.create.mockResolvedValue(created);

    const result = await service.setPolicy(TENANT_ID, TRADER_ID, ACTOR_ID, { ...setPolicyInput, profitShareBps: 750 });

    expect(transaction.leaderFeePolicy.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: previous.id, tenantId: TENANT_ID, effectiveTo: null },
      data: { effectiveTo: new Date(setPolicyInput.effectiveFrom!) },
    }));
    expect(transaction.leaderFeePolicy.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tenantId: TENANT_ID,
        traderId: TRADER_ID,
        version: 2,
        profitShareBps: 750,
        maximumShareBpsAtCreation: 1000,
        feePolicySource: 'plan',
        feePolicyReference: 'plan-1',
        createdByUserId: ACTOR_ID,
      }),
    }));
    expect(result.version).toBe(2);
    expect(auditService.recordImmediate).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: TENANT_ID,
      actorId: ACTOR_ID,
      action: 'LEAD_TRADER_FEE_POLICY_VERSION_CREATED',
    }));
  });

  it('returns an identical idempotent replay without creating another policy or audit event', async () => {
    const { service, transaction, auditService } = buildTransactionHarness();
    const requestFingerprint = createHash('sha256').update(JSON.stringify({
      currency: 'USD',
      profitShareBps: setPolicyInput.profitShareBps,
      highWaterMarkScope: setPolicyInput.highWaterMarkScope,
      effectiveFrom: new Date(setPolicyInput.effectiveFrom!).toISOString(),
    })).digest('hex');
    const replay = policyRecord({ idempotencyKey: setPolicyInput.idempotencyKey, requestFingerprint });
    transaction.leaderFeePolicy.findFirst.mockResolvedValueOnce(replay);

    const result = await service.setPolicy(TENANT_ID, TRADER_ID, ACTOR_ID, setPolicyInput);

    expect(result.id).toBe(replay.id);
    expect(transaction.leaderFeePolicy.create).not.toHaveBeenCalled();
    expect(auditService.recordImmediate).not.toHaveBeenCalled();
  });

  it('fails closed when the canonical tenant fee ceiling is lower than the requested share', async () => {
    const { service, transaction, feePolicyService } = buildTransactionHarness();
    feePolicyService.resolvePerformanceFeePolicy.mockResolvedValue({
      performanceFeeBps: 100,
      source: 'plan',
      planId: 'plan-1',
      planCode: 'canonical-plan',
    });

    await expect(service.setPolicy(TENANT_ID, TRADER_ID, ACTOR_ID, setPolicyInput)).rejects.toBeInstanceOf(ConflictException);
    expect(transaction.leaderFeePolicy.create).not.toHaveBeenCalled();
  });

  it('uses a tenant-and-trader-scoped read when listing version history', async () => {
    const { service, prisma } = buildTransactionHarness();
    prisma.traderProfile.findFirst = jest.fn<() => Promise<unknown>>().mockResolvedValue({ id: TRADER_ID });
    prisma.leaderFeePolicy.findMany = jest.fn<() => Promise<unknown>>().mockResolvedValue([policyRecord()]);

    await service.listPolicyHistory(TENANT_ID, TRADER_ID, 'USD');

    expect(prisma.leaderFeePolicy.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: TENANT_ID, traderId: TRADER_ID, currency: 'USD' },
    }));
  });
});
