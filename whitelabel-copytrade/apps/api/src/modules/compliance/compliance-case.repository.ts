// # Persists compliance cases, notes, and decisions
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OutboxService } from '../../infrastructure/outbox/outbox.service';
import { ComplianceCaseState, ComplianceCaseType, ComplianceDecision, ComplianceReviewAction, RiskLevel, sanitizeMetadata } from './compliance.types';

type ReviewResponseKind = 'CASE' | 'REVIEW' | 'EVIDENCE';

interface ReviewActionOutput<T> {
  response?: T;
  fromState?: ComplianceCaseState | null;
  toState?: ComplianceCaseState | null;
  decision?: ComplianceDecision | null;
  resultReferenceId?: string | null;
}

interface ReviewTransitionOptions {
  action?: ComplianceReviewAction;
  auditAction?: string;
  allowedFromStates?: ComplianceCaseState[];
  allowSameState?: boolean;
}

interface ReviewActionInput<T> {
  tenantId: string;
  caseId: string;
  actorId: string;
  action: ComplianceReviewAction;
  auditAction: string;
  idempotencyKey?: string;
  reason: string;
  safeNote?: string;
  payload: unknown;
  responseKind: ReviewResponseKind;
  auditMetadata?: Record<string, unknown>;
  perform: (tx: any, current: any, now: Date) => Promise<ReviewActionOutput<T>>;
}

function canonicalizeForFingerprint(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeForFingerprint);
  if (value instanceof Date) return value.toISOString();
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record).sort().map((key) => [key, canonicalizeForFingerprint(record[key])]),
    );
  }
  return value;
}

function reviewActionFingerprint(input: Pick<ReviewActionInput<unknown>, 'tenantId' | 'caseId' | 'actorId' | 'action' | 'payload'>): string {
  const canonical = canonicalizeForFingerprint({
    domain: 'wlct:compliance-review-action:v1',
    tenantId: input.tenantId,
    caseId: input.caseId,
    actorId: input.actorId,
    action: input.action,
    payload: input.payload,
  });
  return createHash('sha256').update(JSON.stringify(canonical) ?? 'null').digest('hex');
}

function isUniqueViolation(error: unknown): boolean {
  return error !== null && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'P2002';
}

/**
 * Persistence abstraction for cases, reviews, state transitions, assignments, idempotency, and tenant isolation.
 * Tenant isolation, immutable decision history, safe PII handling, concurrency protection, duplicate prevention.
 */
@Injectable()
export class ComplianceCaseRepository {
  private readonly logger = new Logger(ComplianceCaseRepository.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly outbox?: OutboxService,
  ) {}

  private async appendReviewRequired(tx: any, complianceCase: any): Promise<void> {
    if (!this.outbox) {
      throw new Error('Transactional outbox is unavailable; refusing compliance review without its compliance.review.required event');
    }
    const occurredAt = complianceCase.createdAt ?? new Date();
    await this.outbox.append(tx, {
      tenantId: complianceCase.tenantId,
      aggregateType: 'compliance_review',
      aggregateId: complianceCase.id,
      eventType: 'compliance.review.required',
      idempotencyKey: `compliance-review:${complianceCase.id}:required`,
      occurredAt,
      payload: {
        reviewId: complianceCase.id,
        reasonCode: String(complianceCase.caseType),
      },
    });
  }

