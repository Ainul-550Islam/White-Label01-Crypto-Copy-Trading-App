/**
 * Production Payout Adapter Bridge
 * Uses existing payout-provider interface.
 * Preserves submitted/processing/completed/failed/reversed semantics from real provider.
 * Payout is only COMPLETED after real provider confirmation.
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  ProviderDomain,
  ProviderName,
  ProviderCapability,
  ProviderResult,
  NormalizedPayoutResult,
  ProviderErrorCode,
  RetryClassification,
  ProviderOperationType,
} from '../../provider.types';
import { ProviderPolicyService } from '../../provider-policy.service';
import { ProviderRequestService } from '../../provider-request.service';
import { ProviderObservationService } from '../../provider-observation.service';

export interface PayoutCreateInput {
  payoutId: string;
  amount: string;
  currency: string;
  destination: string;
  tenantId: string;
  userId?: string;
  idempotencyKey: string;
  correlationId: string;
  safeMetadata?: Record<string, unknown>;
}

@Injectable()
export class PayoutProductionAdapter {
  private readonly logger = new Logger(PayoutProductionAdapter.name);
  readonly provider = ProviderName.PAYOUT_GENERIC;
  readonly domain = ProviderDomain.PAYOUT;

  readonly capabilities: ProviderCapability[] = [ProviderCapability.PAYOUT_CREATE, ProviderCapability.PAYOUT_STATUS];

  constructor(
    private readonly policyService: ProviderPolicyService,
    private readonly requestService: ProviderRequestService,
    private readonly observationService: ProviderObservationService,
  ) {}

  isAvailable(): boolean {
    return !!process.env['PAYOUT_PROVIDER_API_KEY'] && !!process.env['PAYOUT_PROVIDER_BASE_URL'];
  }

  async createPayout(input: PayoutCreateInput): Promise<ProviderResult<NormalizedPayoutResult>> {
    const start = Date.now();

    if (!this.isAvailable()) {
      return {
        success: false,
        provider: this.provider,
        domain: this.domain,
        error: {
          code: ProviderErrorCode.NOT_CONFIGURED,
          message: 'Payout provider not configured',
          provider: this.provider,
          domain: this.domain,
          isRetryable: false,
          retryClassification: RetryClassification.NO_RETRY,
          correlationId: input.correlationId,
          safeEvidence: {},
        },
        correlationId: input.correlationId,
        timestamp: new Date().toISOString(),
        latencyMs: Date.now() - start,
      };
    }

    const baseUrl = process.env['PAYOUT_PROVIDER_BASE_URL']!;
    const apiKey = process.env['PAYOUT_PROVIDER_API_KEY']!;

    try {
      const response = await this.requestService.request<any>({
        method: 'POST',
        url: `${baseUrl}/v1/payouts`,
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: {
          amount: input.amount,
          currency: input.currency,
          destination: input.destination,
          payoutId: input.payoutId,
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

      const normalized: NormalizedPayoutResult = {
        providerPayoutId: data.id || data.payoutId || input.payoutId,
        status: this.normalizeStatus(data.status),
        amount: data.amount?.toString() || input.amount,
        currency: (data.currency || input.currency).toUpperCase(),
        destination: data.destination || input.destination,
        fee: data.fee?.toString() || null,
        createdAt: data.createdAt || new Date().toISOString(),
        completedAt: data.completedAt || null,
        safeMetadata: {
          tenantId: input.tenantId,
          payoutId: input.payoutId,
          correlationId: input.correlationId,
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
        providerReference: normalized.providerPayoutId,
        status: normalized.status,
        safeEvidence: {
          amount: input.amount,
          currency: input.currency,
          status: normalized.status,
          providerStatus: data.status,
        },
      });

      return {
        success: true,
        provider: this.provider,
        domain: this.domain,
        data: normalized,
        correlationId: input.correlationId,
        providerReference: normalized.providerPayoutId,
        timestamp: new Date().toISOString(),
        latencyMs: response.latencyMs,
        rawStatus: data.status,
      };
    } catch (error) {
      const err = (error as any).code ? error : this.requestService.normalizeError(error as Error, this.provider, this.domain, input.correlationId);
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

  async getPayoutStatus(providerPayoutId: string, correlationId: string, tenantId?: string): Promise<ProviderResult<NormalizedPayoutResult>> {
    const start = Date.now();

    if (!this.isAvailable()) {
      return {
        success: false,
        provider: this.provider,
        domain: this.domain,
        error: {
          code: ProviderErrorCode.NOT_CONFIGURED,
          message: 'Payout provider not configured',
          provider: this.provider,
          domain: this.domain,
          isRetryable: false,
          retryClassification: RetryClassification.NO_RETRY,
          correlationId,
          safeEvidence: {},
        },
        correlationId,
        timestamp: new Date().toISOString(),
        latencyMs: Date.now() - start,
      };
    }

    const baseUrl = process.env['PAYOUT_PROVIDER_BASE_URL']!;
    const apiKey = process.env['PAYOUT_PROVIDER_API_KEY']!;

    try {
      const response = await this.requestService.request<any>({
        method: 'GET',
        url: `${baseUrl}/v1/payouts/${providerPayoutId}`,
        headers: { 'Authorization': `Bearer ${apiKey}` },
        correlationId,
        domain: this.domain,
        provider: this.provider,
        operation: ProviderOperationType.READ,
        tenantId,
        isIdempotent: true,
      });

      const data = response.data;

      const normalized: NormalizedPayoutResult = {
        providerPayoutId,
        status: this.normalizeStatus(data.status),
        amount: data.amount?.toString() || '0',
        currency: (data.currency || 'USD').toUpperCase(),
        destination: data.destination || null,
        fee: data.fee?.toString() || null,
        createdAt: data.createdAt || new Date().toISOString(),
        completedAt: data.completedAt || null,
        safeMetadata: { correlationId, providerStatus: data.status },
      };

      return {
        success: true,
        provider: this.provider,
        domain: this.domain,
        data: normalized,
        correlationId,
        providerReference: providerPayoutId,
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
    if (['completed', 'succeeded', 'paid', 'success'].includes(status)) return 'COMPLETED';
    if (['processing', 'in_progress', 'pending', 'submitted'].includes(status)) return 'PROCESSING';
    if (['failed', 'declined', 'error'].includes(status)) return 'FAILED';
    if (['reversed', 'refunded', 'returned'].includes(status)) return 'REVERSED';
    if (['requested', 'created', 'initialized'].includes(status)) return 'REQUESTED';
    if (['approved'].includes(status)) return 'APPROVED';
    return 'PROCESSING';
  }
}
