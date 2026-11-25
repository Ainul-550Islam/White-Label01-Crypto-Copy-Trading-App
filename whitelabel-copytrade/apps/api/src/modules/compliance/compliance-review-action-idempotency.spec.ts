import { ConflictException } from '@nestjs/common';
import { describe, expect, it, jest } from '@jest/globals';

import { ComplianceCaseRepository } from './compliance-case.repository';
import { ComplianceCaseState, ComplianceReviewAction } from './compliance.types';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTOR = '22222222-2222-4222-8222-222222222222';
const CASE_A = '33333333-3333-4333-8333-333333333333';
const CASE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function buildRepository(options: { auditFailure?: boolean } = {}) {
  const cases = new Map<string, Record<string, unknown>>([
    [`${TENANT_A}:${CASE_A}`, { id: CASE_A, tenantId: TENANT_A, userId: ACTOR, state: ComplianceCaseState.OPEN, riskLevel: 'HIGH' }],
    [`${TENANT_B}:${CASE_B}`, { id: CASE_B, tenantId: TENANT_B, userId: ACTOR, state: ComplianceCaseState.OPEN, riskLevel: 'HIGH' }],
  ]);
  const reviews: Record<string, any>[] = [];
  const evidences: Record<string, any>[] = [];
  const tx = {
    complianceCase: {
      findFirst: jest.fn(async ({ where }: any) => {
        const record = cases.get(`${where.tenantId}:${where.id}`);
        return record ? { ...record } : null;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const record = cases.get(`${where.tenantId}:${where.id}`);
        if (!record || (where.state && record.state !== where.state)) return { count: 0 };
        Object.assign(record, data);
        return { count: 1 };
      }),
    },
    complianceReview: {
      findFirst: jest.fn(async ({ where }: any) => reviews.find((review) =>
        review.tenantId === where.tenantId
        && review.reviewerId === where.reviewerId
        && review.idempotencyKey === where.idempotencyKey,
      ) ?? null),
      create: jest.fn(async ({ data }: any) => {
        const record = { ...data };
        reviews.push(record);
        return record;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const record = reviews.find((review) => review.id === where.id);
        if (!record) throw new Error('review receipt missing');
        Object.assign(record, data);
        return record;
      }),
    },
    complianceEvidence: {
      create: jest.fn(async ({ data }: any) => {
        const record = { ...data };
        evidences.push(record);
        return record;
      }),
      findFirst: jest.fn(async ({ where }: any) => evidences.find((evidence) =>
        evidence.id === where.id && evidence.tenantId === where.tenantId && evidence.caseId === where.caseId,
      ) ?? null),
    },
    complianceAuditLog: {
      create: options.auditFailure
        ? jest.fn(async () => { throw new Error('audit unavailable'); })
        : jest.fn(async ({ data }: any) => data),
    },
  };
  const prisma = {
    withTenantRls: jest.fn(async (_tenantId: string, work: (transaction: typeof tx) => Promise<unknown>) => work(tx)),
  };
  return { repository: new ComplianceCaseRepository(prisma as never), prisma, tx, reviews, evidences };
}