  async createCase(input: {
    tenantId: string;
    userId: string;
    caseType: ComplianceCaseType;
    severity?: string;
    riskLevel?: RiskLevel;
    safeSummary: string;
    jurisdiction?: string;
    policyVersion?: string;
    ruleIds?: string[];
    sourceRefs?: any[];
    idempotencyKey: string;
    metadata?: Record<string, any>;
  }): Promise<any> {
    const id = randomUUID();
    const now = new Date();
    const data = {
      id,
      tenantId: input.tenantId,
      userId: input.userId,
      caseType: input.caseType,
      state: ComplianceCaseState.OPEN,
      severity: input.severity || 'MEDIUM',
      riskLevel: input.riskLevel || RiskLevel.UNKNOWN,
      safeSummary: input.safeSummary.substring(0, 1000),
      jurisdiction: input.jurisdiction || 'DEFAULT',
      policyVersion: input.policyVersion || 'v1.0.0',
      ruleIds: input.ruleIds || [],
      sourceRefs: input.sourceRefs || [],
      metadata: input.metadata || {},
      idempotencyKey: input.idempotencyKey,
      createdAt: now,
      updatedAt: now,
    };

    const persist = async () => this.prisma.withTenantRls(input.tenantId, async (tx) => {
      const store = tx as any;
      const existing = await store.complianceCase.findFirst({
        where: { tenantId: input.tenantId, idempotencyKey: input.idempotencyKey },
      });
      if (existing) {
        this.logger.log(`Idempotent case return key=${input.idempotencyKey}`);
        await this.appendReviewRequired(tx, existing);
        return existing;
      }

      const openCase = await store.complianceCase.findFirst({
        where: {
          tenantId: input.tenantId,
          userId: input.userId,
          caseType: input.caseType,
          state: { in: [ComplianceCaseState.OPEN, ComplianceCaseState.IN_REVIEW, ComplianceCaseState.ESCALATED] },
        },
      });
      if (openCase) {
        this.logger.log(`Duplicate open case prevented tenant=${input.tenantId} user=${input.userId} type=${input.caseType} existing=${openCase.id}`);
        await this.appendReviewRequired(tx, openCase);
        return openCase;
      }

      const created = await store.complianceCase.create({ data });
      if (!created?.id) throw new Error('Compliance case persistence returned no durable record');
      await this.appendReviewRequired(tx, created);
      this.logger.log(`Compliance case created id=${created.id} tenant=${input.tenantId} type=${input.caseType}`);
      return created;
    });

    try {
      return await persist();
    } catch (error) {
      const candidate = error as { code?: string; message?: string };
      if (candidate.code === 'P2002' || candidate.message?.includes('Unique constraint')) {
        return this.prisma.withTenantRls(input.tenantId, async (tx) => {
          const existing = await (tx as any).complianceCase.findFirst({
            where: { tenantId: input.tenantId, idempotencyKey: input.idempotencyKey },
          });
          if (!existing) throw error;
          await this.appendReviewRequired(tx, existing);
          return existing;
        });
      }
      throw error;
    }
  }

  async findById(id: string, tenantId: string): Promise<any | null> {
    try {
      const result = await (this.prisma as any).complianceCase?.findFirst({
        where: { id, tenantId },
        include: { reviews: { orderBy: { createdAt: 'asc' } }, evidences: true, auditLogs: { orderBy: { createdAt: 'asc' } } },
      });
      return result || null;
    } catch (e: any) {
      this.logger.warn(`Find case failed: ${e.message}`);
      throw e;
    }
  }

  async findByIdempotencyKey(idempotencyKey: string, tenantId: string): Promise<any | null> {
    const result = await (this.prisma as any).complianceCase?.findFirst({ where: { idempotencyKey, tenantId } });
    return result || null;
  }

  async listTenantCases(tenantId: string, filters?: { state?: ComplianceCaseState; caseType?: ComplianceCaseType; riskLevel?: RiskLevel; assignedTo?: string; fromDate?: Date; toDate?: Date; page?: number; limit?: number }): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    const offset = (page - 1) * limit;

