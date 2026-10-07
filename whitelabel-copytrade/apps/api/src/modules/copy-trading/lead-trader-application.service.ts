// # Responsibility: enforces the tenant-scoped lead-trader application state machine, idempotency, owner checks, and review audit trail.

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { AuditActorType, AuditOutcome } from '@wlct/shared-types';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { LeadTraderReviewDecision, SubmitLeadTraderApplicationDto } from './dto/lead-trader-application.dto';
import { LeadTraderApplicationStatus, Prisma } from '@prisma/client';
import { createHash } from 'crypto';

const ACTIVE_APPLICATION_STATUSES: LeadTraderApplicationStatus[] = ['SUBMITTED', 'IN_REVIEW'];
const APPLICANT_APPLICATION_SELECT = {
  id: true,
  traderId: true,
  status: true,
  version: true,
  declaration: true,
  submittedAt: true,
  reviewedAt: true,
  decisionReason: true,
} satisfies Prisma.LeadTraderApplicationSelect;
const ADMIN_APPLICATION_SELECT = {
  ...APPLICANT_APPLICATION_SELECT,
  applicantUserId: true,
  reviewerUserId: true,
} satisfies Prisma.LeadTraderApplicationSelect;
type ApplicantApplicationView = Prisma.LeadTraderApplicationGetPayload<{ select: typeof APPLICANT_APPLICATION_SELECT }>;
type FullApplication = Prisma.LeadTraderApplicationGetPayload<Record<string, never>>;

export interface LeadTraderApplicationDeclaration {
  yearsExperience: number;
  markets: string[];
  strategySummary: string;
  evidenceReferences: string[];
  riskAcknowledged: true;
}

