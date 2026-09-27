/**
 * Production AML/Sanctions Adapter Bridge
 * Uses existing AML provider interface and selected configured provider.
 * Normalizes screening results and never fabricates CLEAR/BLOCK decisions.
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  ProviderDomain,
  ProviderName,
  ProviderCapability,
  ProviderResult,
  NormalizedAmlResult,
  ProviderErrorCode,
  RetryClassification,
  ProviderOperationType,
} from '../../provider.types';
import { ProviderRequestService } from '../../provider-request.service';
import { ProviderObservationService } from '../../provider-observation.service';

export interface AmlScreenInput {
  tenantId: string;
  userId: string;
  jurisdiction: string;
  idempotencyKey: string;
  correlationId: string;
  safeMetadata?: Record<string, unknown>;
}

@Injectable()
export class AmlProductionAdapter {
  private readonly logger = new Logger(AmlProductionAdapter.name);
  readonly provider = ProviderName.AML_GENERIC;
  readonly domain = ProviderDomain.AML;

  readonly capabilities: ProviderCapability[] = [ProviderCapability.AML_SCREEN];

  constructor(
    private readonly requestService: ProviderRequestService,
    private readonly observationService: ProviderObservationService,
  ) {}

  isAvailable(): boolean {
    return !!process.env['AML_PROVIDER_API_KEY'] && !!process.env['AML_PROVIDER_BASE_URL'];
  }

  async screenPerson(input: AmlScreenInput): Promise<ProviderResult<NormalizedAmlResult>> {
    const start = Date.now();

    if (!this.isAvailable()) {
      return {
        success: true,
        provider: this.provider,
        domain: this.domain,
        data: {
          providerReference: `aml_pending_${input.userId}_${Date.now()}`,
          status: 'PENDING',
          decision: 'REVIEW_REQUIRED',
          riskLevel: 'UNKNOWN',
          matchedLists: [],
          reasonCode: 'PROVIDER_UNAVAILABLE',
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

    const baseUrl = process.env['AML_PROVIDER_BASE_URL']!;
    const apiKey = process.env['AML_PROVIDER_API_KEY']!;

    try {
      const response = await this.requestService.requestWithRetry<any>({
        method: 'POST',
        url: `${baseUrl}/v1/screening/person`,
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: {
          userId: input.userId,
          jurisdiction: input.jurisdiction,
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

      const normalized: NormalizedAmlResult = {
        providerReference: data.id || data.reference || `aml_${Date.now()}`,
        status: this.normalizeStatus(data.status),
        decision: this.normalizeDecision(data.status, data.riskLevel),
        riskLevel: data.riskLevel || 'UNKNOWN',
        matchedLists: data.matchedLists || [],
        reasonCode: data.reasonCode || null,
        timestamp: new Date().toISOString(),
        safeMetadata: {
          tenantId: input.tenantId,
          userId: input.userId,
          providerStatus: data.status,
        },
      };

      await this.observationService.record({
        provider: this.provider,
        domain: this.domain,
        operation: ProviderOperationType.CREATE,
        correlationId: input.correlationId,
        idempotencyKey: input.idempotencyKey,
        tenantId: input.tenantId,
        userId: input.userId,
        providerReference: normalized.providerReference,
        status: normalized.status,
        safeEvidence: {
          tenantId: input.tenantId,
          status: normalized.status,
          decision: normalized.decision,
        },
      });

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
            providerReference: `aml_pending_${input.userId}_${Date.now()}`,
            status: 'PENDING',
            decision: 'REVIEW_REQUIRED',
            riskLevel: 'UNKNOWN',
            matchedLists: [],
            reasonCode: 'PROVIDER_UNAVAILABLE',
            timestamp: new Date().toISOString(),
            safeMetadata: { tenantId: input.tenantId, userId: input.userId, providerUnavailable: true },
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

  private normalizeStatus(providerStatus: string): string {
    const status = (providerStatus || '').toLowerCase();
    if (['clear', 'no_match', 'clean', 'passed'].includes(status)) return 'CLEAR';
    if (['blocked', 'match', 'hit', 'denied'].includes(status)) return 'BLOCKED';
    if (['potential_match', 'review', 'manual_review'].includes(status)) return 'REVIEW';
    if (['pending', 'processing'].includes(status)) return 'PENDING';
    return 'PENDING';
  }

  private normalizeDecision(providerStatus: string, riskLevel?: string): string {
    const status = (providerStatus || '').toLowerCase();
    if (['clear', 'no_match', 'clean', 'passed'].includes(status)) return 'ALLOW';
    if (['blocked', 'match', 'hit', 'denied'].includes(status)) return 'BLOCK';
    return 'REVIEW_REQUIRED';
  }
}
