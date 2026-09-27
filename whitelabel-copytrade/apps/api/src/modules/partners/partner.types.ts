/**
 * Canonical partner types, states, and transition maps
 * Enterprise Partner / Reseller / Agency / Affiliate Control Plane
 */

export enum PartnerType {
  RESELLER = 'RESELLER',
  AGENCY = 'AGENCY',
  AFFILIATE = 'AFFILIATE',
  WHITE_LABEL_PARTNER = 'WHITE_LABEL_PARTNER',
  REFERRAL_PARTNER = 'REFERRAL_PARTNER',
  INSTITUTIONAL_DISTRIBUTOR = 'INSTITUTIONAL_DISTRIBUTOR',
  MANAGED_SERVICE_PROVIDER = 'MANAGED_SERVICE_PROVIDER',
}

export enum PartnerState {
  PENDING = 'PENDING',
  UNDER_REVIEW = 'UNDER_REVIEW',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  REACTIVATION_REVIEW = 'REACTIVATION_REVIEW',
  TERMINATION_PENDING = 'TERMINATION_PENDING',
  TERMINATED = 'TERMINATED',
}

export enum PartnerAgreementState {
  DRAFT = 'DRAFT',
  REVIEW = 'REVIEW',
  APPROVED = 'APPROVED',
  ACTIVE = 'ACTIVE',
  SUPERSEDED = 'SUPERSEDED',
  TERMINATED = 'TERMINATED',
}

export enum PartnerTenantRelationshipType {
  DIRECT = 'DIRECT',
  REFERRED = 'REFERRED',
  MANAGED = 'MANAGED',
  WHITE_LABEL = 'WHITE_LABEL',
  RESELLER = 'RESELLER',
  AGENCY = 'AGENCY',
}

export enum PartnerTenantRelationshipState {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  TRANSFER_PENDING = 'TRANSFER_PENDING',
  TERMINATED = 'TERMINATED',
}

export enum PartnerReferralState {
  ACTIVE = 'ACTIVE',
  EXPIRED = 'EXPIRED',
  REVOKED = 'REVOKED',
  CONVERTED = 'CONVERTED',
  SUSPENDED = 'SUSPENDED',
}

export enum PartnerAttributionState {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  EXPIRED = 'EXPIRED',
  CONFLICT = 'CONFLICT',
  REVOKED = 'REVOKED',
  SUPERSEDED = 'SUPERSEDED',
}

export enum PartnerCommissionState {
  PENDING = 'PENDING',
  ELIGIBLE = 'ELIGIBLE',
  ACCRUED = 'ACCRUED',
  REVERSED = 'REVERSED',
  SETTLED = 'SETTLED',
  PAYOUT_PENDING = 'PAYOUT_PENDING',
  PAID = 'PAID',
  BLOCKED = 'BLOCKED',
  CANCELLED = 'CANCELLED',
}

export enum PartnerCommissionModel {
  PERCENTAGE_REVENUE = 'PERCENTAGE_REVENUE',
  FIXED_AMOUNT = 'FIXED_AMOUNT',
  FIRST_PERIOD = 'FIRST_PERIOD',
  RECURRING_PERIOD = 'RECURRING_PERIOD',
  HYBRID = 'HYBRID',
}

export enum PartnerCommissionBasis {
  LIST_PRICE = 'LIST_PRICE',
  DISCOUNTED_PRICE = 'DISCOUNTED_PRICE',
  NET_REVENUE = 'NET_REVENUE',
  COLLECTED_REVENUE = 'COLLECTED_REVENUE',
}

