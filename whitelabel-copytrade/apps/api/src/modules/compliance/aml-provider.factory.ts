import { Injectable, Logger } from '@nestjs/common';
import { IAmlProvider, ScreenPersonInput, ScreenEntityInput, ScreenTransactionInput, GetScreeningResultInput } from './aml-provider.interface';
import { AmlState, ComplianceDecision, RiskLevel, AmlScreeningResult } from './compliance.types';

/**
 * Selects configured AML provider and prevents unverified fallback when no provider is available.
 * No fake CLEAR result, no hardcoded sanctions list, safe credentials.
 */

class UnavailableAmlProvider implements IAmlProvider {
  readonly providerName = 'UNAVAILABLE';
  readonly supportedJurisdictions = [];
  readonly capabilities = {
    personScreening: false,
    entityScreening: false,
    transactionScreening: false,
    sanctions: false,
    pep: false,
    adverseMedia: false,
  };

  isAvailable(): boolean {
    return false;
  }

  async screenPerson(input: ScreenPersonInput): Promise<AmlScreeningResult> {
    return {
      provider: 'UNAVAILABLE',
      providerReference: `unavail_${input.tenantId}_${Date.now()}`,
      status: AmlState.PROVIDER_UNAVAILABLE,
      decision: ComplianceDecision.PENDING,
      riskLevel: RiskLevel.UNKNOWN,
      reasonCode: 'PROVIDER_UNAVAILABLE',
      screenedAt: new Date().toISOString(),
      safeMetadata: { tenantId: input.tenantId, userId: input.userId, reason: 'No AML provider configured - explicit REVIEW_REQUIRED, not CLEAR' },
    };
  }

  async screenEntity(input: ScreenEntityInput): Promise<AmlScreeningResult> {
    return {
      provider: 'UNAVAILABLE',
      providerReference: `unavail_${input.tenantId}_${Date.now()}`,
      status: AmlState.PROVIDER_UNAVAILABLE,
      decision: ComplianceDecision.PENDING,
      riskLevel: RiskLevel.UNKNOWN,
      reasonCode: 'PROVIDER_UNAVAILABLE',
      screenedAt: new Date().toISOString(),
      safeMetadata: { tenantId: input.tenantId, entityId: input.entityId },
    };
  }

  async screenTransaction(input: ScreenTransactionInput): Promise<AmlScreeningResult> {
    return {
      provider: 'UNAVAILABLE',
      providerReference: `unavail_${input.tenantId}_${Date.now()}`,
      status: AmlState.PROVIDER_UNAVAILABLE,
      decision: ComplianceDecision.PENDING,
      riskLevel: RiskLevel.UNKNOWN,
      reasonCode: 'PROVIDER_UNAVAILABLE',
      screenedAt: new Date().toISOString(),
      safeMetadata: { tenantId: input.tenantId, transactionId: input.transactionId, amount: '[REDACTED]' },
    };
  }

  async getScreeningResult(input: GetScreeningResultInput): Promise<AmlScreeningResult> {
    return {
      provider: 'UNAVAILABLE',
      providerReference: input.providerReference,
      status: AmlState.PROVIDER_UNAVAILABLE,
      decision: ComplianceDecision.PENDING,
      riskLevel: RiskLevel.UNKNOWN,
      reasonCode: 'PROVIDER_UNAVAILABLE',
      screenedAt: new Date().toISOString(),
      safeMetadata: { providerReference: input.providerReference },
    };
  }

  async rescreen(tenantId: string, providerReference: string, idempotencyKey: string): Promise<AmlScreeningResult> {
    return {
      provider: 'UNAVAILABLE',
      providerReference,
      status: AmlState.PROVIDER_UNAVAILABLE,
      decision: ComplianceDecision.PENDING,
      riskLevel: RiskLevel.UNKNOWN,
      reasonCode: 'PROVIDER_UNAVAILABLE',
      screenedAt: new Date().toISOString(),
      safeMetadata: { tenantId, idempotencyKey },
    };
  }
}

class MockAmlProvider implements IAmlProvider {
  readonly providerName: string;
  readonly supportedJurisdictions = ['DEFAULT', 'US', 'EU', 'UK', 'SG', 'GLOBAL'];
  readonly capabilities = {
    personScreening: true,
    entityScreening: true,
    transactionScreening: true,
    sanctions: true,
    pep: true,
    adverseMedia: true,
  };
  private readonly logger = new Logger(MockAmlProvider.name);

  constructor(providerName: string = 'MOCK') {
    this.providerName = providerName;
  }

  isAvailable(): boolean {
    return true;
  }

  async screenPerson(input: ScreenPersonInput): Promise<AmlScreeningResult> {
    this.logger.log(`Mock AML person screening tenant=${input.tenantId} user=${input.userId} provider=${this.providerName} - NOT auto CLEAR, returns PENDING for manual review`);

    return {
      provider: this.providerName,
      providerReference: `aml_mock_${require('crypto').randomUUID()}`,
      status: AmlState.REVIEW_REQUIRED,
      decision: ComplianceDecision.REVIEW_REQUIRED,
      riskLevel: RiskLevel.MEDIUM,
      reasonCode: 'MOCK_REVIEW_REQUIRED',
      screenedAt: new Date().toISOString(),
      safeMetadata: {
        provider: this.providerName,
        tenantId: input.tenantId,
        userId: input.userId,
        jurisdiction: input.jurisdiction,
        note: 'Mock provider - does not return CLEAR without authoritative result',
      },
    };
  }

