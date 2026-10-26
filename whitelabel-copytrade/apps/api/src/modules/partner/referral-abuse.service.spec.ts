// # Tests durable velocity scoring, idempotency, tenant isolation, and review-queue transitions.
import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ReferralAbuseService } from './referral-abuse.service';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';

const tenantId = '11111111-1111-4111-8111-111111111111';
const evaluatedAt = new Date('2026-10-25T12:00:00.000Z');
const baseline = {
  tenantId,
  partnerId: 'partner-a',
  referrerUserId: 'user-a',
  referredUserId: 'user-b',
  referrerDeviceHash: 'device-a',
  referredDeviceHash: 'device-b',
  referrerIpHash: 'ip-a',
  referredIpHash: 'ip-b',
  idempotencyKey: 'signup-a',
  correlationId: 'request-a',
  evaluatedAt,
};

function createService(queryResults: unknown[]) {
  const results = [...queryResults];
  const queryRaw = jest.fn(async (_query: Prisma.Sql) => results.shift() ?? []);
  const tx = { $queryRaw: queryRaw };
  const transaction = jest.fn(async (work: (transactionClient: typeof tx) => Promise<unknown>) =>
    work(tx),
  );
  const prisma = { $transaction: transaction } as unknown as PrismaService;
  const recordImmediate = jest.fn().mockResolvedValue(undefined);
  const audit = { recordImmediate } as unknown as AuditService;
  return {
    service: new ReferralAbuseService(prisma, audit),
    queryRaw,
    transaction,
    recordImmediate,
  };
}

function countRow(
  referrerAttemptsInWindow = 0,
  deviceReferralsInWindow = 0,
  ipReferralsInWindow = 0,
) {
  return [{ referrerAttemptsInWindow, deviceReferralsInWindow, ipReferralsInWindow }];
}

function reviewRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'case-1',
    tenantId,
    partnerId: 'partner-a',
    referrerUserId: 'user-a',
    referredUserId: 'user-b',
    referrerDeviceHash: 'device-a',
    referredDeviceHash: 'device-a',
    referrerIpHash: 'ip-a',
    referredIpHash: 'ip-b',
    riskScore: 60,
    reasons: ['SAME_DEVICE'],
    velocityCounts: {
      referrerAttemptsInWindow: 0,
      deviceReferralsInWindow: 0,
      ipReferralsInWindow: 0,
    },
    decision: 'REVIEW',
    state: 'REVIEW_REQUIRED',
    reviewerUserId: null,
    resolutionNote: null,
    createdAt: evaluatedAt,
    reviewedAt: null,
    ...overrides,
  };
}

