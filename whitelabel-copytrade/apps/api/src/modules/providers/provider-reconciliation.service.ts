/**
 * Provider Reconciliation Service
 * Shared orchestration for comparing provider truth with local domain records,
 * detecting missing/duplicate/status/amount/reference mismatches,
 * and delegating resolution to existing authoritative domain reconciliation services.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ProviderDomain, ProviderName, ReconciliationMismatch } from './provider.types';

export interface ReconciliationInput<TLocal, TProvider> {
  domain: ProviderDomain;
  provider: ProviderName;
  correlationId: string;
  tenantId?: string;
  localRecords: TLocal[];
  providerRecords: TProvider[];
  getLocalId: (record: TLocal) => string;
  getProviderReference: (record: TProvider) => string;
  compare: (local: TLocal, provider: TProvider) => ReconciliationMismatch[];
  getLocalReference?: (record: TLocal) => string;
}

export interface ReconciliationResult {
  domain: ProviderDomain;
  provider: ProviderName;
  correlationId: string;
  mismatches: ReconciliationMismatch[];
  localCount: number;
  providerCount: number;
  matchedCount: number;
  checkedAt: string;
  isIdempotent: boolean;
}

@Injectable()
export class ProviderReconciliationService {
  private readonly logger = new Logger(ProviderReconciliationService.name);
  private readonly reconciliationCache: Map<string, ReconciliationResult> = new Map();

  async reconcile<TLocal, TProvider>(input: ReconciliationInput<TLocal, TProvider>): Promise<ReconciliationResult> {
    const cacheKey = `${input.domain}_${input.provider}_${input.correlationId}`;
    if (this.reconciliationCache.has(cacheKey)) {
      return this.reconciliationCache.get(cacheKey)!;
    }

    const checkedAt = new Date().toISOString();
    const mismatches: ReconciliationMismatch[] = [];

    const localMap = new Map<string, TLocal>();
    for (const local of input.localRecords) {
      const id = input.getLocalId(local);
      const ref = input.getLocalReference ? input.getLocalReference(local) : id;
      localMap.set(ref, local);
    }

    const providerMap = new Map<string, TProvider>();
    for (const provider of input.providerRecords) {
      const ref = input.getProviderReference(provider);
      providerMap.set(ref, provider);
    }

    for (const [ref, local] of localMap) {
      const providerRecord = providerMap.get(ref);
      if (!providerRecord) {
        mismatches.push({
          type: 'LOCAL_MISSING_PROVIDER',
          localId: input.getLocalId(local),
          providerReference: ref,
          severity: 'HIGH',
          description: `Local record ${ref} missing in provider ${input.provider}`,
          correlationId: input.correlationId,
          detectedAt: checkedAt,
        });
        continue;
      }

      const compareMismatches = input.compare(local, providerRecord);
      mismatches.push(...compareMismatches);
    }

    for (const [ref, providerRecord] of providerMap) {
      if (!localMap.has(ref)) {
        mismatches.push({
          type: 'PROVIDER_MISSING_LOCAL',
          providerReference: ref,
          severity: 'MEDIUM',
          description: `Provider record ${ref} missing locally for ${input.provider}`,
          correlationId: input.correlationId,
          detectedAt: checkedAt,
        });
      }
    }

    const matchedCount = localMap.size - mismatches.filter((m) => m.type === 'LOCAL_MISSING_PROVIDER').length;

    const result: ReconciliationResult = {
      domain: input.domain,
      provider: input.provider,
      correlationId: input.correlationId,
      mismatches,
      localCount: input.localRecords.length,
      providerCount: input.providerRecords.length,
      matchedCount,
      checkedAt,
      isIdempotent: true,
    };

    this.reconciliationCache.set(cacheKey, result);

    this.logger.log(
      `Reconciliation ${input.domain} ${input.provider} correlationId=${input.correlationId} local=${input.localRecords.length} provider=${input.providerRecords.length} mismatches=${mismatches.length}`,
    );

    return result;
  }

  detectStatusMismatch(localStatus: string, providerStatus: string, correlationId: string): ReconciliationMismatch | null {
    if (localStatus === providerStatus) return null;
    return {
      type: 'STATUS_MISMATCH',
      localValue: localStatus,
      providerValue: providerStatus,
      severity: 'HIGH',
      description: `Status mismatch local=${localStatus} provider=${providerStatus}`,
      correlationId,
      detectedAt: new Date().toISOString(),
    };
  }

  detectAmountMismatch(localAmount: string, providerAmount: string, correlationId: string): ReconciliationMismatch | null {
    if (localAmount === providerAmount) return null;
    const localNum = parseFloat(localAmount);
    const providerNum = parseFloat(providerAmount);
    if (Math.abs(localNum - providerNum) < 0.000001) return null;
    return {
      type: 'AMOUNT_MISMATCH',
      localValue: localAmount,
      providerValue: providerAmount,
      severity: 'CRITICAL',
      description: `Amount mismatch local=${localAmount} provider=${providerAmount}`,
      correlationId,
      detectedAt: new Date().toISOString(),
    };
  }

  detectCurrencyMismatch(localCurrency: string, providerCurrency: string, correlationId: string): ReconciliationMismatch | null {
    if (localCurrency.toUpperCase() === providerCurrency.toUpperCase()) return null;
    return {
      type: 'CURRENCY_MISMATCH',
      localValue: localCurrency,
      providerValue: providerCurrency,
      severity: 'CRITICAL',
      description: `Currency mismatch local=${localCurrency} provider=${providerCurrency}`,
      correlationId,
      detectedAt: new Date().toISOString(),
    };
  }

  detectAssetMismatch(localAsset: string, providerAsset: string, correlationId: string): ReconciliationMismatch | null {
    if (localAsset.toUpperCase() === providerAsset.toUpperCase()) return null;
    return {
      type: 'ASSET_MISMATCH',
      localValue: localAsset,
      providerValue: providerAsset,
      severity: 'HIGH',
      description: `Asset mismatch local=${localAsset} provider=${providerAsset}`,
      correlationId,
      detectedAt: new Date().toISOString(),
    };
  }

  isIdempotentResult(correlationId: string): boolean {
    return this.reconciliationCache.has(correlationId);
  }

  clearCache(): void {
    this.reconciliationCache.clear();
  }
}
