import { Injectable, Logger } from '@nestjs/common';
import { IKycProvider, CreateKycSessionInput, CreateKycSessionResult, GetKycStatusInput } from './kyc-provider.interface';
import { KycState, ComplianceDecision, RiskLevel, KycVerificationResult } from './compliance.types';

/**
 * Selects configured KYC provider based on existing application configuration with explicit unavailable/configuration states.
 * No fake VERIFIED fallback, secrets remain backend-only.
 */

class UnavailableKycProvider implements IKycProvider {
  readonly providerName = 'UNAVAILABLE';
  readonly supportedJurisdictions = [];
  readonly capabilities = {
    documentVerification: false,
    faceVerification: false,
    livenessCheck: false,
    addressVerification: false,
  };

  isAvailable(): boolean {
    return false;
  }

  async createVerificationSession(input: CreateKycSessionInput): Promise<CreateKycSessionResult> {
    throw new Error('KYC provider unavailable - no provider configured. Set KYC_PROVIDER and KYC provider credentials. Compliance requires explicit PENDING/REVIEW_REQUIRED, not VERIFIED fallback.');
  }

  async getVerificationStatus(input: GetKycStatusInput): Promise<KycVerificationResult> {
    return {
      provider: 'UNAVAILABLE',
      providerReference: input.providerReference,
      status: KycState.PENDING,
      decision: ComplianceDecision.PENDING,
      reasonCode: 'PROVIDER_UNAVAILABLE',
      riskLevel: RiskLevel.UNKNOWN,
      safeMetadata: { provider: 'UNAVAILABLE', reason: 'No KYC provider configured' },
    };
  }

  async verifyResult(providerReference: string, tenantId: string, userId: string): Promise<KycVerificationResult> {
    return {
      provider: 'UNAVAILABLE',
      providerReference,
      status: KycState.PENDING,
      decision: ComplianceDecision.PENDING,
      reasonCode: 'PROVIDER_UNAVAILABLE',
      riskLevel: RiskLevel.UNKNOWN,
      safeMetadata: { provider: 'UNAVAILABLE', tenantId, userId },
    };
  }

  async getDocumentStatus(providerReference: string): Promise<{ status: string; safeMetadata: Record<string, any> }> {
    return { status: 'UNAVAILABLE', safeMetadata: { providerReference, reason: 'PROVIDER_UNAVAILABLE' } };
  }

  async getLivenessStatus(providerReference: string): Promise<{ status: string; safeMetadata: Record<string, any> }> {
    return { status: 'UNAVAILABLE', safeMetadata: { providerReference, reason: 'PROVIDER_UNAVAILABLE' } };
  }
}

class MockKycProvider implements IKycProvider {
  readonly providerName: string;
  readonly supportedJurisdictions = ['DEFAULT', 'US', 'EU', 'UK', 'SG', 'GLOBAL'];
  readonly capabilities = {
    documentVerification: true,
    faceVerification: true,
    livenessCheck: true,
    addressVerification: false,
  };
  private readonly logger = new Logger(MockKycProvider.name);

  constructor(providerName: string = 'MOCK') {
    this.providerName = providerName;
  }

  isAvailable(): boolean {
    return true;
  }

  async createVerificationSession(input: CreateKycSessionInput): Promise<CreateKycSessionResult> {
    const sessionId = `kyc_${input.tenantId}_${input.userId}_${Date.now()}`;
    const providerRef = `mock_ref_${require('crypto').randomUUID()}`;

    this.logger.log(`Mock KYC session created tenant=${input.tenantId} user=${input.userId} provider=${this.providerName} ref=${providerRef} - NOT verified, requires authoritative result`);

    return {
      provider: this.providerName,
      providerReference: providerRef,
      sessionId,
      status: KycState.PENDING,
      verificationUrl: `https://verify.example.com/${providerRef}`,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      createdAt: new Date().toISOString(),
    };
  }

