// # Responsibility: orchestrate tenant-bound AML screening and require durable, safely narrowed evidence before reporting provider outcomes.
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import type { ComplianceScreeningRequest } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CompliancePolicyService, complianceJsonInput, complianceObject } from './compliance-policy.service';
import { AmlProviderFactory } from './aml-provider.factory';
import { ComplianceAuditService } from './compliance-audit.service';
import { ComplianceCaseRepository } from './compliance-case.repository';
import { AmlState, ComplianceDecision, RiskLevel, ComplianceCaseType, hashPii, sanitizeMetadata, type AmlScreeningResult } from './compliance.types';
import { randomUUID } from 'node:crypto';

export interface AmlScreeningResponse {
  provider: string;
  providerReference: string;
  status: AmlState;
  decision: ComplianceDecision;
  riskLevel: RiskLevel;
  idempotencyKey: string;
}

export interface AmlStatusResponse {
  amlState: AmlState;
  decision: ComplianceDecision;
  riskLevel: RiskLevel;
  provider?: string;
  providerReference?: string;
  safeMetadata: Record<string, unknown>;
  screenedAt?: string;
}

/** Provider outcomes are not legal determinations; required storage and review-case failures must propagate. */
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
  }): Promise<AmlScreeningResponse> {
    const jurisdiction = params.jurisdiction || 'DEFAULT';
    const idempotencyKey = params.idempotencyKey || `aml_person_${params.tenantId}_${params.userId}_${Date.now()}`;
    const existing = await this.existingRequest(params.tenantId, params.userId, idempotencyKey, 'AML');
    if (existing) return this.fromRequest(existing);

    const policy = await this.policyService.getEffectivePolicy({ tenantId: params.tenantId, jurisdiction });
    if (!policy.amlRequired && !policy.sanctionsRequired) {
      return { provider: 'POLICY', providerReference: `policy_${params.userId}`, status: AmlState.CLEAR,
        decision: ComplianceDecision.ALLOW, riskLevel: RiskLevel.LOW, idempotencyKey };
    }

    const provider = this.amlFactory.getConfiguredProvider();
    if (!provider.isAvailable()) {
      const response = await this.persistUnavailable({ ...params, idempotencyKey, type: 'AML',
        providerReference: `unavail_${params.userId}`, safeMetadata: { jurisdiction, screeningType: 'PERSON' } });
      await this.auditService.record({ tenantId: params.tenantId, userId: params.userId, action: 'AML_SCREENING_STARTED',
        actorId: params.actorId, outcome: 'FAILURE', safeMetadata: { provider: 'UNAVAILABLE', screeningType: 'PERSON' } });
      return response;
    }

    try {
      const result = await provider.screenPerson({
        tenantId: params.tenantId, userId: params.userId,
        firstNameHash: params.firstName ? hashPii(params.firstName.toLowerCase()) : undefined,
        lastNameHash: params.lastName ? hashPii(params.lastName.toLowerCase()) : undefined,
        countryCode: params.countryCode,
        dateOfBirthHash: params.dateOfBirth ? hashPii(params.dateOfBirth) : undefined,
        jurisdiction, idempotencyKey, safeMetadata: { jurisdiction },
      });
      this.validateProviderResult(result);
      if ([AmlState.MATCH, AmlState.BLOCKED, AmlState.REVIEW_REQUIRED, AmlState.POTENTIAL_MATCH].includes(result.status)) {
        const blockedCountry = params.countryCode ? await this.policyService.isCountryBlocked(params.countryCode, policy) : false;
        const caseType = blockedCountry ? ComplianceCaseType.SANCTIONS
          : result.matchedLists?.some((list) => list.toLowerCase().includes('pep')) ? ComplianceCaseType.PEP : ComplianceCaseType.AML_SCREENING;
        await this.createRequiredCase({ tenantId: params.tenantId, userId: params.userId, caseType,
          riskLevel: result.riskLevel,
          safeSummary: `AML ${result.status} for user ${params.userId} provider ${result.provider} lists ${result.matchedLists?.join(',') || 'unknown'}`,
          ruleIds: ['AML_SCREENING_REQUIRED', 'SANCTIONS_CHECK'],
          sourceRefs: [{ type: 'AML_SCREENING', id: result.providerReference }],
          idempotencyKey: `case_aml_${params.tenantId}_${params.userId}_${result.providerReference}` });
      }
      const response = await this.persistResult({ ...params, idempotencyKey, type: 'AML', result });
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
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`AML person screening failed tenant=${params.tenantId} user=${params.userId}: ${message}`);
      await this.auditService.record({ tenantId: params.tenantId, userId: params.userId, action: 'AML_SCREENING_STARTED',
        actorId: params.actorId, outcome: 'FAILURE', safeMetadata: { error: message.substring(0, 200) } });
      throw error;
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
  }): Promise<AmlScreeningResponse> {
    const jurisdiction = params.jurisdiction || 'DEFAULT';
    const idempotencyKey = params.idempotencyKey || `aml_tx_${params.tenantId}_${params.transactionId}_${Date.now()}`;
    const screeningSubject = { transactionId: params.transactionId, transactionType: params.transactionType,
      amount: params.amount, currency: params.currency };
    const existing = await this.existingRequest(params.tenantId, params.userId, idempotencyKey, 'TRANSACTION');
    if (existing) {
      const subject = complianceObject(complianceObject(existing.safeMetadata)?.screeningSubject);
      if (!subject || subject.transactionId !== params.transactionId || subject.transactionType !== params.transactionType
        || subject.amount !== params.amount || subject.currency !== params.currency) {
        throw new BadRequestException('AML idempotency key does not match the transaction payload');
      }
      return this.fromRequest(existing);
    }
    const provider = this.amlFactory.getConfiguredProvider();
    if (!provider.isAvailable()) {
      return this.persistUnavailable({ ...params, type: 'TRANSACTION', idempotencyKey,
        providerReference: `unavail_tx_${params.transactionId}`, safeMetadata: { jurisdiction, screeningSubject } });
    }
    const result = await provider.screenTransaction({ tenantId: params.tenantId, userId: params.userId,
      transactionId: params.transactionId, transactionType: params.transactionType, amount: params.amount, currency: params.currency,
      jurisdiction, idempotencyKey,
      counterpartyHash: params.counterparty ? hashPii(params.counterparty) : undefined,
      safeMetadata: { transactionType: params.transactionType, currency: params.currency } });
    this.validateProviderResult(result);
    if ([AmlState.MATCH, AmlState.BLOCKED].includes(result.status)) {
      await this.createRequiredCase({ tenantId: params.tenantId, userId: params.userId,
        caseType: ComplianceCaseType.TRANSACTION_REVIEW, riskLevel: result.riskLevel,
        safeSummary: `Transaction review ${result.status} for tx ${params.transactionId} amount ${params.currency} [REDACTED]`,
        ruleIds: ['TRANSACTION_AMOUNT_REVIEW', 'AML_SCREENING_REQUIRED'], sourceRefs: [{ type: 'TRANSACTION', id: params.transactionId }],
        idempotencyKey: `case_tx_${params.tenantId}_${params.transactionId}` });
    }
    const response = await this.persistResult({ ...params, type: 'TRANSACTION', idempotencyKey, result, safeMetadata: { screeningSubject } });
    return response;
  }

  async getStatus(params: { tenantId: string; userId: string; providerReference?: string }): Promise<AmlStatusResponse> {
    const request = await this.prisma.complianceScreeningRequest.findFirst({
      where: { tenantId: params.tenantId, userId: params.userId, type: { in: ['AML', 'TRANSACTION', 'AML_RESCREEN'] },
        ...(params.providerReference ? { providerRef: params.providerReference } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    if (!request) return { amlState: AmlState.NOT_SCREENED, decision: ComplianceDecision.PENDING, riskLevel: RiskLevel.UNKNOWN, safeMetadata: {} };
    const response = this.fromRequest(request);
    const metadata = complianceObject(request.safeMetadata);
    if (!metadata) throw new Error('Persisted AML metadata must be an object');
    return { amlState: response.status, decision: response.decision, riskLevel: response.riskLevel,
      provider: response.provider, providerReference: response.providerReference,
      safeMetadata: metadata, screenedAt: request.createdAt.toISOString() };
  }

  async rescreen(params: { tenantId: string; userId: string; providerReference: string; idempotencyKey?: string }): Promise<AmlScreeningResponse> {
    const idempotencyKey = params.idempotencyKey || `aml_rescreen_${params.tenantId}_${params.providerReference}_${Date.now()}`;
    const existing = await this.existingRequest(params.tenantId, params.userId, idempotencyKey, 'AML_RESCREEN');
    if (existing) {
      if (complianceObject(existing.safeMetadata)?.rescreenedReference !== params.providerReference) {
        throw new BadRequestException('AML rescreen idempotency key does not match the provider reference');
      }
      return this.fromRequest(existing);
    }
    const original = await this.prisma.complianceScreeningRequest.findFirst({
      where: { tenantId: params.tenantId, userId: params.userId, providerRef: params.providerReference,
        type: { in: ['AML', 'TRANSACTION', 'AML_RESCREEN'] } }, orderBy: { createdAt: 'desc' },
    });
    if (!original) throw new BadRequestException('AML provider reference not found for this tenant and user');
    const safeMetadata = { rescreenedReference: params.providerReference };
    const provider = this.amlFactory.getConfiguredProvider();
    if (!provider.isAvailable()) return this.persistUnavailable({ ...params, type: 'AML_RESCREEN', idempotencyKey, safeMetadata });
    if (provider.providerName !== original.provider) {
      throw new BadRequestException('AML rescreen requires the provider that issued the original reference');
    }
    const result = await provider.rescreen(params.tenantId, params.providerReference, idempotencyKey);
    return this.persistResult({ ...params, type: 'AML_RESCREEN', idempotencyKey, result, safeMetadata });
  }

  private async existingRequest(tenantId: string, userId: string, idempotencyKey: string, type: string): Promise<ComplianceScreeningRequest | null> {
    const existing = await this.prisma.complianceScreeningRequest.findFirst({ where: { tenantId, idempotencyKey } });
    if (existing && (existing.userId !== userId || existing.type !== type)) {
      throw new BadRequestException('AML idempotency key belongs to a different user or screening type');
    }
    return existing;
  }

  private async persistUnavailable(params: {
    tenantId: string; userId: string; type: string; idempotencyKey: string; providerReference: string; safeMetadata: Record<string, unknown>;
  }): Promise<AmlScreeningResponse> {
    const request = await this.prisma.complianceScreeningRequest.create({ data: {
      id: randomUUID(), tenantId: params.tenantId, userId: params.userId, type: params.type,
      provider: 'UNAVAILABLE', providerRef: params.providerReference, status: 'PENDING',
      amlState: AmlState.PROVIDER_UNAVAILABLE, decision: ComplianceDecision.PENDING, riskLevel: RiskLevel.UNKNOWN,
      idempotencyKey: params.idempotencyKey, failureReason: 'AML provider unavailable - explicit review required',
      safeMetadata: complianceJsonInput({ ...params.safeMetadata, reason: 'PROVIDER_UNAVAILABLE' }),
    } });
    return this.fromRequest(request);
  }

  private async persistResult(params: {
    tenantId: string; userId: string; type: string; idempotencyKey: string; result: AmlScreeningResult; safeMetadata?: Record<string, unknown>;
  }): Promise<AmlScreeningResponse> {
    const result = params.result;
    const metadata = this.validateProviderResult(result);
    const request = await this.prisma.complianceScreeningRequest.create({ data: {
      id: randomUUID(), tenantId: params.tenantId, userId: params.userId, type: params.type,
      provider: result.provider, providerRef: result.providerReference,
      status: result.status === AmlState.CLEAR ? 'CLEAR' : 'REVIEW', amlState: result.status,
      decision: result.decision, riskLevel: result.riskLevel, idempotencyKey: params.idempotencyKey,
      safeMetadata: complianceJsonInput(sanitizeMetadata({ ...metadata, ...params.safeMetadata })),
    } });
    return this.fromRequest(request);
  }

  private validateProviderResult(result: AmlScreeningResult): Record<string, unknown> {
    if (!Object.values(AmlState).includes(result.status) || !Object.values(ComplianceDecision).includes(result.decision)
      || !Object.values(RiskLevel).includes(result.riskLevel) || !result.provider?.trim() || !result.providerReference?.trim()
      || (result.decision === ComplianceDecision.ALLOW && result.status !== AmlState.CLEAR)) {
      throw new Error('Invalid AML provider outcome');
    }
    const metadata = complianceObject(result.safeMetadata);
    if (!metadata) throw new Error('AML provider metadata must be an object');
    return metadata;
  }

  private async createRequiredCase(input: Parameters<ComplianceCaseRepository['createCase']>[0]): Promise<void> {
    const result: unknown = await this.caseRepository.createCase(input);
    const record = complianceObject(result);
    if (!record || typeof record.id !== 'string' || !record.id || record.tenantId !== input.tenantId || record.userId !== input.userId) {
      throw new Error('AML review case persistence returned no durable tenant-bound record');
    }
  }

  private fromRequest(request: ComplianceScreeningRequest): AmlScreeningResponse {
    const status = Object.values(AmlState).find((value) => value === request.amlState) ?? AmlState.REVIEW_REQUIRED;
    const decision = Object.values(ComplianceDecision).find((value) => value === request.decision) ?? ComplianceDecision.PENDING;
    const riskLevel = Object.values(RiskLevel).find((value) => value === request.riskLevel) ?? RiskLevel.UNKNOWN;
    if (!request.provider || !request.providerRef || (decision === ComplianceDecision.ALLOW && status !== AmlState.CLEAR)) {
      throw new Error('Persisted AML provider evidence is incomplete or inconsistent');
    }
    return { provider: request.provider, providerReference: request.providerRef, status, decision, riskLevel, idempotencyKey: request.idempotencyKey };
  }
}
