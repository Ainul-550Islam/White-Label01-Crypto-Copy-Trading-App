// # Responsibility: verifies tenant isolation, idempotent submission, active-application uniqueness, claimed review, audited decisions, and versioned resubmission.

import { describe, expect, it, jest } from '@jest/globals';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { LeadTraderReviewDecision, SubmitLeadTraderApplicationDto } from './dto/lead-trader-application.dto';
import { LeadTraderApplicationService } from './lead-trader-application.service';
import { LeadTraderApplicationController } from './lead-trader-application.controller';

interface MemoryProfile {
  id: string;
  tenantId: string;
  userId: string;
  verificationState: string;
  verifiedAt: Date | null;
  verifiedById: string | null;
  deletedAt: Date | null;
}

interface MemoryApplication {
  id: string;
  tenantId: string;
  traderId: string;
  applicantUserId: string | null;
  reviewerUserId: string | null;
  status: 'SUBMITTED' | 'IN_REVIEW' | 'APPROVED' | 'REJECTED';
  version: number;
  declaration: unknown;
  requestFingerprint: string;
  idempotencyKey: string;
  activeApplicationKey: string | null;
  submittedAt: Date;
  reviewedAt: Date | null;
  decisionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

type Where = Record<string, unknown>;
type Update = Record<string, unknown>;

function matches(row: Record<string, unknown>, where: Where): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key];
    if (expected && typeof expected === 'object' && 'in' in expected) {
      const values = (expected as { in: unknown[] }).in;
      return values.includes(actual);
    }
    return actual === expected;
  });
}

function makeService() {
  const profile: MemoryProfile = {
    id: 'trader-a',
    tenantId: 'tenant-a',
    userId: 'applicant-a',
    verificationState: 'UNVERIFIED',
    verifiedAt: null,
    verifiedById: null,
    deletedAt: null,
  };
  const applications: MemoryApplication[] = [];
  let nextId = 0;
  const auditService = { recordImmediate: jest.fn(async () => undefined) } as unknown as AuditService;

  const findApplication = jest.fn(async (args: { where: Where; orderBy?: unknown }) => {
    const found = applications.filter((row) => matches(row as unknown as Record<string, unknown>, args.where));
    if (args.orderBy && found.length > 1) found.sort((a, b) => b.version - a.version);
    return found[0] ? { ...found[0] } : null;
  });
  const createApplication = jest.fn(async (args: { data: Record<string, unknown> }) => {
    nextId += 1;
    const now = new Date('2026-10-05T10:00:00.000Z');
    const created: MemoryApplication = {
      id: `application-${nextId}`,
      tenantId: String(args.data.tenantId),
      traderId: String(args.data.traderId),
      applicantUserId: typeof args.data.applicantUserId === 'string' ? args.data.applicantUserId : null,
      reviewerUserId: null,
      status: args.data.status as MemoryApplication['status'],
      version: Number(args.data.version),
      declaration: args.data.declaration,
      requestFingerprint: String(args.data.requestFingerprint),
      idempotencyKey: String(args.data.idempotencyKey),
      activeApplicationKey: typeof args.data.activeApplicationKey === 'string' ? args.data.activeApplicationKey : null,
      submittedAt: now,
      reviewedAt: null,
      decisionReason: null,
      createdAt: now,
      updatedAt: now,
    };
    applications.push(created);
    return { ...created };
  });
  const updateApplicationMany = jest.fn(async (args: { where: Where; data: Update }) => {
    const targets = applications.filter((row) => matches(row as unknown as Record<string, unknown>, args.where));
    for (const row of targets) Object.assign(row, args.data);
    return { count: targets.length };
  });
  const findApplications = jest.fn(async (args: { where: Where; skip?: number; take?: number }) => {
    return applications
      .filter((row) => matches(row as unknown as Record<string, unknown>, args.where))
      .sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime())
      .slice(args.skip ?? 0, (args.skip ?? 0) + (args.take ?? applications.length))
      .map((row) => ({ ...row }));
  });
  const updateProfileMany = jest.fn(async (args: { where: Where; data: Update }) => {
    if (!matches(profile as unknown as Record<string, unknown>, args.where)) return { count: 0 };
    Object.assign(profile, args.data);
    return { count: 1 };
  });
  const findProfile = jest.fn(async (args: { where: Where }) =>
    matches(profile as unknown as Record<string, unknown>, args.where) ? { ...profile } : null);

  const applicationDelegate = {
    findFirst: findApplication,
    findMany: findApplications,
    count: jest.fn(async (args: { where: Where }) => applications.filter((row) => matches(row as unknown as Record<string, unknown>, args.where)).length),
    create: createApplication,
    updateMany: updateApplicationMany,
  };
  const profileDelegate = { findFirst: findProfile, updateMany: updateProfileMany };
  const transactionClient = { traderProfile: profileDelegate, leadTraderApplication: applicationDelegate };
  const prisma = {
    traderProfile: profileDelegate,
    leadTraderApplication: applicationDelegate,
    $transaction: jest.fn(async (callback: (transaction: typeof transactionClient) => Promise<unknown>) => callback(transactionClient)),
  } as unknown as PrismaService;
  const service = new LeadTraderApplicationService(prisma, auditService);
  return { service, prisma, profile, applications, auditService, findApplication, findProfile, updateProfileMany };
}

