/**
 * Production Custody/Blockchain Adapter Bridge
 * Uses existing custody provider architecture.
 * Preserves transaction hash, confirmation, finality, fee, and reorg truth from external provider.
 * Never fabricates blockchain evidence.
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  ProviderDomain,
  ProviderName,
  ProviderCapability,
  ProviderResult,
  NormalizedCustodyResult,
  ProviderErrorCode,
  RetryClassification,
  ProviderOperationType,
} from '../../provider.types';
import { ProviderPolicyService } from '../../provider-policy.service';
import { ProviderRequestService } from '../../provider-request.service';
import { ProviderObservationService } from '../../provider-observation.service';

export interface CustodyTransactionInput {
  assetId: string;
  assetSymbol: string;
  networkId: string;
  chainId?: string;
  fromAddress: string;
  toAddress: string;
  amount: string;
  fee?: string | null;
  memo?: string | null;
  walletId?: string;
  idempotencyKey: string;
  correlationId: string;
  tenantId: string;
}

export interface CustodyGetTransactionInput {
  transactionHash: string;
  networkId: string;
  assetId: string;
  correlationId: string;
  tenantId?: string;
}

@Injectable()
export class CustodyProductionAdapter {
  private readonly logger = new Logger(CustodyProductionAdapter.name);
  readonly provider = ProviderName.CUSTODY_GENERIC;
  readonly domain = ProviderDomain.CUSTODY;

  readonly capabilities: ProviderCapability[] = [
    ProviderCapability.CUSTODY_BALANCE,
    ProviderCapability.CUSTODY_TRANSACTION_READ,
    ProviderCapability.CUSTODY_TRANSACTION_SUBMIT,
    ProviderCapability.CONFIRMATION_READ,
  ];

  constructor(
    private readonly policyService: ProviderPolicyService,
    private readonly requestService: ProviderRequestService,
    private readonly observationService: ProviderObservationService,
  ) {}

  isAvailable(): boolean {
    return !!process.env['CUSTODY_PROVIDER_API_KEY'] && !!process.env['CUSTODY_PROVIDER_BASE_URL'];
  }

  async getTransaction(input: CustodyGetTransactionInput): Promise<ProviderResult<NormalizedCustodyResult>> {
    const start = Date.now();

    if (!this.isAvailable()) {
      return {
        success: false,
        provider: this.provider,
        domain: this.domain,
        error: {
          code: ProviderErrorCode.NOT_CONFIGURED,
          message: 'Custody provider not configured',
          provider: this.provider,
          domain: this.domain,
          isRetryable: false,
          retryClassification: RetryClassification.NO_RETRY,
          correlationId: input.correlationId,
          safeEvidence: { networkId: input.networkId, assetId: input.assetId },
        },
        correlationId: input.correlationId,
        timestamp: new Date().toISOString(),
        latencyMs: Date.now() - start,
      };
    }

    const baseUrl = process.env['CUSTODY_PROVIDER_BASE_URL']!;
    const apiKey = process.env['CUSTODY_PROVIDER_API_KEY']!;

    try {
      const response = await this.requestService.requestWithRetry<any>({
        method: 'GET',
        url: `${baseUrl}/v1/networks/${input.networkId}/transactions/${input.transactionHash}`,
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        correlationId: input.correlationId,
        domain: this.domain,
        provider: this.provider,
        operation: ProviderOperationType.READ,
        tenantId: input.tenantId,
        isIdempotent: true,
      });

      const data = response.data;

      const normalized: NormalizedCustodyResult = {
        transactionHash: data.hash || data.transactionHash || input.transactionHash,
        providerReference: data.id || data.providerReference || input.transactionHash,
        networkId: data.networkId || input.networkId,
        assetId: data.assetId || input.assetId,
        assetSymbol: data.assetSymbol || data.symbol || 'UNKNOWN',
        amount: data.amount?.toString() || '0',
        fee: data.fee?.toString() || data.actualFee?.toString() || null,
        confirmationCount: data.confirmations || data.confirmationCount || 0,
        requiredConfirmations: data.requiredConfirmations || 6,
        blockNumber: data.blockNumber?.toString() || null,
        blockHash: data.blockHash || null,
        status: this.normalizeStatus(data.status, data.confirmations),
        isFinal: data.isFinal || (data.confirmations || 0) >= (data.requiredConfirmations || 6),
        isReorg: data.isReorg || data.status === 'REORGED' || false,
        timestamp: data.timestamp || new Date().toISOString(),
        safeMetadata: {
          networkId: input.networkId,
          assetId: input.assetId,
          confirmations: data.confirmations,
          blockNumber: data.blockNumber,
          correlationId: input.correlationId,
        },
      };

      await this.observationService.record({
        provider: this.provider,
        domain: this.domain,
        operation: ProviderOperationType.READ,
        correlationId: input.correlationId,
        idempotencyKey: `get_${input.transactionHash}`,
        tenantId: input.tenantId,
        providerReference: normalized.transactionHash,
        status: normalized.status,
        safeEvidence: {
          networkId: input.networkId,
          assetId: input.assetId,
          confirmationCount: normalized.confirmationCount,
          blockNumber: normalized.blockNumber,
          isFinal: normalized.isFinal,
          isReorg: normalized.isReorg,
        },
      });

      return {
        success: true,
        provider: this.provider,
        domain: this.domain,
        data: normalized,
        correlationId: input.correlationId,
        providerReference: normalized.transactionHash,
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

  async submitTransaction(input: CustodyTransactionInput): Promise<ProviderResult<NormalizedCustodyResult>> {
    const start = Date.now();

    if (!this.isAvailable()) {
      return {
        success: false,
        provider: this.provider,
        domain: this.domain,
        error: {
          code: ProviderErrorCode.NOT_CONFIGURED,
          message: 'Custody provider not configured',
          provider: this.provider,
          domain: this.domain,
          isRetryable: false,
          retryClassification: RetryClassification.NO_RETRY,
          correlationId: input.correlationId,
          safeEvidence: { networkId: input.networkId, assetId: input.assetId },
        },
        correlationId: input.correlationId,
        timestamp: new Date().toISOString(),
        latencyMs: Date.now() - start,
      };
    }

    const baseUrl = process.env['CUSTODY_PROVIDER_BASE_URL']!;
    const apiKey = process.env['CUSTODY_PROVIDER_API_KEY']!;

    try {
      const response = await this.requestService.request<any>({
        method: 'POST',
        url: `${baseUrl}/v1/networks/${input.networkId}/transactions`,
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: {
          assetId: input.assetId,
          assetSymbol: input.assetSymbol,
          networkId: input.networkId,
          fromAddress: input.fromAddress,
          toAddress: input.toAddress,
          amount: input.amount,
          fee: input.fee,
          memo: input.memo,
          walletId: input.walletId,
          idempotencyKey: input.idempotencyKey,
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

      const normalized: NormalizedCustodyResult = {
        transactionHash: data.hash || data.transactionHash || null,
        providerReference: data.id || data.providerReference || data.hash || input.idempotencyKey,
        networkId: input.networkId,
        assetId: input.assetId,
        assetSymbol: input.assetSymbol,
        amount: input.amount,
        fee: data.estimatedFee?.toString() || input.fee || null,
        confirmationCount: 0,
        requiredConfirmations: data.requiredConfirmations || 6,
        blockNumber: null,
        blockHash: null,
        status: 'SUBMITTED',
        isFinal: false,
        isReorg: false,
        timestamp: new Date().toISOString(),
        safeMetadata: {
          networkId: input.networkId,
          assetId: input.assetId,
          assetSymbol: input.assetSymbol,
          correlationId: input.correlationId,
          idempotencyKey: input.idempotencyKey,
        },
      };

      await this.observationService.record({
        provider: this.provider,
        domain: this.domain,
        operation: ProviderOperationType.CREATE,
        correlationId: input.correlationId,
        idempotencyKey: input.idempotencyKey,
        tenantId: input.tenantId,
        providerReference: normalized.transactionHash || normalized.providerReference,
        status: normalized.status,
        safeEvidence: {
          networkId: input.networkId,
          assetId: input.assetId,
          assetSymbol: input.assetSymbol,
          amount: input.amount,
        },
      });

      return {
        success: true,
        provider: this.provider,
        domain: this.domain,
        data: normalized,
        correlationId: input.correlationId,
        providerReference: normalized.transactionHash || normalized.providerReference,
        timestamp: new Date().toISOString(),
        latencyMs: response.latencyMs,
        rawStatus: 'SUBMITTED',
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

  private normalizeStatus(providerStatus: string, confirmations?: number): string {
    const status = (providerStatus || '').toUpperCase();
    if (['CONFIRMED', 'FINALIZED', 'SUCCESS', 'COMPLETED'].includes(status)) {
      if (confirmations !== undefined && confirmations === 0) return 'SUBMITTED';
      return 'CONFIRMED';
    }
    if (['PENDING', 'SUBMITTED', 'QUEUED', 'BROADCASTED'].includes(status)) return 'SUBMITTED';
    if (['CONFIRMING', 'INCLUDED'].includes(status)) return 'CONFIRMING';
    if (['FAILED', 'REJECTED', 'DROPPED'].includes(status)) return 'FAILED';
    if (['REORGED', 'REORG', 'ORPHANED'].includes(status)) return 'REORGED';
    return 'SUBMITTED';
  }
}
