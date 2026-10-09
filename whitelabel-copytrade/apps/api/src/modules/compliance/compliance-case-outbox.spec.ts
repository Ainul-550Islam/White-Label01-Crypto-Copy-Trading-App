// # Proves a compliance case requiring human review commits with its developer outbox event

import { ComplianceCaseRepository } from './compliance-case.repository';
import { ComplianceCaseType, RiskLevel } from './compliance.types';
import { validateDeveloperEventPayload } from '../developer-platform/event-schemas/developer-event-schemas';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';

function buildRepository(options: { failAppend?: boolean; existing?: any } = {}) {
  let persisted = options.existing ?? null;
  const tx = {
    complianceCase: {
      findFirst: jest.fn(async () => persisted),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        persisted = { ...data };
        return persisted;
      }),
    },
  };
  const prisma = {
    withTenantRls: jest.fn(async (_tenantId: string, work: (transaction: unknown) => Promise<unknown>) => {
      const before = persisted;
      try {
        return await work(tx);
      } catch (error) {
        persisted = before;
        throw error;
      }
    }),
  };
  const outbox = {
    append: jest.fn(async (_transaction: unknown, _input: Record<string, unknown>) => {
      if (options.failAppend) throw new Error('outbox unavailable');
      return undefined;
    }),
  };
  const repository = new ComplianceCaseRepository(prisma as never, outbox as never);
  return { repository, prisma, tx, outbox, persisted: () => persisted };
}

describe('ComplianceCaseRepository outbox transaction', () => {
  it('persists a review-required event with the new case in one tenant transaction', async () => {
    const { repository, prisma, tx, outbox } = buildRepository();
    const complianceCase = await repository.createCase({
      tenantId: TENANT_ID,
      userId: 'user-1',
      caseType: ComplianceCaseType.TRANSACTION_REVIEW,
      severity: 'HIGH',
      riskLevel: RiskLevel.HIGH,
      safeSummary: 'Transaction crossed the tenant review threshold.',
      ruleIds: ['TRANSACTION_REVIEW_THRESHOLD'],
      idempotencyKey: 'case-request-1',
    });

    expect(prisma.withTenantRls).toHaveBeenCalledWith(TENANT_ID, expect.any(Function));
    expect(tx.complianceCase.create).toHaveBeenCalledTimes(1);
    expect(outbox.append).toHaveBeenCalledWith(tx, expect.objectContaining({
      tenantId: TENANT_ID,
      aggregateType: 'compliance_review',
      aggregateId: complianceCase.id,
      eventType: 'compliance.review.required',
      idempotencyKey: `compliance-review:${complianceCase.id}:required`,
      payload: { reviewId: complianceCase.id, reasonCode: 'TRANSACTION_REVIEW' },
    }));
    const event = outbox.append.mock.calls[0]?.[1];
    expect(validateDeveloperEventPayload('compliance.review.required', event?.payload)).toEqual({ valid: true, errors: [] });
  });

  it('does not return an in-memory case when the outbox write fails', async () => {
    const { repository, tx, outbox, persisted } = buildRepository({ failAppend: true });
    await expect(repository.createCase({
      tenantId: TENANT_ID,
      userId: 'user-1',
      caseType: ComplianceCaseType.AML_SCREENING,
      safeSummary: 'A case requires operator review.',
      idempotencyKey: 'case-request-2',
    })).rejects.toThrow('outbox unavailable');

    expect(tx.complianceCase.create).toHaveBeenCalledTimes(1);
    expect(outbox.append).toHaveBeenCalledTimes(1);
    expect(persisted()).toBeNull();
  });
});
