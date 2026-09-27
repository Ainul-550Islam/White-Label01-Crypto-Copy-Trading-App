import { AmlState, ComplianceDecision, RiskLevel, AmlScreeningResult } from './compliance.types';

/**
 * Provider-neutral AML/sanctions screening contract for person/entity screening, transaction screening, watchlist status, and normalized results.
 * Never expose raw provider payload.
 */

export interface ScreenPersonInput {
  tenantId: string;
  userId: string;
  firstNameHash?: string;
  lastNameHash?: string;
  countryCode?: string;
  dateOfBirthHash?: string;
  jurisdiction: string;
  idempotencyKey: string;
  safeMetadata?: Record<string, any>;
}

export interface ScreenEntityInput {
  tenantId: string;
  entityId: string;
  entityNameHash: string;
  countryCode?: string;
  jurisdiction: string;
  idempotencyKey: string;
  safeMetadata?: Record<string, any>;
}

export interface ScreenTransactionInput {
  tenantId: string;
  userId: string;
  transactionId: string;
  transactionType: string;
  amount: string;
  currency: string;
  counterpartyHash?: string;
  jurisdiction: string;
  idempotencyKey: string;
  safeMetadata?: Record<string, any>;
}

export interface GetScreeningResultInput {
  tenantId: string;
  providerReference: string;
}

export interface IAmlProvider {
  readonly providerName: string;
  readonly supportedJurisdictions: string[];
  readonly capabilities: {
    personScreening: boolean;
    entityScreening: boolean;
    transactionScreening: boolean;
    sanctions: boolean;
    pep: boolean;
    adverseMedia: boolean;
  };

  isAvailable(): boolean;

  screenPerson(input: ScreenPersonInput): Promise<AmlScreeningResult>;

  screenEntity(input: ScreenEntityInput): Promise<AmlScreeningResult>;

  screenTransaction(input: ScreenTransactionInput): Promise<AmlScreeningResult>;

  getScreeningResult(input: GetScreeningResultInput): Promise<AmlScreeningResult>;

  rescreen(tenantId: string, providerReference: string, idempotencyKey: string): Promise<AmlScreeningResult>;
}

export interface AmlProviderConfig {
  providerName: string;
  apiKey?: string;
  apiUrl?: string;
  enabled: boolean;
  jurisdictions: string[];
  capabilities: string[];
}
