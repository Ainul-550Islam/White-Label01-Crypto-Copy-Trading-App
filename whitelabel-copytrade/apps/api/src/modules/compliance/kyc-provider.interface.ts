import { KycState, ComplianceDecision, RiskLevel, KycVerificationResult } from './compliance.types';

/**
 * Provider-neutral KYC contract for identity verification, document verification, face/liveness checks, status retrieval, and normalized results.
 * Never expose raw identity document content.
 */

export interface CreateKycSessionInput {
  tenantId: string;
  userId: string;
  emailHash: string;
  countryCode?: string;
  jurisdiction: string;
  levelName?: string;
  idempotencyKey: string;
  safeMetadata?: Record<string, any>;
}

export interface CreateKycSessionResult {
  provider: string;
  providerReference: string;
  sessionId: string;
  status: KycState;
  verificationUrl?: string;
  expiresAt?: string;
  createdAt: string;
}

export interface GetKycStatusInput {
  tenantId: string;
  userId: string;
  providerReference: string;
}

export interface IKycProvider {
  readonly providerName: string;
  readonly supportedJurisdictions: string[];
  readonly capabilities: {
    documentVerification: boolean;
    faceVerification: boolean;
    livenessCheck: boolean;
    addressVerification: boolean;
  };

  isAvailable(): boolean;

  createVerificationSession(input: CreateKycSessionInput): Promise<CreateKycSessionResult>;

  getVerificationStatus(input: GetKycStatusInput): Promise<KycVerificationResult>;

  verifyResult(providerReference: string, tenantId: string, userId: string): Promise<KycVerificationResult>;

  getDocumentStatus(providerReference: string): Promise<{ status: string; safeMetadata: Record<string, any> }>;

  getLivenessStatus(providerReference: string): Promise<{ status: string; safeMetadata: Record<string, any> }>;
}

export interface KycProviderResult {
  provider: string;
  providerReference: string;
  status: KycState;
  decision: ComplianceDecision;
  reasonCode?: string;
  riskLevel?: RiskLevel;
  timestamp: string;
  safeMetadata: Record<string, any>;
}
