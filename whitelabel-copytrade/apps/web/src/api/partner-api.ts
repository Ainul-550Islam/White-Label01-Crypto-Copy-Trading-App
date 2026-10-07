// # NEW — Typed client for /v1/partner/* endpoints
import { apiClient } from "./api-client";

export interface PartnerProfileDto {
  id: string;
  code: string;
  name: string;
  legalName: string;
  type: "AFFILIATE" | "INTRODUCING_BROKER" | "RESELLER" | "AGENCY";
  state: string;
  tier?: string;
  contactEmail: string;
  currency: string;
  createdAt: string;
}

export interface PartnerPortalSummaryDto {
  activeReferralsCount: number;
  attributedTenantsCount: number;
  referredTradingVolumeUsd: string;
  accruedCommissionsAmount: string;
  settledCommissionsAmount: string;
  availablePayoutBalance: string;
  tierName: string;
  rebateRateBps: number;
}

export interface PartnerProfileResponse {
  profile: PartnerProfileDto;
  summary: PartnerPortalSummaryDto | null;
}

export interface PartnerReferralRecord {
  id: string;
  partnerId: string;
  campaignId?: string | null;
  code: string;
  usesCount?: number;
  maxUses?: number | null;
  expiresAt?: string | null;
  state: string;
  createdAt: string;
}

export interface PartnerAttributionRecord {
  id: string;
  partnerId: string;
  tenantId: string;
  referralCode?: string | null;
  attributionSource: string;
  capturedAt: string;
}

export interface PartnerReferralsResponse {
  partnerId: string;
  referrals: PartnerReferralRecord[];
  attributions: PartnerAttributionRecord[];
}

export interface PartnerCommissionRecord {
  id: string;
  partnerId: string;
  tenantId: string;
  sourceEventId: string;
  sourceEventType: string;
  grossRevenue: string;
  commissionRateBps?: number;
  commissionAmount: string;
  currency: string;
  state: "ACCRUED" | "APPROVED" | "SETTLED" | "PAID" | "REVERSED";
  settlementId?: string | null;
  createdAt: string;
}

export interface PartnerPayoutRecord {
  id: string;
  partnerId: string;
  settlementId: string;
  amount: string;
  currency: string;
  method: string;
  state: "REQUESTED" | "APPROVED" | "PROCESSING" | "PAID" | "FAILED" | "REJECTED";
  providerReference?: string | null;
  failureReason?: string | null;
  createdAt: string;
}

export const partnerApi = {
  getProfile: (params?: { partnerId?: string; currency?: string }) =>
    apiClient.get<PartnerProfileResponse>("/v1/partner/profile", {
      searchParams: params,
    }),

  listReferrals: (params?: { partnerId?: string }) =>
    apiClient.get<PartnerReferralsResponse>("/v1/partner/referrals", {
      searchParams: params,
    }),

  createReferral: (payload: {
    partnerId: string;
    campaignId: string;
    code: string;
    maxUses?: number;
    expiresAt?: string | null;
    createdBy: string;
    correlationId: string;
    idempotencyKey?: string;
  }) => apiClient.post<PartnerReferralRecord>("/v1/partner/referrals", payload),

  listCommissions: (params?: {
    partnerId?: string;
    state?: string;
    currency?: string;
    settlementId?: string;
  }) =>
    apiClient.get<{ partnerId: string; items: PartnerCommissionRecord[] }>(
      "/v1/partner/commissions",
      {
        searchParams: params,
      },
    ),

  listPayouts: (params?: {
    partnerId?: string;
    state?: string;
    settlementId?: string;
  }) =>
    apiClient.get<{ partnerId: string; items: PartnerPayoutRecord[] }>("/v1/partner/payouts", {
      searchParams: params,
    }),

  requestPayout: (payload: {
    partnerId: string;
    settlementId: string;
    amount: string;
    currency: string;
    method: string;
    requestedBy: string;
    correlationId: string;
    idempotencyKey?: string;
  }) => apiClient.post<PartnerPayoutRecord>("/v1/partner/payouts", payload),
};