function validInput(overrides: Partial<SubmitLeadTraderApplicationDto> = {}): SubmitLeadTraderApplicationDto {
  return {
    idempotencyKey: 'lead-app-key-0001',
    yearsExperience: 4,
    markets: ['SPOT', 'USDT_PERPETUAL'],
    strategySummary: 'A documented trend-following approach with predefined position limits and drawdown review procedures.',
    evidenceReferences: ['review-2026-01'],
    riskAcknowledged: true,
    ...overrides,
  };
}

describe('LeadTraderApplicationService', () => {
  it('persists a tenant-owned submission, moves the profile to pending, and returns no internal idempotency material', async () => {
    const { service, profile, applications, auditService, prisma } = makeService();

    const result = await service.apply('tenant-a', 'applicant-a', validInput());

    expect(result).toMatchObject({ id: 'application-1', traderId: 'trader-a', status: 'SUBMITTED', version: 1 });
    expect(result).not.toHaveProperty('idempotencyKey');
    expect(result).not.toHaveProperty('requestFingerprint');
    expect(profile.verificationState).toBe('PENDING');
    expect(applications).toHaveLength(1);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
    expect(auditService.recordImmediate).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      actorId: 'applicant-a',
      action: 'LEAD_TRADER_APPLICATION_SUBMITTED',
      resourceId: 'application-1',
    }));
  });

  it('replays a matching idempotency key after submission without duplicating history or audit', async () => {
    const { service, applications, auditService } = makeService();
    const input = validInput();
    const first = await service.apply('tenant-a', 'applicant-a', input);
    const replay = await service.apply('tenant-a', 'applicant-a', input);

    expect(replay.id).toBe(first.id);
    expect(applications).toHaveLength(1);
    expect(auditService.recordImmediate).toHaveBeenCalledTimes(1);
  });

  it('rejects reuse of an idempotency key with a changed declaration', async () => {
    const { service } = makeService();
    await service.apply('tenant-a', 'applicant-a', validInput());

    await expect(service.apply('tenant-a', 'applicant-a', validInput({ strategySummary: 'A materially different, documented strategy summary with distinct controls and risk procedures.' })))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('prevents a second active application, including one with a different idempotency key', async () => {
    const { service, applications } = makeService();
    await service.apply('tenant-a', 'applicant-a', validInput());

    await expect(service.apply('tenant-a', 'applicant-a', validInput({ idempotencyKey: 'lead-app-key-0002' })))
      .rejects.toBeInstanceOf(ConflictException);
    expect(applications).toHaveLength(1);
  });

  it('requires the assigned reviewer, preserves a rejection, and permits a new version only afterward', async () => {
    const { service, profile, applications, auditService } = makeService();
    const first = await service.apply('tenant-a', 'applicant-a', validInput());

    await expect(service.transition('tenant-a', first.id, 'reviewer-a', LeadTraderReviewDecision.REJECT, 'The application lacks adequate control evidence.'))
      .rejects.toBeInstanceOf(ConflictException);
    await expect(service.startReview('tenant-a', first.id, 'applicant-a')).rejects.toBeInstanceOf(ForbiddenException);
    await service.startReview('tenant-a', first.id, 'reviewer-a');
    await expect(service.startReview('tenant-a', first.id, 'reviewer-b')).rejects.toBeInstanceOf(ConflictException);
    await expect(service.transition('tenant-a', first.id, 'reviewer-a', LeadTraderReviewDecision.REJECT, 'too short'))
      .rejects.toBeInstanceOf(BadRequestException);

    const rejected = await service.transition(
      'tenant-a',
      first.id,
      'reviewer-a',
      LeadTraderReviewDecision.REJECT,
      'Please document the risk-control review and supported-market rationale.',
    );
    expect(rejected.status).toBe('REJECTED');
    expect(rejected.decisionReason).toContain('risk-control review');
    expect(profile.verificationState).toBe('REJECTED');
    expect(applications[0]?.activeApplicationKey).toBeNull();

    const second = await service.apply('tenant-a', 'applicant-a', validInput({ idempotencyKey: 'lead-app-key-0002' }));
    expect(second.version).toBe(2);
    expect(second.status).toBe('SUBMITTED');
    expect(applications).toHaveLength(2);
    expect(applications[0]?.status).toBe('REJECTED');
    expect(profile.verificationState).toBe('PENDING');
    expect(auditService.recordImmediate).toHaveBeenCalledWith(expect.objectContaining({ action: 'LEAD_TRADER_APPLICATION_REJECTED' }));
  });

  it('updates the trader qualification state only after the claimed reviewer approves', async () => {
    const { service, profile } = makeService();
    const application = await service.apply('tenant-a', 'applicant-a', validInput());
    await service.startReview('tenant-a', application.id, 'reviewer-a');
    const approved = await service.transition('tenant-a', application.id, 'reviewer-a', LeadTraderReviewDecision.APPROVE, 'Eligibility review complete.');

    expect(approved.status).toBe('APPROVED');
    expect(profile.verificationState).toBe('VERIFIED');
    expect(profile.verifiedById).toBe('reviewer-a');
    expect(profile.verifiedAt).toBeInstanceOf(Date);
  });

  it('scopes applicant history, queue, and review lookups to the token tenant', async () => {
    const { service, findProfile, findApplication } = makeService();
    await service.apply('tenant-a', 'applicant-a', validInput());

    await expect(service.listMine('tenant-b', 'applicant-a')).rejects.toBeInstanceOf(NotFoundException);
    expect(findProfile).toHaveBeenLastCalledWith({ where: { tenantId: 'tenant-b', userId: 'applicant-a', deletedAt: null }, select: { id: true } });
    await expect(service.startReview('tenant-b', 'application-1', 'reviewer-b')).rejects.toBeInstanceOf(NotFoundException);
    expect(findApplication).toHaveBeenLastCalledWith({ where: { id: 'application-1', tenantId: 'tenant-b' }, select: { id: true, traderId: true, applicantUserId: true, reviewerUserId: true, status: true } });
    await expect(service.listQueue({ tenantId: 'tenant-b' })).resolves.toMatchObject({ data: [], total: 0 });
  });

  it('rejects malformed declarations before any transaction or persistence call', async () => {
    const { service, prisma, applications } = makeService();
    await expect(service.apply('tenant-a', 'applicant-a', validInput({ markets: [] }))).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.apply('tenant-a', 'applicant-a', validInput({ evidenceReferences: ['https://example.com/secret'] }))).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(applications).toHaveLength(0);
  });
});

