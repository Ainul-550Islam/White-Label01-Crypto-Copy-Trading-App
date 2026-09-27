import type { DecimalString, ISODateString, SupportedCurrency, UUID } from './common';

export enum BillingInterval {
  MONTHLY = 'MONTHLY',
  QUARTERLY = 'QUARTERLY',
  YEARLY = 'YEARLY',
  LIFETIME = 'LIFETIME',
}

export enum SubscriptionStatus {
  TRIALING = 'TRIALING',
  ACTIVE = 'ACTIVE',
  PAST_DUE = 'PAST_DUE',
  CANCELED = 'CANCELED',
  EXPIRED = 'EXPIRED',
  PAUSED = 'PAUSED',
}

export enum PlanAudience {
  TENANT = 'TENANT',
  END_USER = 'END_USER',
}

export interface PlanLimits {
  maxUsers: number | null;
  maxTraders: number | null;
  maxFollowersPerTrader: number | null;
  maxExchangeAccountsPerUser: number | null;
  maxCopySubscriptionsPerFollower: number | null;
  maxApiRequestsPerMinute: number | null;
  websocketConnections: number | null;
  customDomain: boolean;
  whiteLabelMobileApp: boolean;
  prioritySupport: boolean;
}

export interface SubscriptionPlanDto {
  id: UUID;
  tenantId: UUID | null;
  code: string;
  name: string;
  description: string | null;
  audience: PlanAudience;
  price: DecimalString;
  currency: SupportedCurrency;
  interval: BillingInterval;
  trialDays: number;
  performanceFeeBps: number;
  platformFeeBps: number;
  limits: PlanLimits;
  features: string[];
  isActive: boolean;
  sortOrder: number;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface TenantSubscriptionDto {
  id: UUID;
  tenantId: UUID;
  planId: UUID;
  plan?: SubscriptionPlanDto;
  status: SubscriptionStatus;
  currentPeriodStart: ISODateString;
  currentPeriodEnd: ISODateString;
  trialEndsAt: ISODateString | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: ISODateString | null;
  externalCustomerId: string | null;
  externalSubscriptionId: string | null;
  seatsPurchased: number;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
