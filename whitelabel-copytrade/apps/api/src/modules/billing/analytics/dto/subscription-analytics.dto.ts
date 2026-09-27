import { IsOptional, IsString, IsEnum, IsDateString } from 'class-validator';
import { ReportingPeriodType, BillingInterval } from '../revenue-analytics.types';

/**
 * Validated DTOs for subscription KPIs, plan distribution, churn, retention, upgrades, downgrades, and renewal analytics.
 * Include explicit metric definitions where necessary.
 */

export class SubscriptionAnalyticsQueryDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsEnum(ReportingPeriodType)
  periodType?: ReportingPeriodType = ReportingPeriodType.MONTH;

  @IsOptional()
  @IsString()
  tenantId?: string;

  @IsOptional()
  @IsString()
  timezone?: string = 'UTC';

  @IsOptional()
  @IsString()
  planId?: string;

  @IsOptional()
  @IsEnum(BillingInterval)
  billingInterval?: BillingInterval;
}

export class ChurnAnalyticsQueryDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsEnum(ReportingPeriodType)
  periodType?: ReportingPeriodType = ReportingPeriodType.MONTH;

  @IsOptional()
  @IsString()
  currency?: string = 'USD';

  @IsOptional()
  @IsString()
  tenantId?: string;

  @IsOptional()
  @IsString()
  timezone?: string = 'UTC';
}

export class RetentionAnalyticsQueryDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsEnum(ReportingPeriodType)
  periodType?: ReportingPeriodType = ReportingPeriodType.MONTH;

  @IsOptional()
  @IsString()
  tenantId?: string;

  @IsOptional()
  @IsString()
  timezone?: string = 'UTC';
}

export class PlanDistributionQueryDto {
  @IsOptional()
  @IsDateString()
  asOfDate?: string;

  @IsOptional()
  @IsString()
  tenantId?: string;
}

export class SubscriptionMovementQueryDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  tenantId?: string;

  @IsOptional()
  @IsString()
  timezone?: string = 'UTC';
}

// Response DTOs with explicit definitions

export class SubscriptionKpiResponseDto {
  period!: {
    type: string;
    startDate: string;
    endDate: string;
    timezone: string;
    label: string;
  };
  activeSubscriptions!: number; // Definition: subscriptions with status ACTIVE and currentPeriodEnd >= now
  trialSubscriptions!: number; // Definition: status TRIALING
  cancelledSubscriptions!: number; // Definition: status CANCELED
  expiredSubscriptions!: number; // Definition: status EXPIRED
  scheduledCancellations!: number; // Definition: cancelAtPeriodEnd = true and still active
  newSubscriptions!: number; // Definition: createdAt in period
  renewedSubscriptions!: number; // Definition: currentPeriodStart in period but not first creation
  churnedSubscriptions!: number; // Definition: canceledAt in period
  upgradedSubscriptions!: number; // Definition: metadata changeType = UPGRADE or audit log
  downgradedSubscriptions!: number; // Definition: metadata changeType = DOWNGRADE
  averageTenureDays!: number;
  averageSeats!: string;
  planDistribution!: { planId: string; planCode: string; planName: string; count: number; percentage: string }[];
  intervalDistribution!: { interval: string; count: number; percentage: string }[];
  statusDistribution!: { status: string; count: number; percentage: string }[];
  calculatedAt!: string;
}

export class ChurnResponseDto {
  period!: {
    type: string;
    startDate: string;
    endDate: string;
    timezone: string;
    label: string;
  };
  currency!: string;
  customerChurnCount!: number; // Definition: distinct tenants whose subscription ended in period and not renewed by period end
  customerChurnRate!: string; // Definition: churned customers / customers at start * 100
  subscriptionChurnCount!: number;
  subscriptionChurnRate!: string;
  voluntaryChurnCount!: number; // Definition: cancelReason present, not payment failure
  failedPaymentChurnCount!: number; // Definition: dunning case or cancelReason indicates payment failure
  expirationChurnCount!: number; // Definition: status EXPIRED
  logoChurnCount!: number; // Same as customer churn (tenant level)
  logoChurnRate!: string;
  revenueChurnAmount!: { amount: string; currency: string; minorUnit: number };
  revenueChurnRate!: string; // Definition: churned MRR / MRR at start * 100
  netRevenueRetention!: string;
  grossRevenueRetention!: string;
  totalCustomersStart!: number;
  totalCustomersEnd!: number;
  totalSubscriptionsStart!: number;
  totalSubscriptionsEnd!: number;
  methodology!: string;
  calculatedAt!: string;
}

export class RetentionResponseDto {
  period!: {
    type: string;
    startDate: string;
    endDate: string;
    timezone: string;
    label: string;
  };
  retentionRate!: string; // Definition: retained / start * 100
  churnRate!: string;
  retainedCount!: number;
  churnedCount!: number;
  startCount!: number;
  endCount!: number;
  methodology!: string;
}