type TestRequest = { user?: Record<string, unknown> | null };

function buildController() {
  const service = {
    apply: jest.fn(async () => ({ id: 'application-1' })),
    listMine: jest.fn(async () => []),
    listQueue: jest.fn(async () => ({ data: [], total: 0, page: 1, limit: 20 })),
    startReview: jest.fn(async () => ({ id: 'application-1' })),
    transition: jest.fn(async () => ({ id: 'application-1' })),
  } as unknown as LeadTraderApplicationService;
  return { controller: new LeadTraderApplicationController(service), service };
}

const applicantRequest: TestRequest = {
  user: { tenantId: 'tenant-from-token', userId: 'applicant-1', roles: ['FOLLOWER'] },
};
const tenantAdminRequest: TestRequest = {
  user: { tenantId: 'tenant-from-token', userId: 'admin-1', roles: ['TENANT_ADMIN'] },
};

const body: SubmitLeadTraderApplicationDto = {
  idempotencyKey: 'lead-app-key-0001',
  yearsExperience: 3,
  markets: ['SPOT'],
  strategySummary: 'A documented strategy with risk controls, defined markets, and regular drawdown review procedures.',
  evidenceReferences: [],
  riskAcknowledged: true,
};

describe('LeadTraderApplicationController authorization context', () => {
  it('submits and reads applicant data using only authenticated tenant and user identity', async () => {
    const { controller, service } = buildController();
    await controller.submit(applicantRequest, body);
    await controller.listMine(applicantRequest);

    expect(service.apply).toHaveBeenCalledWith('tenant-from-token', 'applicant-1', body);
    expect(service.listMine).toHaveBeenCalledWith('tenant-from-token', 'applicant-1');
  });

  it('requires an authenticated principal for applicant operations', async () => {
    const { controller } = buildController();
    await expect(controller.submit({ user: { tenantId: 'tenant-from-token' } }, body)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('requires an admin role and never accepts a caller-supplied tenant for the queue', async () => {
    const { controller, service } = buildController();
    await controller.listQueue(tenantAdminRequest, undefined, '2', '25');
    expect(service.listQueue).toHaveBeenCalledWith({ tenantId: 'tenant-from-token', status: undefined, page: 2, limit: 25 });

    await expect(controller.listQueue(applicantRequest)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects unknown queue statuses before making a service call', async () => {
    const { controller, service } = buildController();
    await expect(controller.listQueue(tenantAdminRequest, 'PENDING')).rejects.toBeInstanceOf(BadRequestException);
    expect(service.listQueue).not.toHaveBeenCalled();
  });

  it('passes tenant scope and reviewer identity from the authenticated principal for claim and decision routes', async () => {
    const { controller, service } = buildController();
    await controller.startReview(tenantAdminRequest, 'application-1');
    await controller.decide(tenantAdminRequest, 'application-1', { decision: LeadTraderReviewDecision.APPROVE, decisionReason: 'Review completed.' });

    expect(service.startReview).toHaveBeenCalledWith('tenant-from-token', 'application-1', 'admin-1');
    expect(service.transition).toHaveBeenCalledWith('tenant-from-token', 'application-1', 'admin-1', 'APPROVE', 'Review completed.');
  });
});