    try {
      const where: any = { tenantId };
      if (filters?.state) where.state = filters.state;
      if (filters?.caseType) where.caseType = filters.caseType;
      if (filters?.riskLevel) where.riskLevel = filters.riskLevel;
      if (filters?.assignedTo) where.assignedTo = filters.assignedTo;
      if (filters?.fromDate || filters?.toDate) {
        where.createdAt = {};
        if (filters.fromDate) where.createdAt.gte = filters.fromDate;
        if (filters.toDate) where.createdAt.lte = filters.toDate;
      }

      const [data, total] = await Promise.all([
        (this.prisma as any).complianceCase?.findMany({ where, orderBy: { createdAt: 'desc' }, skip: offset, take: limit, include: { reviews: true } }) || [],
        (this.prisma as any).complianceCase?.count({ where }) || 0,
      ]);

      return { data, total, page, limit };
    } catch (e: any) {
      this.logger.warn(`List tenant cases failed: ${e.message}`);
      throw e;
    }
  }

  async listReviewerCases(reviewerId: string, filters?: { state?: ComplianceCaseState; page?: number; limit?: number }): Promise<{ data: any[]; total: number }> {
    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    const offset = (page - 1) * limit;

    const where: any = { assignedTo: reviewerId };
    if (filters?.state) where.state = filters.state;

    const [data, total] = await Promise.all([
      (this.prisma as any).complianceCase?.findMany({ where, orderBy: { createdAt: 'desc' }, skip: offset, take: limit }) || [],
      (this.prisma as any).complianceCase?.count({ where }) || 0,
    ]);

    return { data, total };
  }

  private async executeReviewAction<T>(input: ReviewActionInput<T>): Promise<T> {
    if (input.idempotencyKey !== undefined && !input.idempotencyKey.trim()) {
      throw new BadRequestException('Compliance review idempotency key must not be blank');
    }
    const idempotencyKey = input.idempotencyKey?.trim();
    if (idempotencyKey && idempotencyKey.length > 128) {
      throw new BadRequestException('Compliance review idempotency key must be at most 128 characters');
    }
    const fingerprint = idempotencyKey ? reviewActionFingerprint(input) : null;

    const findExisting = (tx: any) => tx.complianceReview.findFirst({
      where: { tenantId: input.tenantId, reviewerId: input.actorId, idempotencyKey },
    });
    const replay = async (tx: any, existing: any): Promise<T> => {
      if (
        !fingerprint ||
        existing.caseId !== input.caseId ||
        existing.action !== input.action ||
        existing.requestFingerprint !== fingerprint
      ) {
        throw new ConflictException('Compliance review idempotency key was already used for a different action payload');
      }
      if (input.responseKind === 'REVIEW') return existing as T;
      if (input.responseKind === 'EVIDENCE') {
        if (!existing.resultReferenceId) {
          throw new Error('Compliance evidence replay receipt is missing its result reference');
        }
        const evidence = await tx.complianceEvidence.findFirst({
          where: { id: existing.resultReferenceId, tenantId: input.tenantId, caseId: input.caseId },
        });
        if (!evidence) throw new Error('Compliance evidence referenced by the replay receipt is unavailable');
        return evidence as T;
      }
      const complianceCase = await tx.complianceCase.findFirst({
        where: { id: input.caseId, tenantId: input.tenantId },
        include: {
          reviews: { orderBy: { createdAt: 'asc' } },
          evidences: true,
          auditLogs: { orderBy: { createdAt: 'asc' } },
        },
      });
      if (!complianceCase) throw new NotFoundException('Compliance case not found');
      return complianceCase as T;
    };

    const transact = async (tx: any): Promise<T> => {
      if (idempotencyKey) {
        const existing = await findExisting(tx);
        if (existing) return replay(tx, existing);
      }

      const current = await tx.complianceCase.findFirst({
        where: { id: input.caseId, tenantId: input.tenantId },
      });
      if (!current) throw new NotFoundException('Compliance case not found');

      const now = new Date();
      const reviewId = randomUUID();
      // Claim the key in the same transaction before changing case/evidence.
      // A concurrent duplicate blocks here, then replays the committed receipt;
      // a failed action rolls this claim back with the transaction.
      await tx.complianceReview.create({
        data: {
          id: reviewId,
          caseId: input.caseId,
          tenantId: input.tenantId,
          reviewerId: input.actorId,
          action: input.action,
          fromState: current.state,
          toState: current.state,
          decision: null,
          reason: input.reason.substring(0, 1000),
          safeNote: input.safeNote?.substring(0, 2000) ?? null,
          idempotencyKey: idempotencyKey ?? null,
          requestFingerprint: fingerprint,
          resultReferenceId: null,
          createdAt: now,
        },
      });

      const result = await input.perform(tx, current, now);
      const review = await tx.complianceReview.update({
        where: { id: reviewId },
        data: {
          fromState: result.fromState ?? current.state,
          toState: result.toState ?? current.state,
          decision: result.decision ?? null,
          resultReferenceId: result.resultReferenceId ?? null,
        },
      });

      const idempotencyMetadata = idempotencyKey
        ? { idempotencyKeyDigest: createHash('sha256').update(idempotencyKey).digest('hex') }
        : {};
      await tx.complianceAuditLog.create({
        data: {
          id: randomUUID(),
          tenantId: input.tenantId,
          caseId: input.caseId,
          userId: null,
          action: input.auditAction,
          actorId: input.actorId,
          actorType: 'USER',
          outcome: 'SUCCESS',
          safeMetadata: sanitizeMetadata({
            reviewId,
            reviewAction: input.action,
            ...idempotencyMetadata,
            ...(input.auditMetadata ?? {}),
          }),
          ipHash: null,
          requestId: null,
          createdAt: now,
        },
      });

      if (input.responseKind === 'REVIEW') return review as T;
      if (input.responseKind === 'EVIDENCE') {
        if (!result.response) throw new Error('Compliance evidence action did not return a durable record');
        return result.response;
      }
      const complianceCase = await tx.complianceCase.findFirst({
        where: { id: input.caseId, tenantId: input.tenantId },
        include: {
          reviews: { orderBy: { createdAt: 'asc' } },
          evidences: true,
          auditLogs: { orderBy: { createdAt: 'asc' } },
        },
      });
      if (!complianceCase) throw new NotFoundException('Compliance case not found after review action');
      return complianceCase as T;
    };

    try {
      return await this.prisma.withTenantRls(input.tenantId, transact);
    } catch (error) {
      if (!idempotencyKey || !isUniqueViolation(error)) throw error;
      return this.prisma.withTenantRls(input.tenantId, async (tx) => {
        const existing = await findExisting(tx);
        if (!existing) throw error;
        return replay(tx, existing);
      });
    }
  }

  async assignReviewer(
    caseId: string,
    tenantId: string,
    reviewerId: string,
    assignedBy: string,
    idempotencyKey?: string,
    reason?: string,
  ): Promise<any> {
    const actionReason = reason?.trim() || `Assigned to reviewer ${reviewerId}`;
    return this.executeReviewAction({
      tenantId,
      caseId,
      actorId: assignedBy,
      action: ComplianceReviewAction.ASSIGN,
      auditAction: 'COMPLIANCE_CASE_ASSIGNED',
      idempotencyKey,
      reason: actionReason,
      payload: { reviewerId, reason: actionReason },
      responseKind: 'CASE',
      auditMetadata: { assignedReviewerId: reviewerId },
      perform: async (tx, current, now) => {
        const fromState = current.state as ComplianceCaseState;
        if (![ComplianceCaseState.OPEN, ComplianceCaseState.ESCALATED].includes(fromState)) {
          throw new BadRequestException(`Cannot assign case in state ${fromState}`);
        }
        const updated = await tx.complianceCase.updateMany({
          where: { id: caseId, tenantId, state: fromState },
          data: {
            assignedTo: reviewerId,
            assignedAt: now,
            state: ComplianceCaseState.IN_REVIEW,
            updatedAt: now,
          },
        });
        if (updated.count !== 1) throw new ConflictException('Compliance case changed during assignment');
        return { fromState, toState: ComplianceCaseState.IN_REVIEW };
      },
    });
  }

  async transitionState(
    caseId: string,
    tenantId: string,
    toState: ComplianceCaseState,
    reviewerId: string,
    reason: string,
    decision?: ComplianceDecision,
    idempotencyKey?: string,
    options: ReviewTransitionOptions = {},
  ): Promise<any> {
    const action = options.action ?? this.actionForTransition(toState);
    const actionReason = reason.trim().substring(0, 1000);
    return this.executeReviewAction({
      tenantId,
      caseId,
      actorId: reviewerId,
      action,
      auditAction: options.auditAction ?? `COMPLIANCE_CASE_${action}`,
      idempotencyKey,
      reason: actionReason,
      payload: { toState, decision: decision ?? null, reason: actionReason },
      responseKind: 'CASE',
      auditMetadata: { fromAction: action, toState, ...(decision ? { decision } : {}) },
      perform: async (tx, current, now) => {
        const fromState = current.state as ComplianceCaseState;
        if (options.allowedFromStates && !options.allowedFromStates.includes(fromState)) {
          throw new BadRequestException(`Cannot perform ${action} on compliance case in state ${fromState}`);
        }
        if (fromState === toState ? !options.allowSameState : !this.isValidTransition(fromState, toState)) {
          throw new BadRequestException(`Invalid compliance case transition ${fromState} -> ${toState}`);
        }
        const updateData: Record<string, unknown> = { state: toState, updatedAt: now };
        if (toState === ComplianceCaseState.ESCALATED) updateData.escalatedAt = now;
        if (toState === ComplianceCaseState.RESOLVED) updateData.resolvedAt = now;
        if (toState === ComplianceCaseState.CLOSED) updateData.closedAt = now;
        if (decision) updateData.decision = decision;
        const updated = await tx.complianceCase.updateMany({
          where: { id: caseId, tenantId, state: fromState },
          data: updateData,
        });
        if (updated.count !== 1) throw new ConflictException('Compliance case changed during state transition');
        return { fromState, toState, decision: decision ?? null };
      },
    });
  }

  async addEvidence(
    caseId: string,
    tenantId: string,
    input: {
      evidenceType: string;
      referenceId: string;
      referenceType: string;
      safeDescription?: string;
      addedBy: string;
      idempotencyKey?: string;
    },
  ): Promise<any> {
    const safeDescription = input.safeDescription?.trim().substring(0, 1000) || undefined;
    return this.executeReviewAction({
      tenantId,
      caseId,
      actorId: input.addedBy,
      action: ComplianceReviewAction.ADD_EVIDENCE,
      auditAction: 'COMPLIANCE_EVIDENCE_ADDED',
      idempotencyKey: input.idempotencyKey,
      reason: `Evidence added: ${input.evidenceType}`,
      safeNote: safeDescription,
      payload: {
        evidenceType: input.evidenceType,
        referenceId: input.referenceId,
        referenceType: input.referenceType,
        safeDescription: safeDescription ?? null,
      },
      responseKind: 'EVIDENCE',
      auditMetadata: { evidenceType: input.evidenceType, referenceType: input.referenceType },
      perform: async (tx, _current, now) => {
        const evidence = await tx.complianceEvidence.create({
          data: {
            id: randomUUID(),
            caseId,
            tenantId,
            evidenceType: input.evidenceType,
            referenceId: input.referenceId,
            referenceType: input.referenceType,
            safeDescription: safeDescription ?? null,
            addedBy: input.addedBy,
            createdAt: now,
          },
        });
        if (!evidence?.id) throw new Error('Compliance evidence persistence returned no durable record');
        return { response: evidence, resultReferenceId: evidence.id };
      },
    });
  }

  async addReviewNote(
    caseId: string,
    tenantId: string,
    reviewerId: string,
    safeNote: string,
    action: ComplianceReviewAction = ComplianceReviewAction.ADD_NOTE,
    options: {
      idempotencyKey?: string;
      transitionOpenToReview?: boolean;
      auditAction?: string;
      auditMetadata?: Record<string, unknown>;
    } = {},
  ): Promise<any> {
    const note = safeNote.trim().substring(0, 2000);
    return this.executeReviewAction({
      tenantId,
      caseId,
      actorId: reviewerId,
      action,
      auditAction: options.auditAction ?? `COMPLIANCE_${action}`,
      idempotencyKey: options.idempotencyKey,
      reason: note.substring(0, 1000),
      safeNote: note,
      payload: { note, transitionOpenToReview: Boolean(options.transitionOpenToReview) },
      responseKind: 'REVIEW',
      auditMetadata: { reviewAction: action, ...(options.auditMetadata ?? {}) },
      perform: async (tx, current, now) => {
        const fromState = current.state as ComplianceCaseState;
        let toState = fromState;
        if (options.transitionOpenToReview && fromState === ComplianceCaseState.OPEN) {
          const updated = await tx.complianceCase.updateMany({
            where: { id: caseId, tenantId, state: ComplianceCaseState.OPEN },
            data: { state: ComplianceCaseState.IN_REVIEW, updatedAt: now },
          });
          if (updated.count !== 1) throw new ConflictException('Compliance case changed while requesting enhanced due diligence');
          toState = ComplianceCaseState.IN_REVIEW;
        }
        return { fromState, toState };
      },
    });
  }

  async findByUserId(userId: string, tenantId: string): Promise<any[]> {
    return await (this.prisma as any).complianceCase?.findMany({ where: { userId, tenantId }, orderBy: { createdAt: 'desc' } }) || [];
  }

  private isValidTransition(from: ComplianceCaseState, to: ComplianceCaseState): boolean {
    const allowed: Record<string, ComplianceCaseState[]> = {
      [ComplianceCaseState.OPEN]: [ComplianceCaseState.IN_REVIEW, ComplianceCaseState.ESCALATED, ComplianceCaseState.CLOSED, ComplianceCaseState.REJECTED],
      [ComplianceCaseState.IN_REVIEW]: [ComplianceCaseState.ESCALATED, ComplianceCaseState.RESOLVED, ComplianceCaseState.REJECTED, ComplianceCaseState.CLOSED],
      [ComplianceCaseState.ESCALATED]: [ComplianceCaseState.IN_REVIEW, ComplianceCaseState.RESOLVED, ComplianceCaseState.REJECTED, ComplianceCaseState.CLOSED],
      [ComplianceCaseState.RESOLVED]: [ComplianceCaseState.CLOSED, ComplianceCaseState.OPEN],
      [ComplianceCaseState.REJECTED]: [ComplianceCaseState.CLOSED, ComplianceCaseState.OPEN],
      [ComplianceCaseState.CLOSED]: [ComplianceCaseState.OPEN],
    };
    return allowed[from]?.includes(to) || false;
  }

  private actionForTransition(toState: ComplianceCaseState): ComplianceReviewAction {
    switch (toState) {
      case ComplianceCaseState.IN_REVIEW:
        return ComplianceReviewAction.ASSIGN;
      case ComplianceCaseState.ESCALATED:
        return ComplianceReviewAction.ESCALATE;
      case ComplianceCaseState.RESOLVED:
        return ComplianceReviewAction.RESOLVE;
      case ComplianceCaseState.REJECTED:
        return ComplianceReviewAction.REJECT;
      case ComplianceCaseState.CLOSED:
        return ComplianceReviewAction.CLOSE;
      default:
        return ComplianceReviewAction.ADD_NOTE;
    }
  }
}