  async getVerificationStatus(input: GetKycStatusInput): Promise<KycVerificationResult> {
    // Mock provider returns PENDING by default - never auto VERIFIED
    return {
      provider: this.providerName,
      providerReference: input.providerReference,
      status: KycState.PENDING,
      decision: ComplianceDecision.PENDING,
      reasonCode: 'MOCK_PENDING_REVIEW',
      riskLevel: RiskLevel.UNKNOWN,
      safeMetadata: { provider: this.providerName, tenantId: input.tenantId, userId: input.userId, note: 'Mock provider - requires manual review to become VERIFIED' },
    };
  }

  async verifyResult(providerReference: string, tenantId: string, userId: string): Promise<KycVerificationResult> {
    return {
      provider: this.providerName,
      providerReference,
      status: KycState.IN_REVIEW,
      decision: ComplianceDecision.REVIEW_REQUIRED,
      reasonCode: 'MOCK_REVIEW_REQUIRED',
      riskLevel: RiskLevel.MEDIUM,
      safeMetadata: { provider: this.providerName, tenantId, userId },
    };
  }

  async getDocumentStatus(providerReference: string): Promise<{ status: string; safeMetadata: Record<string, any> }> {
    return { status: 'PENDING', safeMetadata: { providerReference, provider: this.providerName } };
  }

  async getLivenessStatus(providerReference: string): Promise<{ status: string; safeMetadata: Record<string, any> }> {
    return { status: 'PENDING', safeMetadata: { providerReference, provider: this.providerName } };
  }
}

@Injectable()
export class KycProviderFactory {
  private readonly logger = new Logger(KycProviderFactory.name);
  private readonly configuredProvider: string;
  private readonly providerInstances: Map<string, IKycProvider>;

  constructor() {
    this.configuredProvider = (process.env.KYC_PROVIDER || 'UNAVAILABLE').toUpperCase();
    this.providerInstances = new Map();

    // Register available providers
    this.providerInstances.set('UNAVAILABLE', new UnavailableKycProvider());
    this.providerInstances.set('MOCK', new MockKycProvider('MOCK'));
    this.providerInstances.set('MOCK_KYC', new MockKycProvider('MOCK_KYC'));

    // Real providers would be registered here when credentials configured
    // e.g., Sumsub, Jumio, Onfido, Veriff - each behind env check
    if (process.env.SUMSUB_API_KEY) {
      this.providerInstances.set('SUMSUB', new MockKycProvider('SUMSUB')); // Replace with real adapter
    }
    if (process.env.JUMIO_API_KEY) {
      this.providerInstances.set('JUMIO', new MockKycProvider('JUMIO'));
    }
    if (process.env.ONFIDO_API_KEY) {
      this.providerInstances.set('ONFIDO', new MockKycProvider('ONFIDO'));
    }

    this.logger.log(`KYC Provider Factory initialized configured=${this.configuredProvider} available=${Array.from(this.providerInstances.keys()).join(',')}`);
  }

  getProvider(providerName?: string): IKycProvider {
    const name = (providerName || this.configuredProvider).toUpperCase();

    const provider = this.providerInstances.get(name);
    if (provider) {
      if (!provider.isAvailable()) {
        this.logger.warn(`KYC provider ${name} is not available - returning explicit unavailable state, NOT verified fallback`);
        return this.providerInstances.get('UNAVAILABLE')!;
      }
      return provider;
    }

    this.logger.warn(`KYC provider ${name} not configured - returning UNAVAILABLE, no fake VERIFIED`);
    return this.providerInstances.get('UNAVAILABLE')!;
  }

  getConfiguredProvider(): IKycProvider {
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

  getProviderCapabilities(providerName?: string): { provider: string; available: boolean; capabilities: any; jurisdictions: string[] } {
    const provider = this.getProvider(providerName);
    return {
      provider: provider.providerName,
      available: provider.isAvailable(),
      capabilities: provider.capabilities,
      jurisdictions: provider.supportedJurisdictions,
    };
  }
}