describe('Compliance review action idempotency', () => {
  it('replays an assignment by tenant, actor, and key without repeating state, review, or audit writes', async () => {
    const { repository, prisma, tx } = buildRepository();

    const first = await repository.assignReviewer(CASE_A, TENANT_A, '44444444-4444-4444-8444-444444444444', ACTOR, 'assign-1');
    const replay = await repository.assignReviewer(CASE_A, TENANT_A, '44444444-4444-4444-8444-444444444444', ACTOR, 'assign-1');

    expect(first).toMatchObject({ id: CASE_A, state: ComplianceCaseState.IN_REVIEW });
    expect(replay).toMatchObject({ id: CASE_A, state: ComplianceCaseState.IN_REVIEW });
    expect(prisma.withTenantRls).toHaveBeenCalledWith(TENANT_A, expect.any(Function));
    expect(tx.complianceCase.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.complianceReview.create).toHaveBeenCalledTimes(1);
    expect(tx.complianceAuditLog.create).toHaveBeenCalledTimes(1);
    expect(tx.complianceReview.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tenantId: TENANT_A,
        reviewerId: ACTOR,
        action: ComplianceReviewAction.ASSIGN,
        idempotencyKey: 'assign-1',
        requestFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    }));
  });

  it('rejects reuse of an actor-scoped key when the request fingerprint changes', async () => {
    const { repository } = buildRepository();
    await repository.assignReviewer(CASE_A, TENANT_A, '44444444-4444-4444-8444-444444444444', ACTOR, 'assign-2', 'first reason');

    await expect(repository.assignReviewer(
      CASE_A,
      TENANT_A,
      '44444444-4444-4444-8444-444444444444',
      ACTOR,
      'assign-2',
      'different reason',
    )).rejects.toBeInstanceOf(ConflictException);
  });

  it('scopes the same idempotency key independently across tenants', async () => {
    const { repository, tx, reviews } = buildRepository();

    await repository.assignReviewer(CASE_A, TENANT_A, '44444444-4444-4444-8444-444444444444', ACTOR, 'shared-key');
    await repository.assignReviewer(CASE_B, TENANT_B, '55555555-5555-4555-8555-555555555555', ACTOR, 'shared-key');

    expect(reviews).toHaveLength(2);
    expect(reviews.map((review) => review.tenantId).sort()).toEqual([TENANT_A, TENANT_B].sort());
    expect(tx.complianceReview.create).toHaveBeenCalledTimes(2);
  });

  it('writes evidence, immutable review receipt, and audit record in one tenant transaction and replays the evidence', async () => {
    const { repository, prisma, tx, evidences } = buildRepository();
    const input = {
      evidenceType: 'PROVIDER_REFERENCE',
      referenceId: 'screening-123',
      referenceType: 'AML_SCREENING',
      safeDescription: 'Provider screening evidence',
      addedBy: ACTOR,
      idempotencyKey: 'evidence-1',
    };

    const first = await repository.addEvidence(CASE_A, TENANT_A, input);
    const replay = await repository.addEvidence(CASE_A, TENANT_A, input);

    expect(first).toMatchObject({ caseId: CASE_A, tenantId: TENANT_A, referenceId: 'screening-123' });
    expect(replay).toEqual(first);
    expect(evidences).toHaveLength(1);
    expect(tx.complianceReview.create).toHaveBeenCalledTimes(1);
    expect(tx.complianceAuditLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.withTenantRls).toHaveBeenCalledTimes(2);
  });

  it('replays the committed receipt after a unique-key collision race', async () => {
    const { repository, prisma, tx, reviews } = buildRepository();
    const input = {
      caseId: CASE_A,
      tenantId: TENANT_A,
      reviewerId: ACTOR,
      safeNote: 'review note',
      action: ComplianceReviewAction.ADD_NOTE,
      options: { idempotencyKey: 'note-race' },
    };
    await repository.addReviewNote(input.caseId, input.tenantId, input.reviewerId, input.safeNote, input.action, input.options);
    const committedReceipt = reviews[0];

    let lookupCount = 0;
    tx.complianceReview.findFirst.mockImplementation(async () => {
      lookupCount += 1;
      return lookupCount === 1 ? null : committedReceipt;
    });
    tx.complianceReview.create.mockRejectedValue(Object.assign(new Error('unique key already committed'), { code: 'P2002' }));

    const replay = await repository.addReviewNote(input.caseId, input.tenantId, input.reviewerId, input.safeNote, input.action, input.options);

    expect(replay).toEqual(committedReceipt);
    expect(prisma.withTenantRls).toHaveBeenCalledTimes(3);
    expect(tx.complianceReview.findFirst).toHaveBeenCalledTimes(3);
  });

  it('fails the action when its transactional audit write cannot be persisted', async () => {
    const { repository, tx } = buildRepository({ auditFailure: true });

    await expect(repository.addReviewNote(CASE_A, TENANT_A, ACTOR, 'review note', ComplianceReviewAction.ADD_NOTE, {
      idempotencyKey: 'note-1',
    })).rejects.toThrow('audit unavailable');
    expect(tx.complianceReview.create).toHaveBeenCalledTimes(1);
    expect(tx.complianceAuditLog.create).toHaveBeenCalledTimes(1);
  });
});