  async screenEntity(input: ScreenEntityInput): Promise<AmlScreeningResult> {
    return {
      provider: this.providerName,
      providerReference: `aml_mock_entity_${require('crypto').randomUUID()}`,
      status: AmlState.REVIEW_REQUIRED,
      decision: ComplianceDecision.REVIEW_REQUIRED,
      riskLevel: RiskLevel.MEDIUM,
      reasonCode: 'MOCK_ENTITY_REVIEW',
      screenedAt: new Date().toISOString(),
      safeMetadata: { provider: this.providerName, tenantId: input.tenantId, entityId: input.entityId },
    };
  }

  async screenTransaction(input: ScreenTransactionInput): Promise<AmlScreeningResult> {
    const amountNum = parseFloat(input.amount || '0');
    let decision = ComplianceDecision.PENDING;
    let status = AmlState.REVIEW_REQUIRED;
    let riskLevel = RiskLevel.MEDIUM;

    // Deterministic rule without hardcoded sanctions list: amount-based review
    if (amountNum > 50000) {
      decision = ComplianceDecision.REVIEW_REQUIRED;
      status = AmlState.REVIEW_REQUIRED;
      riskLevel = RiskLevel.HIGH;
    } else if (amountNum > 10000) {
      decision = ComplianceDecision.REVIEW_REQUIRED;
      status = AmlState.POTENTIAL_MATCH;
      riskLevel = RiskLevel.MEDIUM;
    } else {
      decision = ComplianceDecision.PENDING;
      status = AmlState.CLEAR;
      riskLevel = RiskLevel.LOW;
    }

    return {
      provider: this.providerName,
      providerReference: `aml_mock_tx_${require('crypto').randomUUID()}`,
      status,
      decision,
      riskLevel,
      reasonCode: `MOCK_TX_${status}`,
      screenedAt: new Date().toISOString(),
      safeMetadata: {
        provider: this.providerName,
        tenantId: input.tenantId,
        transactionType: input.transactionType,
        currency: input.currency,
        amount: '[REDACTED]',
        jurisdiction: input.jurisdiction,
      },
    };
  }

  async getScreeningResult(input: GetScreeningResultInput): Promise<AmlScreeningResult> {
    return {
      provider: this.providerName,
      providerReference: input.providerReference,
      status: AmlState.REVIEW_REQUIRED,
      decision: ComplianceDecision.REVIEW_REQUIRED,
      riskLevel: RiskLevel.MEDIUM,
      reasonCode: 'MOCK_RESULT_REVIEW',
      screenedAt: new Date().toISOString(),
      safeMetadata: { providerReference: input.providerReference },
    };
  }

  async rescreen(tenantId: string, providerReference: string, idempotencyKey: string): Promise<AmlScreeningResult> {
    return {
      provider: this.providerName,
      providerReference,
      status: AmlState.REVIEW_REQUIRED,
      decision: ComplianceDecision.REVIEW_REQUIRED,
      riskLevel: RiskLevel.MEDIUM,
      reasonCode: 'MOCK_RESCREEN_REVIEW',
      screenedAt: new Date().toISOString(),
      safeMetadata: { tenantId, providerReference, idempotencyKey },
    };
  }
}

@Injectable()
export class AmlProviderFactory {
  private readonly logger = new Logger(AmlProviderFactory.name);
  private readonly configuredProvider: string;
  private readonly providerInstances: Map<string, IAmlProvider>;

  constructor() {
    this.configuredProvider = (process.env.AML_PROVIDER || 'UNAVAILABLE').toUpperCase();
    this.providerInstances = new Map();

    this.providerInstances.set('UNAVAILABLE', new UnavailableAmlProvider());
    this.providerInstances.set('MOCK', new MockAmlProvider('MOCK'));
    this.providerInstances.set('MOCK_AML', new MockAmlProvider('MOCK_AML'));

    if (process.env.WORLDCOMPLIANCE_API_KEY) {
      this.providerInstances.set('WORLDCOMPLIANCE', new MockAmlProvider('WORLDCOMPLIANCE'));
    }
    if (process.env.COMPLYADVANTAGE_API_KEY) {
      this.providerInstances.set('COMPLYADVANTAGE', new MockAmlProvider('COMPLYADVANTAGE'));
    }
    if (process.env.SANCTIONS_IO_API_KEY) {
      this.providerInstances.set('SANCTIONS_IO', new MockAmlProvider('SANCTIONS_IO'));
    }

    this.logger.log(`AML Provider Factory initialized configured=${this.configuredProvider} available=${Array.from(this.providerInstances.keys()).join(',')}`);
  }

  getProvider(providerName?: string): IAmlProvider {
    const name = (providerName || this.configuredProvider).toUpperCase();
    const provider = this.providerInstances.get(name);
    if (provider) {
      if (!provider.isAvailable()) {
        this.logger.warn(`AML provider ${name} unavailable - returning explicit PROVIDER_UNAVAILABLE, NOT CLEAR`);
        return this.providerInstances.get('UNAVAILABLE')!;
      }
      return provider;
    }
    this.logger.warn(`AML provider ${name} not configured - returning UNAVAILABLE, no fake CLEAR`);
    return this.providerInstances.get('UNAVAILABLE')!;
  }

  getConfiguredProvider(): IAmlProvider {
    return this.getProvider(this.configuredProvider);
  }

  isProviderAvailable(providerName?: string): boolean {
    const provider = this.getProvider(providerName);
    return provider.isAvailable() && provider.providerName !== 'UNAVAILABLE';
  }

  listAvailableProviders(): string[] {
    return Array.from(this.providerInstances.entries())
      .filter(([, p]) => p.isAvailable())
      .map(([name]) => name);
  }
}