describe('ReferralAbuseService', () => {
  it('persists each allowed evaluation and counts prior tenant-scoped velocity evidence transactionally', async () => {
    const { service, queryRaw, transaction, recordImmediate } = createService([
      [],
      [],
      countRow(),
      [{ id: 'case-allow-1' }],
    ]);
    const result = await service.evaluateAttribution(baseline);

    expect(result.decision).toBe('ALLOW');
    expect(result.riskScore).toBe(0);
    expect(result.caseId).toBe('case-allow-1');
    expect(result.velocity).toEqual({
      referrerAttemptsInWindow: 0,
      deviceReferralsInWindow: 0,
      ipReferralsInWindow: 0,
    });
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(queryRaw).toHaveBeenCalledTimes(4);
    const scopedLookup = queryRaw.mock.calls[1]?.[0];
    expect(scopedLookup?.sql).toContain('partner_attributions');
    expect(scopedLookup?.values).toContain(tenantId);
    expect(recordImmediate).not.toHaveBeenCalled();
  });

  it('scores repeated identity evidence and creates an audited human-review queue item', async () => {
    const { service, queryRaw, recordImmediate } = createService([
      [],
      [],
      countRow(5, 3, 0),
      [{ id: 'case-review-1' }],
    ]);
    const result = await service.evaluateAttribution({
      ...baseline,
      referredDeviceHash: baseline.referrerDeviceHash,
    });

    expect(result.decision).toBe('REVIEW');
    expect(result.reviewRequired).toBe(true);
    expect(result.riskScore).toBe(100);
    expect(result.reasons).toEqual([
      'SAME_DEVICE',
      'HIGH_REFERRER_VELOCITY',
      'REPEATED_DEVICE_VELOCITY',
    ]);
    expect(result.caseId).toBe('case-review-1');
    expect(recordImmediate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'PARTNER_REFERRAL_ABUSE_REVIEW_QUEUED',
        resourceId: 'case-review-1',
        metadata: expect.objectContaining({ riskScore: 100, decision: 'REVIEW' }),
      }),
    );
    expect(queryRaw).toHaveBeenCalledTimes(4);
  });

  it('refuses self-referral and records the block as a denial', async () => {
    const { service, recordImmediate } = createService([
      [],
      [],
      countRow(),
      [{ id: 'case-blocked-1' }],
    ]);
    const result = await service.evaluateAttribution({
      ...baseline,
      referredUserId: baseline.referrerUserId,
    });

    expect(result.decision).toBe('REFUSE');
    expect(result.riskScore).toBe(100);
    expect(result.reasons).toContain('SELF_REFERRAL');
    expect(recordImmediate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'PARTNER_REFERRAL_ABUSE_BLOCKED',
        outcome: 'DENIED',
        resourceId: 'case-blocked-1',
      }),
    );
  });

  it('persists and audits a refusal when both device and keyed IP evidence match', async () => {
    const { service, queryRaw, recordImmediate } = createService([
      [],
      [],
      countRow(),
      [{ id: 'case-identity-refused-1' }],
    ]);
    const result = await service.evaluateAttribution({
      ...baseline,
      referredDeviceHash: baseline.referrerDeviceHash,
      referredIpHash: baseline.referrerIpHash,
    });

    expect(result).toMatchObject({
      decision: 'REFUSE',
      riskScore: 85,
      reasons: ['SAME_DEVICE', 'SAME_IP_HASH'],
      caseId: 'case-identity-refused-1',
    });
    expect(queryRaw).toHaveBeenCalledTimes(4);
    expect(queryRaw.mock.calls[3]?.[0].values).toContain('REFUSE');
    expect(recordImmediate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'PARTNER_REFERRAL_ABUSE_BLOCKED',
        outcome: 'DENIED',
        resourceId: 'case-identity-refused-1',
        metadata: expect.objectContaining({ decision: 'REFUSE', riskScore: 85 }),
      }),
    );
  });

  it('returns the existing idempotency record without recomputing or writing a second decision', async () => {
    const { service, queryRaw, recordImmediate } = createService([
      [],
      [{ id: 'case-existing', source: 'ABUSE_REVIEW' }],
    ]);
    const result = await service.evaluateAttribution({
      ...baseline,
      referredUserId: baseline.referrerUserId,
    });

    expect(result.decision).toBe('IDEMPOTENT_REPLAY');
    expect(result.caseId).toBe('case-existing');
    expect(result.riskScore).toBe(0);
    expect(queryRaw).toHaveBeenCalledTimes(2);
    expect(recordImmediate).not.toHaveBeenCalled();
  });

  it('fails closed when the durable ledger is unavailable', async () => {
    const { service } = createService([[], Promise.reject(new Error('database unavailable'))]);
    await expect(service.evaluateAttribution(baseline)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('rejects non-canonical tenant identifiers before any database operation', async () => {
    const { service, queryRaw } = createService([]);
    await expect(
      service.evaluateAttribution({ ...baseline, tenantId: 'tenant-a' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('lists only the pending queue for the tenant and maps durable review evidence', async () => {
    const row = reviewRow();
    const { service, queryRaw } = createService([[], [row]]);
    const result = await service.listReviewQueue(tenantId, 25);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'case-1',
      state: 'REVIEW_REQUIRED',
      riskScore: 60,
      reasons: ['SAME_DEVICE'],
      velocity: {
        referrerAttemptsInWindow: 0,
        deviceReferralsInWindow: 0,
        ipReferralsInWindow: 0,
      },
    });
    expect(queryRaw.mock.calls[1]?.[0].sql).toContain("state = 'REVIEW_REQUIRED'");
  });

  it('allows a reviewer to resolve a pending case once and audits that decision', async () => {
    const { service, queryRaw, recordImmediate } = createService([
      [],
      [
        reviewRow({
          state: 'REVIEW_APPROVED',
          reviewerUserId: 'reviewer-1',
          resolutionNote: 'Identity evidence verified.',
          reviewedAt: evaluatedAt,
        }),
      ],
    ]);
    const result = await service.resolveReview({
      tenantId,
      caseId: 'case-1',
      reviewerUserId: 'reviewer-1',
      decision: 'APPROVE',
      note: 'Identity evidence verified.',
      correlationId: 'request-review-1',
    });

    expect(result.state).toBe('REVIEW_APPROVED');
    expect(result.reviewerUserId).toBe('reviewer-1');
    expect(recordImmediate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'PARTNER_REFERRAL_ABUSE_REVIEWED',
        resourceId: 'case-1',
        metadata: expect.objectContaining({ decision: 'APPROVE', state: 'REVIEW_APPROVED' }),
      }),
    );
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });

  it('rejects a resolution race instead of overwriting an already reviewed case', async () => {
    const { service } = createService([
      [],
      [],
      [],
      [reviewRow({ state: 'REVIEW_REJECTED', reviewerUserId: 'reviewer-2' })],
    ]);
    await expect(
      service.resolveReview({
        tenantId,
        caseId: 'case-1',
        reviewerUserId: 'reviewer-1',
        decision: 'APPROVE',
        correlationId: 'request-review-2',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
