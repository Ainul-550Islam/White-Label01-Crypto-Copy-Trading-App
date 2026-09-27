import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CompliancePolicyService } from './compliance-policy.service';
import { KycProviderFactory } from './kyc-provider.factory';
import { ComplianceAuditService } from './compliance-audit.service';
import { ComplianceCaseRepository } from './compliance-case.repository';
import { KycState, ComplianceDecision, ComplianceCaseType, RiskLevel, sanitizeMetadata, hashPii } from './compliance.types';
import { randomUUID } from 'crypto';

/**
 * Main KYC orchestration.
 * Flow: onboarding → determine requirement → provider request → verification state → normalized result → audit
 * - Do not trust client claims
 * - Do not mark VERIFIED without authoritative provider/result state
 * - Idempotent request creation
 * - Safe PII handling, no raw docs in logs
 */
@Injectable()
export class IdentityVerificationService {
  private readonly logger = new Logger(IdentityVerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policyService: CompliancePolicyService,
    private readonly kycFactory: KycProviderFactory,
    private readonly auditService: ComplianceAuditService,
    private readonly caseRepository: ComplianceCaseRepository,
  ) {}

  async startVerification(params: {
    tenantId: string;
    userId: string;
    email: string;
    countryCode?: string;
    jurisdiction?: string;
    levelName?: string;
    idempotencyKey?: string;
    actorId?: string;
    ipHash?: string;
    requestId?: string;
  }): Promise<{
    provider: string;
    providerReference: string;
    sessionId: string;
    status: KycState;
    verificationUrl?: string;
    expiresAt?: string;
    idempotencyKey: string;
  }> {
    const jurisdiction = params.jurisdiction || 'DEFAULT';
    const idempotencyKey = params.idempotencyKey || `kyc_${params.tenantId}_${params.userId}_${Date.now()}`;

    // Idempotency check
    try {
      const existingRequest = await (this.prisma as any).complianceScreeningRequest?.findFirst({ where: { idempotencyKey } });
      if (existingRequest) {
        this.logger.log(`Idempotent KYC start return key=${idempotencyKey}`);
        return {
          provider: existingRequest.provider || 'UNKNOWN',
          providerReference: existingRequest.providerRef || 'unknown',
          sessionId: existingRequest.providerRef || 'unknown',
          status: (existingRequest.kycState as KycState) || KycState.PENDING,
          idempotencyKey,
        };
      }
    } catch {}

    // Determine requirement from policy
    const policy = await this.policyService.getEffectivePolicy({ tenantId: params.tenantId, jurisdiction });
    if (!policy.kycRequired) {
      this.logger.log(`KYC not required per policy tenant=${params.tenantId} jurisdiction=${jurisdiction}`);
      return {
        provider: 'POLICY',
        providerReference: `policy_${params.tenantId}_${params.userId}`,
        sessionId: `policy_${params.userId}`,
        status: KycState.NOT_STARTED,
        idempotencyKey,
      };
    }

    // Check existing KYC profile
    try {
      const existingProfile = await (this.prisma as any).kycProfile?.findUnique({ where: { userId: params.userId } });
      if (existingProfile) {
        if (existingProfile.status === 'APPROVED' && existingProfile.expiresAt && new Date(existingProfile.expiresAt) > new Date()) {
          return {
            provider: existingProfile.provider || 'EXISTING',
            providerReference: existingProfile.externalApplicantId || existingProfile.id,
            sessionId: existingProfile.externalApplicantId || existingProfile.id,
            status: KycState.VERIFIED,
            idempotencyKey,
          };
        }
        if (existingProfile.status === 'PENDING' || existingProfile.status === 'IN_REVIEW') {
          return {
            provider: existingProfile.provider || 'EXISTING',
            providerReference: existingProfile.externalApplicantId || existingProfile.id,
            sessionId: existingProfile.externalApplicantId || existingProfile.id,
            status: KycState.PENDING,
            idempotencyKey,
          };
        }
      }
    } catch {}

    // Get provider
    const provider = this.kycFactory.getConfiguredProvider();
    if (!provider.isAvailable()) {
      this.logger.warn(`KYC provider unavailable tenant=${params.tenantId} user=${params.userId} - explicit PENDING, no VERIFIED fallback`);

      // Create screening request with PROVIDER_UNAVAILABLE
      try {
        await (this.prisma as any).complianceScreeningRequest?.create({
          data: {
            id: randomUUID(),
            tenantId: params.tenantId,
            userId: params.userId,
            type: 'KYC',
            provider: 'UNAVAILABLE',
            providerRef: `unavail_${params.userId}`,
            status: 'PENDING',
            kycState: KycState.PENDING,
            decision: ComplianceDecision.PENDING,
            riskLevel: RiskLevel.UNKNOWN,
            idempotencyKey,
            safeMetadata: { reason: 'PROVIDER_UNAVAILABLE', jurisdiction },
            failureReason: 'KYC provider unavailable - explicit REVIEW_REQUIRED',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
      } catch {}

      await this.auditService.record({
        tenantId: params.tenantId,
        userId: params.userId,
        action: 'KYC_STARTED',
        actorId: params.actorId,
        outcome: 'FAILURE',
        safeMetadata: { provider: 'UNAVAILABLE', reason: 'PROVIDER_UNAVAILABLE' },
        ipHash: params.ipHash,
        requestId: params.requestId,
      });

      return {
        provider: 'UNAVAILABLE',
        providerReference: `unavail_${params.userId}_${Date.now()}`,
        sessionId: `unavail_${params.userId}`,
        status: KycState.PENDING,
        idempotencyKey,
      };
    }

    // Safe PII: only hash
    const emailHash = hashPii(params.email.toLowerCase());

    try {
      const result = await provider.createVerificationSession({
        tenantId: params.tenantId,
        userId: params.userId,
        emailHash,
        countryCode: params.countryCode,
        jurisdiction,
        levelName: params.levelName,
        idempotencyKey,
        safeMetadata: { jurisdiction, tenantId: params.tenantId },
      });

      // Persist screening request
      try {
        await (this.prisma as any).complianceScreeningRequest?.create({
          data: {
            id: randomUUID(),
            tenantId: params.tenantId,
            userId: params.userId,
            type: 'KYC',
            provider: result.provider,
            providerRef: result.providerReference,
            status: 'PENDING',
            kycState: result.status,
            decision: ComplianceDecision.PENDING,
            riskLevel: RiskLevel.UNKNOWN,
            idempotencyKey,
            safeMetadata: { sessionId: result.sessionId, jurisdiction },
            createdAt: new Date(),
            updatedAt: new Date(),
            expiresAt: result.expiresAt ? new Date(result.expiresAt) : null,
          },
        });

        // Also update KycProfile for backward compatibility
        await (this.prisma as any).kycProfile?.upsert({
          where: { userId: params.userId },
          update: {
            status: 'PENDING',
            provider: result.provider,
            externalApplicantId: result.providerReference,
            submittedAt: new Date(),
            metadata: { sessionId: result.sessionId },
          },
          create: {
            id: randomUUID(),
            tenantId: params.tenantId,
            userId: params.userId,
            status: 'PENDING',
            provider: result.provider,
            externalApplicantId: result.providerReference,
            submittedAt: new Date(),
            metadata: { sessionId: result.sessionId },
          },
        });
      } catch (e: any) {
        this.logger.warn(`Failed to persist KYC screening request: ${e.message}`);
      }

      await this.auditService.recordKycStarted(params.tenantId, params.userId, params.actorId || params.userId, result.providerReference, params.ipHash, params.requestId);

      return {
        provider: result.provider,
        providerReference: result.providerReference,
        sessionId: result.sessionId,
        status: result.status,
        verificationUrl: result.verificationUrl,
        expiresAt: result.expiresAt,
        idempotencyKey,
      };
    } catch (e: any) {
      this.logger.error(`KYC session creation failed tenant=${params.tenantId} user=${params.userId}: ${e.message}`);

      await this.auditService.record({
        tenantId: params.tenantId,
        userId: params.userId,
        action: 'KYC_STARTED',
        actorId: params.actorId,
        outcome: 'FAILURE',
        safeMetadata: { error: e.message.substring(0, 200), provider: provider.providerName },
        ipHash: params.ipHash,
        requestId: params.requestId,
      });

      throw e;
    }
  }

  async getStatus(params: { tenantId: string; userId: string; providerReference?: string }): Promise<{
    kycState: KycState;
    decision: ComplianceDecision;
    provider?: string;
    providerReference?: string;
    verifiedAt?: string;
    expiresAt?: string;
    requiresReverification: boolean;
    safeMetadata: Record<string, any>;
  }> {
    try {
      // Try screening request first
      let screeningRequest: any = null;
      if (params.providerReference) {
        screeningRequest = await (this.prisma as any).complianceScreeningRequest?.findFirst({
          where: { tenantId: params.tenantId, userId: params.userId, providerRef: params.providerReference },
          orderBy: { createdAt: 'desc' },
        });
      } else {
        screeningRequest = await (this.prisma as any).complianceScreeningRequest?.findFirst({
          where: { tenantId: params.tenantId, userId: params.userId, type: 'KYC' },
          orderBy: { createdAt: 'desc' },
        });
      }

      if (screeningRequest) {
        // If pending, try to get authoritative result from provider
        if (screeningRequest.kycState === KycState.PENDING || screeningRequest.kycState === 'PENDING') {
          const provider = this.kycFactory.getProvider(screeningRequest.provider);
          if (provider.isAvailable()) {
            try {
              const result = await provider.getVerificationStatus({
                tenantId: params.tenantId,
                userId: params.userId,
                providerReference: screeningRequest.providerRef,
              });

              // Update screening request with authoritative result - never trust client
              if (result.status === KycState.VERIFIED) {
                await this.handleVerifiedResult(params.tenantId, params.userId, screeningRequest, result);
              } else if (result.status === KycState.REJECTED) {
                await this.handleRejectedResult(params.tenantId, params.userId, screeningRequest, result);
              }

              return {
                kycState: result.status,
                decision: result.decision,
                provider: result.provider,
                providerReference: result.providerReference,
                verifiedAt: result.verifiedAt,
                expiresAt: result.expiresAt,
                requiresReverification: !!result.requiresReverification,
                safeMetadata: result.safeMetadata,
              };
            } catch (e: any) {
              this.logger.warn(`Failed to get KYC status from provider: ${e.message}`);
            }
          }
        }

        return {
          kycState: (screeningRequest.kycState as KycState) || KycState.PENDING,
          decision: (screeningRequest.decision as ComplianceDecision) || ComplianceDecision.PENDING,
          provider: screeningRequest.provider,
          providerReference: screeningRequest.providerRef,
          requiresReverification: false,
          safeMetadata: screeningRequest.safeMetadata || {},
        };
      }

      // Fallback to KycProfile
      const profile = await (this.prisma as any).kycProfile?.findUnique({ where: { userId: params.userId } });
      if (profile) {
        const kycState = this.mapKycProfileStatus(profile.status);
        return {
          kycState,
          decision: kycState === KycState.VERIFIED ? ComplianceDecision.ALLOW : ComplianceDecision.PENDING,
          provider: profile.provider || undefined,
          providerReference: profile.externalApplicantId || undefined,
          verifiedAt: profile.reviewedAt ? new Date(profile.reviewedAt).toISOString() : undefined,
          expiresAt: profile.expiresAt ? new Date(profile.expiresAt).toISOString() : undefined,
          requiresReverification: profile.status === 'EXPIRED' || (profile.expiresAt && new Date(profile.expiresAt) < new Date() ? true : false),
          safeMetadata: { status: profile.status },
        };
      }

      return {
        kycState: KycState.NOT_STARTED,
        decision: ComplianceDecision.PENDING,
        requiresReverification: false,
        safeMetadata: {},
      };
    } catch (e: any) {
      this.logger.warn(`Get KYC status failed: ${e.message}`);
      return {
        kycState: KycState.PENDING,
        decision: ComplianceDecision.PENDING,
        requiresReverification: false,
        safeMetadata: { error: 'Failed to fetch status' },
      };
    }
  }

  async retryVerification(params: {
    tenantId: string;
    userId: string;
    idempotencyKey?: string;
    actorId?: string;
    ipHash?: string;
    requestId?: string;
  }): Promise<any> {
    const idempotencyKey = params.idempotencyKey || `kyc_retry_${params.tenantId}_${params.userId}_${Date.now()}`;

    // Check if already verified
    const current = await this.getStatus({ tenantId: params.tenantId, userId: params.userId });
    if (current.kycState === KycState.VERIFIED) {
      return { status: KycState.VERIFIED, message: 'Already verified', idempotencyKey };
    }

    // Start new verification (idempotent)
    const user = await (this.prisma as any).user?.findUnique({ where: { id: params.userId }, select: { email: true, tenantId: true } });
    const email = user?.email || `${params.userId}@example.com`;

    return this.startVerification({
      tenantId: params.tenantId,
      userId: params.userId,
      email,
      idempotencyKey,
      actorId: params.actorId,
      ipHash: params.ipHash,
      requestId: params.requestId,
    });
  }

  async handleProviderCallback(params: {
    tenantId: string;
    providerReference: string;
    provider: string;
    status: string;
    safeMetadata?: Record<string, any>;
  }): Promise<void> {
    // Never trust client claims - verify via provider
    const provider = this.kycFactory.getProvider(params.provider);
    if (!provider.isAvailable()) {
      this.logger.warn(`Provider callback received but provider unavailable ref=${params.providerReference}`);
      return;
    }

    try {
      const screeningRequest = await (this.prisma as any).complianceScreeningRequest?.findFirst({
        where: { providerRef: params.providerReference, tenantId: params.tenantId },
      });

      if (!screeningRequest) {
        this.logger.warn(`Callback for unknown screening request ref=${params.providerReference}`);
        return;
      }

      const result = await provider.verifyResult(params.providerReference, screeningRequest.tenantId, screeningRequest.userId);

      if (result.status === KycState.VERIFIED) {
        await this.handleVerifiedResult(screeningRequest.tenantId, screeningRequest.userId, screeningRequest, result);
      } else if (result.status === KycState.REJECTED) {
        await this.handleRejectedResult(screeningRequest.tenantId, screeningRequest.userId, screeningRequest, result);
      } else {
        // Update to pending/in_review
        try {
          await (this.prisma as any).complianceScreeningRequest?.update({
            where: { id: screeningRequest.id },
            data: { kycState: result.status, decision: result.decision, safeMetadata: result.safeMetadata, updatedAt: new Date() },
          });
        } catch {}
      }
    } catch (e: any) {
      this.logger.warn(`Handle provider callback failed: ${e.message}`);
    }
  }

  private async handleVerifiedResult(tenantId: string, userId: string, screeningRequest: any, result: any): Promise<void> {
    try {
      await (this.prisma as any).complianceScreeningRequest?.update({
        where: { id: screeningRequest.id },
        data: {
          kycState: KycState.VERIFIED,
          decision: ComplianceDecision.ALLOW,
          riskLevel: result.riskLevel || RiskLevel.LOW,
          safeMetadata: result.safeMetadata,
          updatedAt: new Date(),
        },
      });

      await (this.prisma as any).kycProfile?.upsert({
        where: { userId },
        update: {
          status: 'APPROVED',
          reviewedAt: new Date(),
          expiresAt: result.expiresAt ? new Date(result.expiresAt) : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
          riskScore: result.riskLevel === RiskLevel.LOW ? 10 : result.riskLevel === RiskLevel.MEDIUM ? 50 : 80,
          metadata: { providerReference: result.providerReference },
        },
        create: {
          id: randomUUID(),
          tenantId,
          userId,
          status: 'APPROVED',
          provider: result.provider,
          externalApplicantId: result.providerReference,
          reviewedAt: new Date(),
          expiresAt: result.expiresAt ? new Date(result.expiresAt) : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
          metadata: { providerReference: result.providerReference },
        },
      });

      // Update user kycStatus
      try {
        await (this.prisma as any).user?.update({ where: { id: userId }, data: { kycStatus: 'APPROVED' } });
      } catch {}

      await this.auditService.recordKycVerified(tenantId, userId, result.providerReference);
    } catch (e: any) {
      this.logger.warn(`Handle verified result failed: ${e.message}`);
    }
  }

  private async handleRejectedResult(tenantId: string, userId: string, screeningRequest: any, result: any): Promise<void> {
    try {
      await (this.prisma as any).complianceScreeningRequest?.update({
        where: { id: screeningRequest.id },
        data: {
          kycState: KycState.REJECTED,
          decision: ComplianceDecision.BLOCK,
          safeMetadata: result.safeMetadata,
          failureReason: result.reasonCode,
          updatedAt: new Date(),
        },
      });

      await (this.prisma as any).kycProfile?.upsert({
        where: { userId },
        update: {
          status: 'REJECTED',
          reviewedAt: new Date(),
          rejectionReason: result.reasonCode,
        },
        create: {
          id: randomUUID(),
          tenantId,
          userId,
          status: 'REJECTED',
          provider: result.provider,
          externalApplicantId: result.providerReference,
          reviewedAt: new Date(),
          rejectionReason: result.reasonCode,
        },
      });

      try {
        await (this.prisma as any).user?.update({ where: { id: userId }, data: { kycStatus: 'REJECTED' } });
      } catch {}

      await this.auditService.recordKycRejected(tenantId, userId, result.providerReference, result.reasonCode || 'REJECTED');

      // Create compliance case for rejected KYC
      try {
        await this.caseRepository.createCase({
          tenantId,
          userId,
          caseType: ComplianceCaseType.KYC_VERIFICATION,
          riskLevel: RiskLevel.HIGH,
          safeSummary: `KYC rejected for user ${userId} reason ${result.reasonCode}`,
          ruleIds: ['KYC_VERIFICATION_REQUIRED'],
          idempotencyKey: `case_kyc_rejected_${tenantId}_${userId}_${Date.now()}`,
        });
      } catch {}
    } catch (e: any) {
      this.logger.warn(`Handle rejected result failed: ${e.message}`);
    }
  }

  private mapKycProfileStatus(status: string): KycState {
    switch (status) {
      case 'NOT_STARTED':
        return KycState.NOT_STARTED;
      case 'PENDING':
        return KycState.PENDING;
      case 'IN_REVIEW':
        return KycState.IN_REVIEW;
      case 'APPROVED':
        return KycState.VERIFIED;
      case 'REJECTED':
        return KycState.REJECTED;
      case 'EXPIRED':
        return KycState.EXPIRED;
      default:
        return KycState.NOT_STARTED;
    }
  }
}