export enum PartnerSettlementState {
  DRAFT = 'DRAFT',
  OPEN = 'OPEN',
  RECONCILING = 'RECONCILING',
  RECONCILED = 'RECONCILED',
  VALIDATED = 'VALIDATED',
  LOCKED = 'LOCKED',
  PAYOUT_REQUESTED = 'PAYOUT_REQUESTED',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export enum PartnerPayoutState {
  ELIGIBLE = 'ELIGIBLE',
  REQUESTED = 'REQUESTED',
  APPROVED = 'APPROVED',
  SUBMITTED = 'SUBMITTED',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  REVERSED = 'REVERSED',
}

export enum PartnerCampaignState {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  EXPIRED = 'EXPIRED',
  ARCHIVED = 'ARCHIVED',
}

export enum PartnerUserRole {
  PARTNER_OWNER = 'PARTNER_OWNER',
  PARTNER_ADMIN = 'PARTNER_ADMIN',
  PARTNER_SALES = 'PARTNER_SALES',
  PARTNER_SUPPORT = 'PARTNER_SUPPORT',
  PARTNER_FINANCE = 'PARTNER_FINANCE',
  PARTNER_ANALYST = 'PARTNER_ANALYST',
}

export enum PartnerUserState {
  INVITED = 'INVITED',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  DEACTIVATED = 'DEACTIVATED',
}

export enum PartnerDiscountType {
  PERCENTAGE = 'PERCENTAGE',
  FIXED_AMOUNT = 'FIXED_AMOUNT',
  CAMPAIGN = 'CAMPAIGN',
}

export enum PartnerReconciliationMismatchType {
  PARTNER_WITHOUT_AGREEMENT = 'PARTNER_WITHOUT_AGREEMENT',
  TENANT_WITHOUT_VALID_PARTNER_RELATION = 'TENANT_WITHOUT_VALID_PARTNER_RELATION',
  MULTIPLE_PRIMARY_PARTNERS = 'MULTIPLE_PRIMARY_PARTNERS',
  ATTRIBUTION_CONFLICT = 'ATTRIBUTION_CONFLICT',
  ATTRIBUTION_EXPIRED = 'ATTRIBUTION_EXPIRED',
  COMMISSION_WITHOUT_SOURCE_PAYMENT = 'COMMISSION_WITHOUT_SOURCE_PAYMENT',
  COMMISSION_AMOUNT_MISMATCH = 'COMMISSION_AMOUNT_MISMATCH',
  COMMISSION_DUPLICATE = 'COMMISSION_DUPLICATE',
  REFUND_WITHOUT_COMMISSION_REVERSAL = 'REFUND_WITHOUT_COMMISSION_REVERSAL',
  CHARGEBACK_WITHOUT_REVERSAL = 'CHARGEBACK_WITHOUT_REVERSAL',
  SETTLEMENT_WITHOUT_RECONCILIATION = 'SETTLEMENT_WITHOUT_RECONCILIATION',
  PAYOUT_WITHOUT_SETTLEMENT = 'PAYOUT_WITHOUT_SETTLEMENT',
  PAYOUT_STATUS_MISMATCH = 'PAYOUT_STATUS_MISMATCH',
  CURRENCY_MISMATCH = 'CURRENCY_MISMATCH',
  MISSING_FX = 'MISSING_FX',
}

export enum PartnerAuditAction {
  PARTNER_CREATED = 'PARTNER_CREATED',
  PARTNER_APPROVED = 'PARTNER_APPROVED',
  PARTNER_SUSPENDED = 'PARTNER_SUSPENDED',
  PARTNER_REACTIVATED = 'PARTNER_REACTIVATED',
  PARTNER_TERMINATED = 'PARTNER_TERMINATED',
  AGREEMENT_CREATED = 'AGREEMENT_CREATED',
  AGREEMENT_APPROVED = 'AGREEMENT_APPROVED',
  AGREEMENT_ACTIVATED = 'AGREEMENT_ACTIVATED',
  AGREEMENT_SUPERSEDED = 'AGREEMENT_SUPERSEDED',
  AGREEMENT_TERMINATED = 'AGREEMENT_TERMINATED',
  TENANT_ASSIGNED = 'TENANT_ASSIGNED',
  TENANT_TRANSFERRED = 'TENANT_TRANSFERRED',
  TENANT_UNASSIGNED = 'TENANT_UNASSIGNED',
  CAMPAIGN_CREATED = 'CAMPAIGN_CREATED',
  DISCOUNT_APPLIED = 'DISCOUNT_APPLIED',
  REFERRAL_CREATED = 'REFERRAL_CREATED',
  REFERRAL_ATTRIBUTED = 'REFERRAL_ATTRIBUTED',
  COMMISSION_ACCRUED = 'COMMISSION_ACCRUED',
  COMMISSION_REVERSED = 'COMMISSION_REVERSED',
  SETTLEMENT_CREATED = 'SETTLEMENT_CREATED',
  SETTLEMENT_LOCKED = 'SETTLEMENT_LOCKED',
  PAYOUT_REQUESTED = 'PAYOUT_REQUESTED',
  PAYOUT_COMPLETED = 'PAYOUT_COMPLETED',
  PAYOUT_FAILED = 'PAYOUT_FAILED',
  PAYOUT_REVERSED = 'PAYOUT_REVERSED',
  PARTNER_USER_INVITED = 'PARTNER_USER_INVITED',
  PARTNER_USER_SUSPENDED = 'PARTNER_USER_SUSPENDED',
  RECONCILIATION_RUN = 'RECONCILIATION_RUN',
}

export const PARTNER_STATE_TRANSITIONS: Record<PartnerState, PartnerState[]> = {
  [PartnerState.PENDING]: [PartnerState.UNDER_REVIEW, PartnerState.TERMINATED],
  [PartnerState.UNDER_REVIEW]: [PartnerState.ACTIVE, PartnerState.TERMINATED, PartnerState.PENDING],
  [PartnerState.ACTIVE]: [PartnerState.SUSPENDED, PartnerState.TERMINATION_PENDING],
  [PartnerState.SUSPENDED]: [PartnerState.REACTIVATION_REVIEW, PartnerState.TERMINATION_PENDING, PartnerState.TERMINATED],
  [PartnerState.REACTIVATION_REVIEW]: [PartnerState.ACTIVE, PartnerState.SUSPENDED, PartnerState.TERMINATED],
  [PartnerState.TERMINATION_PENDING]: [PartnerState.TERMINATED, PartnerState.ACTIVE],
  [PartnerState.TERMINATED]: [],
};

export const PARTNER_AGREEMENT_TRANSITIONS: Record<PartnerAgreementState, PartnerAgreementState[]> = {
  [PartnerAgreementState.DRAFT]: [PartnerAgreementState.REVIEW, PartnerAgreementState.TERMINATED],
  [PartnerAgreementState.REVIEW]: [PartnerAgreementState.APPROVED, PartnerAgreementState.DRAFT, PartnerAgreementState.TERMINATED],
  [PartnerAgreementState.APPROVED]: [PartnerAgreementState.ACTIVE, PartnerAgreementState.TERMINATED],
  [PartnerAgreementState.ACTIVE]: [PartnerAgreementState.SUPERSEDED, PartnerAgreementState.TERMINATED],
  [PartnerAgreementState.SUPERSEDED]: [PartnerAgreementState.TERMINATED],
  [PartnerAgreementState.TERMINATED]: [],
};

export const PARTNER_SETTLEMENT_TRANSITIONS: Record<PartnerSettlementState, PartnerSettlementState[]> = {
  [PartnerSettlementState.DRAFT]: [PartnerSettlementState.OPEN, PartnerSettlementState.CANCELLED],
  [PartnerSettlementState.OPEN]: [PartnerSettlementState.RECONCILING, PartnerSettlementState.CANCELLED],
  [PartnerSettlementState.RECONCILING]: [PartnerSettlementState.RECONCILED, PartnerSettlementState.FAILED],
  [PartnerSettlementState.RECONCILED]: [PartnerSettlementState.VALIDATED, PartnerSettlementState.FAILED],
  [PartnerSettlementState.VALIDATED]: [PartnerSettlementState.LOCKED, PartnerSettlementState.FAILED],
  [PartnerSettlementState.LOCKED]: [PartnerSettlementState.PAYOUT_REQUESTED, PartnerSettlementState.FAILED],
  [PartnerSettlementState.PAYOUT_REQUESTED]: [PartnerSettlementState.COMPLETED, PartnerSettlementState.FAILED],
  [PartnerSettlementState.COMPLETED]: [],
  [PartnerSettlementState.FAILED]: [PartnerSettlementState.OPEN, PartnerSettlementState.CANCELLED],
  [PartnerSettlementState.CANCELLED]: [],
};

export const PARTNER_PAYOUT_TRANSITIONS: Record<PartnerPayoutState, PartnerPayoutState[]> = {
  [PartnerPayoutState.ELIGIBLE]: [PartnerPayoutState.REQUESTED],
  [PartnerPayoutState.REQUESTED]: [PartnerPayoutState.APPROVED, PartnerPayoutState.FAILED],
  [PartnerPayoutState.APPROVED]: [PartnerPayoutState.SUBMITTED, PartnerPayoutState.FAILED],
  [PartnerPayoutState.SUBMITTED]: [PartnerPayoutState.PROCESSING, PartnerPayoutState.FAILED],
  [PartnerPayoutState.PROCESSING]: [PartnerPayoutState.COMPLETED, PartnerPayoutState.FAILED],
  [PartnerPayoutState.COMPLETED]: [PartnerPayoutState.REVERSED],
  [PartnerPayoutState.FAILED]: [PartnerPayoutState.REQUESTED, PartnerPayoutState.ELIGIBLE],
  [PartnerPayoutState.REVERSED]: [],
};

export interface PartnerPolicy {
  partnerType: PartnerType;
  allowedPartnerTypes: PartnerType[];
  onboardingRequirements: string[];
  commissionBasis: PartnerCommissionBasis;
  commissionModels: PartnerCommissionModel[];
  commissionRates: CommissionRateConfig[];
  discountRules: DiscountRuleConfig;
  attributionWindowHours: number;
  settlementSchedule: SettlementSchedule;
  payoutRequirements: PayoutRequirement;
  subPartnerAllowed: boolean;
  currencyPolicy: CurrencyPolicy;
  terminationRules: TerminationRule;
  policyVersion: string;
  agreementVersion: string;
  trialCommissionEligible: boolean;
  lifetimeCommissionModel: PartnerCommissionModel;
  refundPolicy: RefundCommissionPolicy;
  chargebackPolicy: ChargebackCommissionPolicy;
}

export interface CommissionRateConfig {
  model: PartnerCommissionModel;
  basis: PartnerCommissionBasis;
  rateBasisPoints?: number; // percentage in bps, e.g. 2000 = 20%
  fixedAmount?: string; // Decimal string
  currency?: string;
  firstPeriodOnly?: boolean;
  recurringPeriods?: number;
  minEligibleAmount?: string;
  maxCommissionAmount?: string;
  planCodes?: string[]; // if restricted to plans
  effectiveFrom: string;
  effectiveTo?: string | null;
}

export interface DiscountRuleConfig {
  maxDiscountBasisPoints: number;
  maxDiscountFixedAmount?: string;
  allowedDiscountTypes: PartnerDiscountType[];
  stackingAllowed: boolean;
  requiresApproval: boolean;
  allowedCurrencies: string[];
  maxActiveDiscounts: number;
}

export interface SettlementSchedule {
  frequency: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'QUARTERLY';
  dayOfWeek?: number;
  dayOfMonth?: number;
  minPayoutAmount: string;
  currency: string;
  autoSettlement: boolean;
}

export interface PayoutRequirement {
  minPayoutAmount: string;
  allowedMethods: string[];
  requiresApproval: boolean;
  kycRequired: boolean;
}

export interface CurrencyPolicy {
  allowedCurrencies: string[];
  settlementCurrency: string;
  fxRequired: boolean;
  fxProvider?: string;
  allowMultiCurrency: boolean;
}

export interface TerminationRule {
  noticePeriodDays: number;
  settlementOnTermination: boolean;
  commissionForfeiture: boolean;
}

export interface RefundCommissionPolicy {
  reversalRequired: boolean;
  reversalBasis: 'FULL' | 'PROPORTIONAL' | 'NONE';
  deductionFromFutureSettlement: boolean;
}

export interface ChargebackCommissionPolicy {
  reversalRequired: boolean;
  recoveryRequired: boolean;
  deductionFromFutureSettlement: boolean;
  createsOutstandingBalance: boolean;
}

export interface PartnerProfile {
  id: string;
  code: string;
  name: string;
  legalName?: string | null;
  type: PartnerType;
  state: PartnerState;
  ownerUserId: string;
  contactEmail: string;
  contactName?: string | null;
  website?: string | null;
  countryCode?: string | null;
  taxId?: string | null;
  billingEmail?: string | null;
  currency: string;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  activatedAt?: string | null;
  suspendedAt?: string | null;
  terminatedAt?: string | null;
  metadata?: Record<string, unknown> | null;
  policyVersion: string;
  agreementVersion?: string | null;
}

export interface PartnerAgreement {
  id: string;
  partnerId: string;
  version: number;
  state: PartnerAgreementState;
  commissionPolicy: PartnerPolicy;
  pricingRules: PricingRule[];
  payoutTerms: PayoutTerms;
  attributionRules: AttributionRule[];
  effectiveFrom: string;
  effectiveTo?: string | null;
  jurisdiction?: string | null;
  responsibilities: string[];
  terminationClause?: string | null;
  createdBy: string;
  approvedBy?: string | null;
  activatedAt?: string | null;
  supersededAt?: string | null;
  terminatedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  previousVersionId?: string | null;
  isImmutable: boolean;
}

export interface PricingRule {
  planCode: string;
  allowed: boolean;
  partnerPriceOverride?: string | null;
  discountBasisPoints?: number | null;
  currency: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
}

export interface PayoutTerms {
  schedule: SettlementSchedule;
  method: string;
  minAmount: string;
  currency: string;
  feeBasisPoints?: number;
}

export interface AttributionRule {
  windowHours: number;
  source: 'REFERRAL_CODE' | 'REFERRAL_TOKEN' | 'TENANT_PROVISIONING' | 'CAMPAIGN' | 'MANUAL';
  priority: number;
  requiresApproval: boolean;
}

export interface PartnerTenantRelationship {
  id: string;
  partnerId: string;
  tenantId: string;
  relationshipType: PartnerTenantRelationshipType;
  state: PartnerTenantRelationshipState;
  attributionId?: string | null;
  campaignId?: string | null;
  referralCode?: string | null;
  assignedAt: string;
  assignedBy: string;
  activatedAt?: string | null;
  terminatedAt?: string | null;
  isPrimary: boolean;
  metadata?: Record<string, unknown> | null;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface PartnerReferral {
  id: string;
  partnerId: string;
  campaignId?: string | null;
  code: string;
  token: string;
  state: PartnerReferralState;
  createdBy: string;
  expiresAt?: string | null;
  convertedAt?: string | null;
  convertedTenantId?: string | null;
  maxUses?: number | null;
  currentUses: number;
  createdAt: string;
  updatedAt: string;
  idempotencyKey: string;
}

export interface PartnerAttribution {
  id: string;
  partnerId: string;
  tenantId: string;
  campaignId?: string | null;
  referralCode?: string | null;
  referralToken?: string | null;
  attributionSource: string;
  attributionWindowHours: number;
  capturedAt: string;
  effectiveAt: string;
  expiresAt: string;
  agreementVersion: string;
  policyVersion: string;
  state: PartnerAttributionState;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
  idempotencyKey: string;
}

export interface PartnerCommission {
  id: string;
  partnerId: string;
  tenantId: string;
  sourcePaymentId?: string | null;
  sourceInvoiceId?: string | null;
  sourceSubscriptionId?: string | null;
  sourceFeeId?: string | null;
  sourceEventId: string;
  sourceEventType: 'PAYMENT' | 'INVOICE' | 'SUBSCRIPTION' | 'FEE' | 'REFUND' | 'CHARGEBACK';
  grossRevenue: string;
  discountAmount: string;
  netEligibleRevenue: string;
  commissionRate: string; // bps or fixed string
  commissionBasis: PartnerCommissionBasis;
  commissionModel: PartnerCommissionModel;
  commissionAmount: string; // Decimal string
  currency: string;
  sourceCurrency: string;
  commissionCurrency: string;
  fxRequired: boolean;
  fxRate?: string | null;
  fxTimestamp?: string | null;
  fxSource?: string | null;
  agreementVersion: string;
  policyVersion: string;
  calculationVersion: string;
  state: PartnerCommissionState;
  settlementId?: string | null;
  payoutId?: string | null;
  reversalOfId?: string | null;
  createdAt: string;
  updatedAt: string;
  accruedAt: string;
  idempotencyKey: string;
  correlationId: string;
}

export interface PartnerSettlement {
  id: string;
  partnerId: string;
  periodStart: string;
  periodEnd: string;
  currency: string;
  state: PartnerSettlementState;
  totalGrossRevenue: string;
  totalDiscount: string;
  totalNetEligibleRevenue: string;
  totalCommissionAccrued: string;
  totalCommissionReversed: string;
  totalCommissionPayable: string;
  commissionCount: number;
  reversalCount: number;
  refundCount: number;
  chargebackCount: number;
  fingerprint: string;
  calculationVersion: string;
  policyVersion: string;
  agreementVersion: string;
  reconciledAt?: string | null;
  lockedAt?: string | null;
  completedAt?: string | null;
  payoutId?: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  idempotencyKey: string;
  correlationId: string;
}

export interface PartnerPayout {
  id: string;
  partnerId: string;
  settlementId: string;
  amount: string;
  currency: string;
  state: PartnerPayoutState;
  method: string;
  providerPayoutId?: string | null;
  providerReference?: string | null;
  failureReason?: string | null;
  requestedAt: string;
  requestedBy: string;
  approvedAt?: string | null;
  approvedBy?: string | null;
  submittedAt?: string | null;
  completedAt?: string | null;
  failedAt?: string | null;
  reversedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  idempotencyKey: string;
  correlationId: string;
}

export interface PartnerCampaign {
  id: string;
  partnerId: string;
  name: string;
  code: string;
  state: PartnerCampaignState;
  discountType?: PartnerDiscountType | null;
  discountValue?: string | null;
  discountCurrency?: string | null;
  maxUses?: number | null;
  currentUses: number;
  allowedPlans?: string[] | null;
  attributionWindowHours: number;
  startsAt: string;
  endsAt?: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  idempotencyKey: string;
}

export interface PartnerAuditEvent {
  id: string;
  partnerId: string;
  tenantId?: string | null;
  actorId: string;
  actorRole?: string | null;
  action: PartnerAuditAction;
  source: string;
  correlationId: string;
  agreementVersion?: string | null;
  policyVersion?: string | null;
  timestamp: string;
  safeEvidence: Record<string, unknown>;
  createdAt: string;
}
