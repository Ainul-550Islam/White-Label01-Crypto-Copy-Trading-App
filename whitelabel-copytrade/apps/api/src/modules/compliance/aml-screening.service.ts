import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CompliancePolicyService } from './compliance-policy.service';
import { AmlProviderFactory } from './aml-provider.factory';
import { ComplianceAuditService } from './compliance-audit.service';
import { ComplianceCaseRepository } from './compliance-case.repository';
import { AmlState, ComplianceDecision, RiskLevel, ComplianceCaseType, hashPii, sanitizeMetadata } from './compliance.types';
import { randomUUID } from 'crypto';

/**
 * AML/sanctions/PEP screening orchestration.
 * Normalize results into CLEAR, POTENTIAL_MATCH, MATCH, REVIEW_REQUIRED, BLOCKED, PROVIDER_UNAVAILABLE
 * No final legal determinations beyond configured rules and provider results.
 */
@Injectable()
export class AmlScreeningService {
  private readonly logger = new Logger(AmlScreeningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policyService: CompliancePolicyService,
    private readonly amlFactory: AmlProviderFactory,
    private readonly auditService: ComplianceAuditService,
    private readonly caseRepository: ComplianceCaseRepository,
  ) {}

  async screenPerson(params: {
    tenantId: string;
    userId: string;
    firstName?: string;
    lastName?: string;
    countryCode?: string;
    dateOfBirth?: string;
    jurisdiction?: string;
    idempotencyKey?: string;
    actorId?: string;
  }): Promise<{
    provider: string;
    providerReference: string;
    status: AmlState;
    decision: ComplianceDecision;
    riskLevel: RiskLevel;
    idempotencyKey: string;
  }> {
    const jurisdiction = params.jurisdiction || 'DEFAULT';
    const idempotencyKey = params.idempotencyKey || `aml_person_${params.tenantId}_${params.userId}_${Date.now()}`;

    // Idempotency
    try {
      const existing = await (this.prisma as any).complianceScreeningRequest?.findFirst({ where: { idempotencyKey } });
      if (existing) {
        this.logger.log(`Idempotent AML person screening return key=${idempotencyKey}`);
        return {
          provider: existing.provider || 'UNKNOWN',
          providerReference: existing.providerRef || 'unknown',
          status: (existing.amlState as AmlState) || AmlState.REVIEW_REQUIRED,
          decision: (existing.decision as ComplianceDecision) || ComplianceDecision.PENDING,
          riskLevel: (existing.riskLevel as RiskLevel) || RiskLevel.UNKNOWN,
          idempotencyKey,
        };
      }
    } catch {}

    const policy = await this.policyService.getEffectivePolicy({ tenantId: params.tenantId, jurisdiction });
    if (!policy.amlRequired && !policy.sanctionsRequired) {
      this.logger.log(`AML not required per policy tenant=${params.tenantId}`);
      return {
        provider: 'POLICY',
        providerReference: `policy_${params.userId}`,
        status: AmlState.CLEAR,
        decision: ComplianceDecision.ALLOW,
        riskLevel: RiskLevel.LOW,
        idempotencyKey,
      };
    }

    const provider = this.amlFactory.getConfiguredProvider();
    if (!provider.isAvailable()) {
      this.logger.warn(`AML provider unavailable tenant=${params.tenantId} user=${params.userId} - explicit REVIEW_REQUIRED, NOT CLEAR`);

      try {
        await (this.prisma as any).complianceScreeningRequest?.create({
          data: {
            id: randomUUID(),
            tenantId: params.tenantId,
            userId: params.userId,
            type: 'AML',
            provider: 'UNAVAILABLE',
            providerRef: `unavail_${params.userId}`,
            status: 'PENDING',
            amlState: AmlState.PROVIDER_UNAVAILABLE,
            decision: ComplianceDecision.PENDING,
            riskLevel: RiskLevel.UNKNOWN,
            idempotencyKey,
            safeMetadata: { reason: 'PROVIDER_UNAVAILABLE', jurisdiction },
            failureReason: 'AML provider unavailable - explicit REVIEW_REQUIRED',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
      } catch {}

      await this.auditService.record({
        tenantId: params.tenantId,
        userId: params.userId,
        action: 'AML_SCREENING_STARTED',
        actorId: params.actorId,
        outcome: 'FAILURE',
        safeMetadata: { provider: 'UNAVAILABLE', screeningType: 'PERSON' },
      });

      return {
        provider: 'UNAVAILABLE',
        providerReference: `unavail_${params.userId}`,
        status: AmlState.PROVIDER_UNAVAILABLE,
        decision: ComplianceDecision.PENDING,
        riskLevel: RiskLevel.UNKNOWN,
        idempotencyKey,
      };
    }

    const firstNameHash = params.firstName ? hashPii(params.firstName.toLowerCase()) : undefined;
    const lastNameHash = params.lastName ? hashPii(params.lastName.toLowerCase()) : undefined;
    const dobHash = params.dateOfBirth ? hashPii(params.dateOfBirth) : undefined;

    try {
      const result = await provider.screenPerson({
        tenantId: params.tenantId,
        userId: params.userId,
        firstNameHash,
        lastNameHash,
        countryCode: params.countryCode,
        dateOfBirthHash: dobHash,
        jurisdiction,
        idempotencyKey,
        safeMetadata: { jurisdiction },
      });

      // Persist
      try {
        await (this.prisma as any).complianceScreeningRequest?.create({
          data: {
            id: randomUUID(),
            tenantId: params.tenantId,
            userId: params.userId,
            type: 'AML',
            provider: result.provider,
            providerRef: result.providerReference,
            status: result.status === AmlState.CLEAR ? 'CLEAR' : 'REVIEW',
            amlState: result.status,
            decision: result.decision,
            riskLevel: result.riskLevel,
            idempotencyKey,
            safeMetadata: result.safeMetadata,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
      } catch {}

      // Audit based on result
      if (result.status === AmlState.CLEAR) {
        await this.auditService.recordAmlClear(params.tenantId, params.userId, result.providerReference);
      } else if (result.status === AmlState.POTENTIAL_MATCH) {
        await this.auditService.recordAmlPotentialMatch(params.tenantId, params.userId, result.providerReference, result.matchedLists);
      } else if (result.status === AmlState.MATCH) {
        await this.auditService.recordAmlMatch(params.tenantId, params.userId, result.providerReference, result.matchedLists);
      } else if (result.status === AmlState.BLOCKED) {
        await this.auditService.recordAmlBlocked(params.tenantId, params.userId, result.providerReference, result.reasonCode);
      } else {
        await this.auditService.recordAmlStarted(params.tenantId, params.userId, result.providerReference, 'PERSON');
      }

      // Create case if match/block/review required per policy
      if ([AmlState.MATCH, AmlState.BLOCKED, AmlState.REVIEW_REQUIRED, AmlState.POTENTIAL_MATCH].includes(result.status)) {
        const blockedCountry = params.countryCode ? await this.policyService.isCountryBlocked(params.countryCode) : false;
        const caseType = blockedCountry ? ComplianceCaseType.SANCTIONS : result.matchedLists?.some((l: string) => l.toLowerCase().includes('pep')) ? ComplianceCaseType.PEP : ComplianceCaseType.AML_SCREENING;

        try {
          await this.caseRepository.createCase({
            tenantId: params.tenantId,
            userId: params.userId,
            caseType,
            riskLevel: result.riskLevel,
            safeSummary: `AML ${result.status} for user ${params.userId} provider ${result.provider} lists ${result.matchedLists?.join(',') || 'unknown'}`,
            ruleIds: ['AML_SCREENING_REQUIRED', 'SANCTIONS_CHECK'],
            sourceRefs: [{ type: 'AML_SCREENING', id: result.providerReference }],
            idempotencyKey: `case_aml_${params.tenantId}_${params.userId}_${result.providerReference}`,
          });
        } catch {}
      }

      return {
        provider: result.provider,
        providerReference: result.providerReference,
        status: result.status,
        decision: result.decision,
        riskLevel: result.riskLevel,
        idempotencyKey,
      };
    } catch (e: any) {
      this.logger.error(`AML person screening failed tenant=${params.tenantId} user=${params.userId}: ${e.message}`);
      await this.auditService.record({
        tenantId: params.tenantId,
        userId: params.userId,
        action: 'AML_SCREENING_STARTED',
        actorId: params.actorId,
        outcome: 'FAILURE',
        safeMetadata: { error: e.message.substring(0, 200) },
      });
      throw e;
    }
  }

  async screenTransaction(params: {
    tenantId: string;
    userId: string;
    transactionId: string;
    transactionType: string;
    amount: string;
    currency: string;
    counterparty?: string;
    jurisdiction?: string;
    idempotencyKey?: string;
  }): Promise<any> {
    const jurisdiction = params.jurisdiction || 'DEFAULT';
    const idempotencyKey = params.idempotencyKey || `aml_tx_${params.tenantId}_${params.transactionId}_${Date.now()}`;

    try {
      const existing = await (this.prisma as any).complianceScreeningRequest?.findFirst({ where: { idempotencyKey } });
      if (existing) {
        return {
          provider: existing.provider,
          providerReference: existing.providerRef,
          status: existing.amlState,
          decision: existing.decision,
          riskLevel: existing.riskLevel,
          idempotencyKey,
        };
      }
    } catch {}

    const provider = this.amlFactory.getConfiguredProvider();
    if (!provider.isAvailable()) {
      return {
        provider: 'UNAVAILABLE',
        providerReference: `unavail_tx_${params.transactionId}`,
        status: AmlState.PROVIDER_UNAVAILABLE,
        decision: ComplianceDecision.PENDING,
        riskLevel: RiskLevel.UNKNOWN,
        idempotencyKey,
      };
    }

    const counterpartyHash = params.counterparty ? hashPii(params.counterparty) : undefined;

    try {
      const result = await provider.screenTransaction({
        tenantId: params.tenantId,
        userId: params.userId,
        transactionId: params.transactionId,
        transactionType: params.transactionType,
        amount: params.amount,
        currency: params.currency,
        counterpartyHash,
        jurisdiction,
        idempotencyKey,
        safeMetadata: { transactionType: params.transactionType, currency: params.currency },
      });

      try {
        await (this.prisma as any).complianceScreeningRequest?.create({
          data: {
            id: randomUUID(),
            tenantId: params.tenantId,
            userId: params.userId,
            type: 'TRANSACTION',
            provider: result.provider,
            providerRef: result.providerReference,
            status: result.status,
            amlState: result.status,
            decision: result.decision,
            riskLevel: result.riskLevel,
            idempotencyKey,
            safeMetadata: result.safeMetadata,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
      } catch {}

      if ([AmlState.MATCH, AmlState.BLOCKED].includes(result.status)) {
        try {
          await this.caseRepository.createCase({
            tenantId: params.tenantId,
            userId: params.userId,
            caseType: ComplianceCaseType.TRANSACTION_REVIEW,
            riskLevel: result.riskLevel,
            safeSummary: `Transaction review ${result.status} for tx ${params.transactionId} amount ${params.currency} [REDACTED]`,
            ruleIds: ['TRANSACTION_AMOUNT_REVIEW', 'AML_SCREENING_REQUIRED'],
            sourceRefs: [{ type: 'TRANSACTION', id: params.transactionId }],
            idempotencyKey: `case_tx_${params.tenantId}_${params.transactionId}`,
          });
        } catch {}
      }

      return {
        provider: result.provider,
        providerReference: result.providerReference,
        status: result.status,
        decision: result.decision,
        riskLevel: result.riskLevel,
        idempotencyKey,
      };
    } catch (e: any) {
      this.logger.warn(`AML transaction screening failed: ${e.message}`);
      throw e;
    }
  }

  async getStatus(params: { tenantId: string; userId: string; providerReference?: string }): Promise<any> {
    try {
      let request: any = null;
      if (params.providerReference) {
        request = await (this.prisma as any).complianceScreeningRequest?.findFirst({
          where: { tenantId: params.tenantId, userId: params.userId, providerRef: params.providerReference },
          orderBy: { createdAt: 'desc' },
        });
      } else {
        request = await (this.prisma as any).complianceScreeningRequest?.findFirst({
          where: { tenantId: params.tenantId, userId: params.userId, type: { in: ['AML', 'TRANSACTION'] } },
          orderBy: { createdAt: 'desc' },
        });
      }

      if (!request) {
        return { amlState: AmlState.NOT_SCREENED, decision: ComplianceDecision.PENDING, riskLevel: RiskLevel.UNKNOWN, safeMetadata: {} };
      }

      return {
        amlState: request.amlState,
        decision: request.decision,
        riskLevel: request.riskLevel,
        provider: request.provider,
        providerReference: request.providerRef,
        safeMetadata: request.safeMetadata || {},
        screenedAt: request.createdAt ? new Date(request.createdAt).toISOString() : new Date().toISOString(),
      };
    } catch (e: any) {
      this.logger.warn(`Get AML status failed: ${e.message}`);
      return { amlState: AmlState.NOT_SCREENED, decision: ComplianceDecision.PENDING, riskLevel: RiskLevel.UNKNOWN, safeMetadata: {} };
    }
  }

  async rescreen(params: { tenantId: string; userId: string; providerReference: string; idempotencyKey?: string }): Promise<any> {
    const idempotencyKey = params.idempotencyKey || `aml_rescreen_${params.tenantId}_${params.providerReference}_${Date.now()}`;
    const provider = this.amlFactory.getConfiguredProvider();

    if (!provider.isAvailable()) {
      return { status: AmlState.PROVIDER_UNAVAILABLE, decision: ComplianceDecision.PENDING, riskLevel: RiskLevel.UNKNOWN, provider: 'UNAVAILABLE', providerReference: params.providerReference, idempotencyKey };
    }

    try {
      const result = await provider.rescreen(params.tenantId, params.providerReference, idempotencyKey);

      try {
        await (this.prisma as any).complianceScreeningRequest?.create({
          data: {
            id: randomUUID(),
            tenantId: params.tenantId,
            userId: params.userId,
            type: 'AML_RESCREEN',
            provider: result.provider,
            providerRef: result.providerReference,
            status: result.status,
            amlState: result.status,
            decision: result.decision,
            riskLevel: result.riskLevel,
            idempotencyKey,
            safeMetadata: result.safeMetadata,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
      } catch {}

      return {
        provider: result.provider,
        providerReference: result.providerReference,
        status: result.status,
        decision: result.decision,
        riskLevel: result.riskLevel,
        idempotencyKey,
      };
    } catch (e: any) {
      this.logger.warn(`Rescreen failed: ${e.message}`);
      throw e;
    }
  }
}
