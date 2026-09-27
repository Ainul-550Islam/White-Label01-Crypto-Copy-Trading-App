import { IsOptional, IsString, IsDateString, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { ReportingPeriodType } from '../revenue-analytics.types';

/**
 * Safe customer analytics DTOs for tenant/admin reporting without exposing secrets or unrelated tenant data.
 */

export class CustomerAnalyticsQueryDto {
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
  tenantId?: string; // Platform admin can query specific tenant, tenant users auto-scoped

  @IsOptional()
  @IsString()
  timezone?: string = 'UTC';
}

export class TopCustomersQueryDto {
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
  @Type(() => Number)
  limit?: number = 20;

  @IsOptional()
  @IsString()
  timezone?: string = 'UTC';
}

export class ArpuQueryDto {
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
  timezone?: string = 'UTC';
}

// Response DTOs - safe, no secrets

export class CustomerValueResponseDto {
  tenantId!: string; // Safe reference, authorized scope only
  customerId?: string;
  period!: {
    type: string;
    startDate: string;
    endDate: string;
    timezone: string;
    label: string;
  };
  currency!: string;
  currentMrr!: { amount: string; currency: string; minorUnit: number };
  currentArr!: { amount: string; currency: string; minorUnit: number };
  totalPaid!: { amount: string; currency: string; minorUnit: number }; // ACTUAL from payments
  totalRefunded!: { amount: string; currency: string; minorUnit: number }; // ACTUAL
  netPaid!: { amount: string; currency: string; minorUnit: number }; // ACTUAL
  recurringValue!: { amount: string; currency: string; minorUnit: number };
  averageMonthlyValue!: { amount: string; currency: string; minorUnit: number };
  tenureDays!: number;
  subscriptionCount!: number;
  activeSubscription!: boolean;
  currentPlanId?: string;
  currentPlanCode?: string;
  planHistory!: { planId: string; planCode: string; from: string; to?: string }[];
  estimationType!: 'ACTUAL' | 'ESTIMATED'; // Clearly distinguish
  lifetimeValueInput!: { amount: string; currency: string; minorUnit: number }; // ESTIMATED input, not definitive LTV
  segment?: string; // Safe segmentation, no sensitive data
  calculatedAt!: string;
}

export class TopCustomerResponseDto {
  tenantId!: string;
  totalPaid!: { amount: string; currency: string; minorUnit: number };
  currentMrr!: { amount: string; currency: string; minorUnit: number };
  tenureDays!: number;
  planCode?: string;
}

export class ArpuResponseDto {
  currency!: string;
  arpu!: { amount: string; currency: string; minorUnit: number };
  totalRevenueMinor!: number;
  customerCount!: number;
  methodology!: string;
  calculatedAt!: string;
}
