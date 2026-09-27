/**
 * Production KYC Adapter Bridge
 * Uses existing KYC provider interface and selected configured real provider.
 * Normalizes submitted/pending/approved/rejected/review states without inventing verification.
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  ProviderDomain,
  ProviderName,
  ProviderCapability,
  ProviderResult,
  NormalizedKycResult,
  ProviderErrorCode,
  RetryClassification,
  ProviderOperationType,
} from '../../provider.types';
import { ProviderPolicyService } from '../../provider-policy.service';
import { ProviderRequestService } from '../../provider-request.service';
import { ProviderObservationService } from '../../provider-observation.service';

export interface KycSubmitInput {
  tenantId: string;
  userId: string;
  jurisdiction: string;
  idempotencyKey: string;
  correlationId: string;
  levelName?: string;
  safeMetadata?: Record<string, unknown>;
}

@Injectable()
export class KycProductionAdapter {
  private readonly logger = new Logger(KycProductionAdapter.name);
  readonly provider = ProviderName.KYC_GENERIC;
  readonly domain = ProviderDomain.KYC;

  readonly capabilities: ProviderCapability[] = [ProviderCapability.KYC_SUBMIT, ProviderCapability.KYC_STATUS];

  constructor(
    private readonly policyService: ProviderPolicyService,
    private readonly requestService: ProviderRequestService,
    private readonly observationService: ProviderObservationService,
  ) {}

  isAvailable(): boolean {
    return !!process.env['KYC_PROVIDER_API_KEY'] && !!process.env['KYC_PROVIDER_BASE_URL'];
  }

  async submitVerification(input: KycSubmitInput): Promise<ProviderResult<NormalizedKycResult>> {
    const start = Date.now();

    if (!this.isAvailable()) {
      return {
        success: true,
        provider: this.provider,
        domain: this.domain,
        data: {
          providerReference: `pending_${input.userId}_${Date.now()}`,
          status: 'PENDING',
          decision: 'REVIEW_REQUIRED',
          reasonCode: 'PROVIDER_UNAVAILABLE',
          riskLevel: 'UNKNOWN',
          timestamp: new Date().toISOString(),
          safeMetadata: {
            tenantId: input.tenantId,
            userId: input.userId,
            jurisdiction: input.jurisdiction,
            providerUnavailable: true,
          },
        },
        correlationId: input.correlationId,
        timestamp: new Date().toISOString(),
        latencyMs: Date.now() - start,
      };
    }

    const baseUrl = process.env['KYC_PROVIDER_BASE_URL']!;
    const apiKey = process.env['KYC_PROVIDER_API_KEY']!;

    try {
      const response = await this.requestService.requestWithRetry<any>({
        method: 'POST',
        url: `${baseUrl}/v1/verifications`,
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: {
          userId: input.userId,
          jurisdiction: input.jurisdiction,
          levelName: input.levelName || 'basic',
          idempotencyKey: input.idempotencyKey,
          metadata: input.safeMetadata || {},
        },
        correlationId: input.correlationId,
        domain: this.domain,
        provider: this.provider,
        operation: ProviderOperationType.CREATE,
        tenantId: input.tenantId,
        isIdempotent: true,
        idempotencyKey: input.idempotencyKey,
      });

      const data = response.data;

      const normalized: NormalizedKycResult = {
        providerReference: data.id || data.reference || data.sessionId || `kyc_${Date.now()}`,
        status: this.normalizeStatus(data.status),
        decision: this.normalizeDecision(data.status),
        reasonCode: data.reasonCode || data.reason || null,
        riskLevel: data.riskLevel || 'UNKNOWN',
        timestamp: new Date().toISOString(),
        safeMetadata: {
          tenantId: input.tenantId,
          userId: input.userId,
          jurisdiction: input.jurisdiction,
          providerStatus: data.status,
        },
      };

      await this.observationService.recordKycObservation(
        this.provider,
        input.correlationId,
        input.idempotencyKey,
        normalized.providerReference,
        normalized.status,
        { tenantId: input.tenantId, status: normalized.status, decision: normalized.decision },
        input.tenantId,
        input.userId,
      );

      return {
        success: true,
        provider: this.provider,
        domain: this.domain,
        data: normalized,
        correlationId: input.correlationId,
        providerReference: normalized.providerReference,
        timestamp: new Date().toISOString(),
        latencyMs: response.latencyMs,
        rawStatus: data.status,
      };
    } catch (error) {
      const normalizedErr = error as any;
      const err = normalizedErr.code ? normalizedErr : this.requestService.normalizeError(error as Error, this.provider, this.domain, input.correlationId);

      if (err.code === ProviderErrorCode.PROVIDER_UNAVAILABLE || err.code === ProviderErrorCode.NOT_CONFIGURED) {
        return {
          success: true,
          provider: this.provider,
          domain: this.domain,
          data: {
            providerReference: `pending_${input.userId}_${Date.now()}`,
            status: 'PENDING',
            decision: 'REVIEW_REQUIRED',
            reasonCode: 'PROVIDER_UNAVAILABLE',
            riskLevel: 'UNKNOWN',
            timestamp: new Date().toISOString(),
            safeMetadata: {
              tenantId: input.tenantId,
              userId: input.userId,
              providerUnavailable: true,
            },
          },
          correlationId: input.correlationId,
          timestamp: new Date().toISOString(),
          latencyMs: Date.now() - start,
        };
      }

      return {
        success: false,
        provider: this.provider,
        domain: this.domain,
        error: err as any,
        correlationId: input.correlationId,
        timestamp: new Date().toISOString(),
        latencyMs: Date.now() - start,
      };
    }
  }

  async getStatus(providerReference: string, correlationId: string, tenantId: string, userId: string): Promise<ProviderResult<NormalizedKycResult>> {
    const start = Date.now();

    if (!this.isAvailable()) {
      return {
        success: true,
        provider: this.provider,
        domain: this.domain,
        data: {
          providerReference,
          status: 'PENDING',
          decision: 'REVIEW_REQUIRED',
          reasonCode: 'PROVIDER_UNAVAILABLE',
          riskLevel: 'UNKNOWN',
          timestamp: new Date().toISOString(),
          safeMetadata: { tenantId, userId, providerUnavailable: true },
        },
        correlationId,
        timestamp: new Date().toISOString(),
        latencyMs: Date.now() - start,
      };
    }

    const baseUrl = process.env['KYC_PROVIDER_BASE_URL']!;
    const apiKey = process.env['KYC_PROVIDER_API_KEY']!;

    try {
      const response = await this.requestService.request<any>({
        method: 'GET',
        url: `${baseUrl}/v1/verifications/${providerReference}`,
        headers: { 'Authorization': `Bearer ${apiKey}` },
        correlationId,
        domain: this.domain,
        provider: this.provider,
        operation: ProviderOperationType.READ,
        tenantId,
        isIdempotent: true,
      });

      const data = response.data;

      const normalized: NormalizedKycResult = {
        providerReference,
        status: this.normalizeStatus(data.status),
        decision: this.normalizeDecision(data.status),
        reasonCode: data.reasonCode || null,
        riskLevel: data.riskLevel || 'UNKNOWN',
        timestamp: new Date().toISOString(),
        safeMetadata: { tenantId, userId, providerStatus: data.status },
      };

      return {
        success: true,
        provider: this.provider,
        domain: this.domain,
        data: normalized,
        correlationId,
        providerReference,
        timestamp: new Date().toISOString(),
        latencyMs: response.latencyMs,
        rawStatus: data.status,
      };
    } catch (error) {
      const err = (error as any).code ? error : this.requestService.normalizeError(error as Error, this.provider, this.domain, correlationId);
      return {
        success: false,
        provider: this.provider,
        domain: this.domain,
        error: err as any,
        correlationId,
        timestamp: new Date().toISOString(),
        latencyMs: Date.now() - start,
      };
    }
  }

  private normalizeStatus(providerStatus: string): string {
    const status = (providerStatus || '').toLowerCase();
    if (['approved', 'verified', 'completed', 'success'].includes(status)) return 'APPROVED';
    if (['rejected', 'declined', 'failed'].includes(status)) return 'REJECTED';
    if (['pending', 'in_progress', 'processing', 'submitted'].includes(status)) return 'PENDING';
    if (['review', 'manual_review', 'requires_review'].includes(status)) return 'REVIEW';
    return 'PENDING';
  }

  private normalizeDecision(providerStatus: string): string {
    const status = (providerStatus || '').toLowerCase();
    if (['approved', 'verified', 'completed', 'success'].includes(status)) return 'ALLOW';
    if (['rejected', 'declined'].includes(status)) return 'BLOCK';
    return 'REVIEW_REQUIRED';
  }
}
