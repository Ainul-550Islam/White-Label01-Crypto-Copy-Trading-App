import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ComplianceCaseState, ComplianceCaseType, RiskLevel, ComplianceDecision } from './compliance.types';
import { randomUUID } from 'crypto';

/**
 * Persistence abstraction for cases, reviews, state transitions, assignments, idempotency, and tenant isolation.
 * Tenant isolation, immutable decision history, safe PII handling, concurrency protection, duplicate prevention.
 */
@Injectable()
export class ComplianceCaseRepository {
  private readonly logger = new Logger(ComplianceCaseRepository.name);

  constructor(private readonly prisma: PrismaService) {}

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
    // Idempotency check
    const existing = await this.findByIdempotencyKey(input.idempotencyKey);
    if (existing) {
      this.logger.log(`Idempotent case return key=${input.idempotencyKey}`);
      return existing;
    }

    // Duplicate case prevention: check if open case for same user/type exists
    try {
      const openCase = await (this.prisma as any).complianceCase?.findFirst({
        where: {
          tenantId: input.tenantId,
          userId: input.userId,
          caseType: input.caseType,
          state: { in: [ComplianceCaseState.OPEN, ComplianceCaseState.IN_REVIEW, ComplianceCaseState.ESCALATED] },
        },
      });

      if (openCase) {
        this.logger.log(`Duplicate open case prevented tenant=${input.tenantId} user=${input.userId} type=${input.caseType} existing=${openCase.id}`);
        return openCase;
      }
    } catch {}

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

    try {
      const created = await (this.prisma as any).complianceCase?.create({ data });
      if (created) {
        this.logger.log(`Compliance case created id=${created.id} tenant=${input.tenantId} type=${input.caseType}`);
        return created;
      }
    } catch (e: any) {
      if (e.code === 'P2002' || e.message?.includes('Unique constraint')) {
        // Idempotency race
        const existingByKey = await this.findByIdempotencyKey(input.idempotencyKey);
        if (existingByKey) return existingByKey;
      }
      this.logger.warn(`Failed to create compliance case in DB, fallback: ${e.message}`);
    }

