/**
 * Provider Observation Service
 * Persists safe provider observations and normalized evidence for payment,
 * exchange, KYC, AML, payout, custody, and notification operations
 * without storing sensitive raw payloads.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ProviderDomain, ProviderName, ProviderOperationType, ProviderObservation } from './provider.types';
import * as crypto from 'crypto';

export interface ObservationInput {
  provider: ProviderName;
  domain: ProviderDomain;
  operation: ProviderOperationType;
  correlationId: string;
  idempotencyKey: string;
  tenantId?: string;
  userId?: string;
  accountId?: string;
  providerReference?: string | null;
  status: string;
  latencyMs?: number;
  safeEvidence?: Record<string, unknown>;
}

@Injectable()
export class ProviderObservationService {
  private readonly logger = new Logger(ProviderObservationService.name);
  private readonly observations: Map<string, ProviderObservation> = new Map();

  async record(input: ObservationInput): Promise<ProviderObservation> {
    const observationId = this.generateObservationId(input.correlationId, input.provider, input.operation);
    const createdAt = new Date().toISOString();

    const safeEvidence = this.redactEvidence(input.safeEvidence || {});

    const observation: ProviderObservation = {
      observationId,
      provider: input.provider,
      domain: input.domain,
      operation: input.operation,
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey,
      tenantId: input.tenantId,
      providerReference: input.providerReference || null,
      status: input.status,
      latencyMs: input.latencyMs || 0,
      safeEvidence,
      createdAt,
    };

    this.observations.set(observationId, observation);

    this.logger.log(
      `Provider observation: ${input.provider} ${input.domain} ${input.operation} ${input.status} correlationId=${input.correlationId} ref=${input.providerReference || 'none'}`,
    );

    return observation;
  }

  async recordPaymentObservation(
    provider: ProviderName,
    correlationId: string,
    idempotencyKey: string,
    providerReference: string | null,
    status: string,
    safeEvidence: Record<string, unknown>,
    tenantId?: string,
  ): Promise<ProviderObservation> {
    return this.record({
      provider,
      domain: ProviderDomain.PAYMENT,
      operation: ProviderOperationType.CREATE,
      correlationId,
      idempotencyKey,
      tenantId,
      providerReference,
      status,
      safeEvidence,
    });
  }

  async recordExchangeObservation(
    provider: ProviderName,
    operation: ProviderOperationType,
    correlationId: string,
    idempotencyKey: string,
    providerReference: string | null,
    status: string,
    safeEvidence: Record<string, unknown>,
    tenantId?: string,
    accountId?: string,
  ): Promise<ProviderObservation> {
    return this.record({
      provider,
      domain: ProviderDomain.EXCHANGE,
      operation,
      correlationId,
      idempotencyKey,
      tenantId,
      accountId,
      providerReference,
      status,
      safeEvidence,
    });
  }

  async recordKycObservation(
    provider: ProviderName,
    correlationId: string,
    idempotencyKey: string,
    providerReference: string | null,
    status: string,
    safeEvidence: Record<string, unknown>,
    tenantId?: string,
    userId?: string,
  ): Promise<ProviderObservation> {
    return this.record({
      provider,
      domain: ProviderDomain.KYC,
      operation: ProviderOperationType.CREATE,
      correlationId,
      idempotencyKey,
      tenantId,
      userId,
      providerReference,
      status,
      safeEvidence,
    });
  }

  getObservation(observationId: string): ProviderObservation | null {
    return this.observations.get(observationId) || null;
  }

  getObservationsByCorrelationId(correlationId: string): ProviderObservation[] {
    return Array.from(this.observations.values()).filter((o) => o.correlationId === correlationId);
  }

  getObservationsByProvider(provider: ProviderName): ProviderObservation[] {
    return Array.from(this.observations.values()).filter((o) => o.provider === provider);
  }

  private generateObservationId(correlationId: string, provider: ProviderName, operation: ProviderOperationType): string {
    const hash = crypto
      .createHash('sha256')
      .update(`${correlationId}_${provider}_${operation}_${Date.now()}`)
      .digest('hex')
      .slice(0, 12);
    return `obs_${provider}_${operation.toLowerCase()}_${hash}`;
  }

  private redactEvidence(evidence: Record<string, unknown>): Record<string, unknown> {
    const forbiddenKeys = [
      'password',
      'secret',
      'privateKey',
      'private_key',
      'apiKey',
      'api_key',
      'apiSecret',
      'api_secret',
      'token',
      'jwt',
      'credential',
      'authorization',
      'auth',
      'card',
      'card_number',
      'cvv',
      'ssn',
      'document',
      'passport',
      'id_number',
      'email',
      'phone',
      'address',
      'private',
    ];

    const redacted: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(evidence)) {
      const isForbidden = forbiddenKeys.some((fk) => key.toLowerCase().includes(fk.toLowerCase()));

      if (isForbidden) {
        redacted[key] = '***REDACTED***';
      } else if (typeof value === 'string') {
        if (value.includes('sk_') || value.includes('pk_') || value.includes('Bearer ') || value.length > 1000) {
          redacted[key] = '***REDACTED***';
        } else if (value.includes('postgres://') || value.includes('postgresql://') || value.includes('redis://')) {
          redacted[key] = '***REDACTED_URL***';
        } else {
          redacted[key] = value.slice(0, 500);
        }
      } else if (Array.isArray(value)) {
        redacted[key] = value.slice(0, 10).map((v) => (typeof v === 'object' ? this.redactEvidence(v as any) : v));
      } else if (typeof value === 'object' && value !== null) {
        redacted[key] = this.redactEvidence(value as Record<string, unknown>);
      } else {
        redacted[key] = value;
      }
    }

    return redacted;
  }

  clear(): void {
    this.observations.clear();
  }
}