@Injectable()
export class LeadTraderApplicationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async apply(
    tenantId: string,
    applicantUserId: string,
    input: SubmitLeadTraderApplicationDto,
  ): Promise<ApplicantApplicationView> {
    const declaration = this.validateDeclaration(input);
    const fingerprint = createHash('sha256').update(JSON.stringify(declaration)).digest('hex');
    let outcome: { application: ApplicantApplicationView; created: boolean };

    try {
      outcome = await this.prisma.$transaction(async (transaction) => {
        const profile = await transaction.traderProfile.findFirst({
          where: { tenantId, userId: applicantUserId, deletedAt: null },
          select: { id: true, verificationState: true },
        });
        if (!profile) throw new NotFoundException('Create a trader profile before applying.');

        const existingIdempotency = await transaction.leadTraderApplication.findFirst({
          where: { tenantId, idempotencyKey: input.idempotencyKey },
        });
        if (existingIdempotency) {
          if (
            existingIdempotency.applicantUserId !== applicantUserId
            || existingIdempotency.traderId !== profile.id
            || existingIdempotency.requestFingerprint !== fingerprint
          ) {
            throw new ConflictException('The idempotency key was already used for a different application request.');
          }
          return { application: this.applicantView(existingIdempotency), created: false };
        }

        if (profile.verificationState === 'VERIFIED' || profile.verificationState === 'SUSPENDED') {
          throw new ConflictException('This trader profile cannot submit a new qualification application.');
        }

        const activeApplication = await transaction.leadTraderApplication.findFirst({
          where: {
            tenantId,
            traderId: profile.id,
            activeApplicationKey: profile.id,
            status: { in: ACTIVE_APPLICATION_STATUSES },
          },
          select: { id: true, status: true },
        });
        if (activeApplication) {
          throw new ConflictException(`An application is already ${activeApplication.status.toLowerCase().replace('_', ' ')}.`);
        }

        const previous = await transaction.leadTraderApplication.findFirst({
          where: { tenantId, traderId: profile.id },
          orderBy: { version: 'desc' },
          select: { version: true, status: true },
        });
        if (previous && previous.status !== 'REJECTED') {
          throw new ConflictException('A new application is allowed only after a prior rejection.');
        }

        const version = (previous?.version ?? 0) + 1;
        const created = await transaction.leadTraderApplication.create({
          data: {
            tenantId,
            traderId: profile.id,
            applicantUserId,
            status: 'SUBMITTED',
            version,
            declaration: {
              yearsExperience: declaration.yearsExperience,
              markets: declaration.markets,
              strategySummary: declaration.strategySummary,
              evidenceReferences: declaration.evidenceReferences,
              riskAcknowledged: declaration.riskAcknowledged,
            },
            requestFingerprint: fingerprint,
            idempotencyKey: input.idempotencyKey,
            activeApplicationKey: profile.id,
          },
        });
        const updatedProfile = await transaction.traderProfile.updateMany({
          where: { id: profile.id, tenantId, userId: applicantUserId, deletedAt: null },
          data: { verificationState: 'PENDING', verifiedAt: null, verifiedById: null },
        });
        if (updatedProfile.count !== 1) {
          throw new NotFoundException('Trader profile changed while the application was being submitted.');
        }
        return { application: this.applicantView(created), created: true };
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (this.isUniqueConstraintError(error) || this.isSerializationError(error)) {
        const committedReplay = await this.prisma.leadTraderApplication.findFirst({
          where: { tenantId, idempotencyKey: input.idempotencyKey },
        });
        if (
          committedReplay
          && committedReplay.applicantUserId === applicantUserId
          && committedReplay.requestFingerprint === fingerprint
        ) {
          return this.applicantView(committedReplay);
        }
        throw new ConflictException('An application changed concurrently. Refresh and review the current application.');
      }
      throw error;
    }

    if (outcome.created) {
      await this.auditService.recordImmediate({
        tenantId,
        actorType: AuditActorType.USER,
        actorId: applicantUserId,
        action: 'LEAD_TRADER_APPLICATION_SUBMITTED',
        outcome: AuditOutcome.SUCCESS,
        resourceType: 'LEAD_TRADER_APPLICATION',
        resourceId: outcome.application.id,
        description: 'Lead-trader qualification application submitted.',
        metadata: {
          status: outcome.application.status,
          version: outcome.application.version,
          requestFingerprint: fingerprint,
        },
      });
    }
    return outcome.application;
  }

  async listMine(tenantId: string, applicantUserId: string) {
    const profile = await this.prisma.traderProfile.findFirst({
      where: { tenantId, userId: applicantUserId, deletedAt: null },
      select: { id: true },
    });
    if (!profile) throw new NotFoundException('Trader profile not found.');
    return this.prisma.leadTraderApplication.findMany({
      where: { tenantId, traderId: profile.id, applicantUserId },
      orderBy: [{ version: 'desc' }, { submittedAt: 'desc' }],
      take: 20,
      select: APPLICANT_APPLICATION_SELECT,
    });
  }

  async listQueue(params: {
    tenantId: string;
    status?: LeadTraderApplicationStatus;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, Math.trunc(params.page ?? 1));
    const limit = Math.min(100, Math.max(1, Math.trunc(params.limit ?? 20)));
    const where = {
      tenantId: params.tenantId,
      ...(params.status ? { status: params.status } : { status: { in: ACTIVE_APPLICATION_STATUSES } }),
    };
    const [data, total] = await Promise.all([
      this.prisma.leadTraderApplication.findMany({
        where,
        orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: ADMIN_APPLICATION_SELECT,
      }),
      this.prisma.leadTraderApplication.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async startReview(tenantId: string, applicationId: string, reviewerUserId: string) {
    const application = await this.prisma.leadTraderApplication.findFirst({
      where: { id: applicationId, tenantId },
      select: { id: true, traderId: true, applicantUserId: true, reviewerUserId: true, status: true },
    });
    if (!application) throw new NotFoundException('Application not found.');
    if (application.applicantUserId === reviewerUserId) throw new ForbiddenException('Applicants cannot review their own applications.');
    if (application.status === 'IN_REVIEW' && application.reviewerUserId === reviewerUserId) {
      const claimed = await this.prisma.leadTraderApplication.findFirst({
        where: { id: applicationId, tenantId },
        select: ADMIN_APPLICATION_SELECT,
      });
      if (!claimed) throw new NotFoundException('Application not found.');
      return claimed;
    }
    if (application.status !== 'SUBMITTED') throw new ConflictException('Only submitted applications can be claimed for review.');

    const result = await this.prisma.leadTraderApplication.updateMany({
      where: { id: applicationId, tenantId, status: 'SUBMITTED', activeApplicationKey: application.traderId },
      data: { status: 'IN_REVIEW', reviewerUserId },
    });
    if (result.count !== 1) throw new ConflictException('Another operator claimed or changed this application.');
    const updated = await this.prisma.leadTraderApplication.findFirst({
      where: { id: applicationId, tenantId },
      select: ADMIN_APPLICATION_SELECT,
    });
    if (!updated) throw new NotFoundException('Application not found after review claim.');

    await this.auditService.recordImmediate({
      tenantId,
      actorType: AuditActorType.USER,
      actorId: reviewerUserId,
      action: 'LEAD_TRADER_APPLICATION_REVIEW_STARTED',
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'LEAD_TRADER_APPLICATION',
      resourceId: applicationId,
      description: 'Operator claimed a lead-trader application for review.',
      metadata: { previousStatus: 'SUBMITTED', status: 'IN_REVIEW' },
    });
    return updated;
  }

  async transition(
    tenantId: string,
    applicationId: string,
    reviewerUserId: string,
    decision: LeadTraderReviewDecision,
    decisionReason?: string,
  ) {
    const normalizedReason = decisionReason?.trim() ?? '';
    if (decision !== LeadTraderReviewDecision.APPROVE && decision !== LeadTraderReviewDecision.REJECT) {
      throw new BadRequestException('Unsupported lead-trader application decision.');
    }
    if (decision === LeadTraderReviewDecision.REJECT && normalizedReason.length < 20) {
      throw new BadRequestException('A rejection reason of at least 20 characters is required.');
    }
    if (normalizedReason.length > 1000) {
      throw new BadRequestException('Decision reason is too long.');
    }

    const result = await this.prisma.$transaction(async (transaction) => {
      const application = await transaction.leadTraderApplication.findFirst({
        where: { id: applicationId, tenantId },
        select: { id: true, traderId: true, applicantUserId: true, reviewerUserId: true, status: true },
      });
      if (!application) throw new NotFoundException('Application not found.');
      if (application.applicantUserId === reviewerUserId) throw new ForbiddenException('Applicants cannot review their own applications.');
      if (application.status !== 'IN_REVIEW' || application.reviewerUserId !== reviewerUserId) {
        throw new ConflictException('Only the operator who claimed an in-review application may decide it.');
      }

      const nextStatus: LeadTraderApplicationStatus = decision === LeadTraderReviewDecision.APPROVE ? 'APPROVED' : 'REJECTED';
      const now = new Date();
      const updated = await transaction.leadTraderApplication.updateMany({
        where: {
          id: applicationId,
          tenantId,
          status: 'IN_REVIEW',
          reviewerUserId,
          activeApplicationKey: application.traderId,
        },
        data: {
          status: nextStatus,
          activeApplicationKey: null,
          reviewedAt: now,
          decisionReason: normalizedReason || null,
        },
      });
      if (updated.count !== 1) throw new ConflictException('Application state changed before the decision could be saved.');

      const profileUpdate = await transaction.traderProfile.updateMany({
        where: { id: application.traderId, tenantId },
        data: decision === LeadTraderReviewDecision.APPROVE
          ? { verificationState: 'VERIFIED', verifiedAt: now, verifiedById: reviewerUserId }
          : { verificationState: 'REJECTED', verifiedAt: null, verifiedById: null },
      });
      if (profileUpdate.count !== 1) throw new NotFoundException('Trader profile not found in this tenant.');
      const reviewed = await transaction.leadTraderApplication.findFirst({ where: { id: applicationId, tenantId }, select: ADMIN_APPLICATION_SELECT });
      if (!reviewed) throw new NotFoundException('Application not found after review.');
      return { application: reviewed, previousStatus: application.status };
    }, { isolationLevel: 'Serializable' });

    await this.auditService.recordImmediate({
      tenantId,
      actorType: AuditActorType.USER,
      actorId: reviewerUserId,
      action: decision === LeadTraderReviewDecision.APPROVE ? 'LEAD_TRADER_APPLICATION_APPROVED' : 'LEAD_TRADER_APPLICATION_REJECTED',
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'LEAD_TRADER_APPLICATION',
      resourceId: applicationId,
      description: 'Lead-trader application decision recorded.',
      metadata: {
        previousStatus: result.previousStatus,
        status: result.application.status,
        traderId: result.application.traderId,
        version: result.application.version,
      },
      changes: { status: { before: result.previousStatus, after: result.application.status } },
    });
    return result.application;
  }

  private validateDeclaration(input: SubmitLeadTraderApplicationDto): LeadTraderApplicationDeclaration {
    const strategySummary = typeof input.strategySummary === 'string' ? input.strategySummary.trim() : '';
    const markets = Array.isArray(input.markets)
      ? Array.from(new Set(input.markets.map((market) => typeof market === 'string' ? market.trim().toUpperCase() : ''))).sort()
      : [];
    const evidenceReferences = Array.isArray(input.evidenceReferences)
      ? Array.from(new Set(input.evidenceReferences.map((reference) => typeof reference === 'string' ? reference.trim() : ''))).sort()
      : [];
    if (!Number.isInteger(input.yearsExperience) || input.yearsExperience < 0 || input.yearsExperience > 50) {
      throw new BadRequestException('yearsExperience must be an integer between 0 and 50.');
    }
    if (markets.length === 0 || markets.some((market) => !['SPOT', 'USDT_PERPETUAL', 'COIN_PERPETUAL'].includes(market))) {
      throw new BadRequestException('Select at least one supported market type.');
    }
    if (strategySummary.length < 50 || strategySummary.length > 1000) {
      throw new BadRequestException('A strategy summary between 50 and 1000 characters is required.');
    }
    if (evidenceReferences.length > 20 || evidenceReferences.some((reference) => !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(reference))) {
      throw new BadRequestException('Evidence references must be opaque reference identifiers, not URLs or uploaded secrets.');
    }
    if (input.riskAcknowledged !== true) throw new BadRequestException('Risk disclosure acknowledgement is required.');
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,254}$/.test(input.idempotencyKey)) {
      throw new BadRequestException('A valid idempotency key is required.');
    }
    return {
      yearsExperience: input.yearsExperience,
      markets,
      strategySummary,
      evidenceReferences,
      riskAcknowledged: true,
    };
  }

  private applicantView(application: FullApplication): ApplicantApplicationView {
    return {
      id: application.id,
      traderId: application.traderId,
      status: application.status,
      version: application.version,
      declaration: application.declaration,
      submittedAt: application.submittedAt,
      reviewedAt: application.reviewedAt,
      decisionReason: application.decisionReason,
    };
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return this.prismaErrorCode(error) === 'P2002';
  }

  private isSerializationError(error: unknown): boolean {
    return this.prismaErrorCode(error) === 'P2034';
  }

  private prismaErrorCode(error: unknown): string | null {
    if (typeof error !== 'object' || error === null || !('code' in error)) return null;
    return typeof error.code === 'string' ? error.code : null;
  }
}