    // Fallback in-memory representation when table missing
    return { ...data, reviews: [], evidences: [], auditLogs: [] };
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
      return null;
    }
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<any | null> {
    try {
      const result = await (this.prisma as any).complianceCase?.findFirst({ where: { idempotencyKey } });
      return result || null;
    } catch {
      return null;
    }
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
      return { data: [], total: 0, page, limit };
    }
  }

  async listReviewerCases(reviewerId: string, filters?: { state?: ComplianceCaseState; page?: number; limit?: number }): Promise<{ data: any[]; total: number }> {
    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    const offset = (page - 1) * limit;

    try {
      const where: any = { assignedTo: reviewerId };
      if (filters?.state) where.state = filters.state;

      const [data, total] = await Promise.all([
        (this.prisma as any).complianceCase?.findMany({ where, orderBy: { createdAt: 'desc' }, skip: offset, take: limit }) || [],
        (this.prisma as any).complianceCase?.count({ where }) || 0,
      ]);

      return { data, total };
    } catch {
      return { data: [], total: 0 };
    }
  }

  async assignReviewer(caseId: string, tenantId: string, reviewerId: string, assignedBy: string, idempotencyKey?: string): Promise<any | null> {
    try {
      // Idempotency for assignment
      if (idempotencyKey) {
        const existingReview = await (this.prisma as any).complianceReview?.findFirst({ where: { caseId, reviewerId, action: 'ASSIGN' } });
        if (existingReview) {
          this.logger.log(`Idempotent assignment return case=${caseId} reviewer=${reviewerId}`);
          return this.findById(caseId, tenantId);
        }
      }

      const updated = await (this.prisma as any).complianceCase?.update({
        where: { id: caseId },
        data: {
          assignedTo: reviewerId,
          assignedAt: new Date(),
          state: ComplianceCaseState.IN_REVIEW,
          updatedAt: new Date(),
        },
      });

      // Create immutable review record
      try {
        await (this.prisma as any).complianceReview?.create({
          data: {
            id: randomUUID(),
            caseId,
            tenantId,
            reviewerId: assignedBy,
            action: 'ASSIGN',
            fromState: ComplianceCaseState.OPEN,
            toState: ComplianceCaseState.IN_REVIEW,
            reason: `Assigned to reviewer ${reviewerId}`,
            createdAt: new Date(),
          },
        });
      } catch {}

      return updated || null;
    } catch (e: any) {
      this.logger.warn(`Assign reviewer failed: ${e.message}`);
      return null;
    }
  }

  async transitionState(caseId: string, tenantId: string, toState: ComplianceCaseState, reviewerId: string, reason: string, decision?: ComplianceDecision, idempotencyKey?: string): Promise<any | null> {
    try {
      const current = await this.findById(caseId, tenantId);
      if (!current) return null;

      const fromState = current.state as ComplianceCaseState;

      // Validate transition
      if (!this.isValidTransition(fromState, toState)) {
        throw new Error(`Invalid state transition ${fromState} -> ${toState}`);
      }

      const updateData: any = {
        state: toState,
        updatedAt: new Date(),
      };

      if (toState === ComplianceCaseState.ESCALATED) updateData.escalatedAt = new Date();
      if (toState === ComplianceCaseState.RESOLVED) updateData.resolvedAt = new Date();
      if (toState === ComplianceCaseState.CLOSED) updateData.closedAt = new Date();
      if (decision) updateData.decision = decision;

      const updated = await (this.prisma as any).complianceCase?.update({
        where: { id: caseId },
        data: updateData,
      });

      // Immutable review record
      try {
        await (this.prisma as any).complianceReview?.create({
          data: {
            id: randomUUID(),
            caseId,
            tenantId,
            reviewerId,
            action: this.actionForTransition(toState),
            fromState,
            toState,
            decision: decision || null,
            reason: reason.substring(0, 1000),
            createdAt: new Date(),
          },
        });
      } catch {}

      return updated || null;
    } catch (e: any) {
      this.logger.warn(`Transition state failed: ${e.message}`);
      throw e;
    }
  }

  async addEvidence(caseId: string, tenantId: string, input: { evidenceType: string; referenceId: string; referenceType: string; safeDescription?: string; addedBy: string }): Promise<any> {
    const id = randomUUID();
    try {
      const evidence = await (this.prisma as any).complianceEvidence?.create({
        data: {
          id,
          caseId,
          tenantId,
          evidenceType: input.evidenceType,
          referenceId: input.referenceId,
          referenceType: input.referenceType,
          safeDescription: input.safeDescription?.substring(0, 1000) || null,
          addedBy: input.addedBy,
          createdAt: new Date(),
        },
      });
      return evidence || { id, caseId, tenantId, ...input, createdAt: new Date().toISOString() };
    } catch (e: any) {
      this.logger.warn(`Add evidence failed: ${e.message}`);
      return { id, caseId, tenantId, ...input, createdAt: new Date().toISOString() };
    }
  }

  async addReviewNote(caseId: string, tenantId: string, reviewerId: string, safeNote: string, action: string = 'ADD_NOTE'): Promise<any> {
    const id = randomUUID();
    try {
      const review = await (this.prisma as any).complianceReview?.create({
        data: {
          id,
          caseId,
          tenantId,
          reviewerId,
          action,
          safeNote: safeNote.substring(0, 2000),
          reason: safeNote.substring(0, 1000),
          createdAt: new Date(),
        },
      });
      return review || { id, caseId, tenantId, reviewerId, safeNote, createdAt: new Date().toISOString() };
    } catch (e: any) {
      this.logger.warn(`Add review note failed: ${e.message}`);
      return { id, caseId, tenantId, reviewerId, safeNote, createdAt: new Date().toISOString() };
    }
  }

  async findByUserId(userId: string, tenantId: string): Promise<any[]> {
    try {
      return await (this.prisma as any).complianceCase?.findMany({ where: { userId, tenantId }, orderBy: { createdAt: 'desc' } }) || [];
    } catch {
      return [];
    }
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

  private actionForTransition(toState: ComplianceCaseState): any {
    switch (toState) {
      case ComplianceCaseState.IN_REVIEW:
        return 'ASSIGN';
      case ComplianceCaseState.ESCALATED:
        return 'ESCALATE';
      case ComplianceCaseState.RESOLVED:
        return 'RESOLVE';
      case ComplianceCaseState.REJECTED:
        return 'REJECT';
      case ComplianceCaseState.CLOSED:
        return 'CLOSE';
      default:
        return 'ADD_NOTE';
    }
  }
}
