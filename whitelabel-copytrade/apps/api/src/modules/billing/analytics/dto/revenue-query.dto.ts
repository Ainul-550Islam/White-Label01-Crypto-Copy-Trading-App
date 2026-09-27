import { IsOptional, IsString, IsEnum, IsDateString, IsBoolean, IsArray, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { ReportingPeriodType, CohortDefinition, BillingInterval } from '../revenue-analytics.types';

/**
 * Validated analytics query DTOs: period, tenant scope where authorized, currency, plan, interval, cohort, and comparison options.
 * No arbitrary internal DB filters.
 */

export class RevenueQueryDto {
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
  planId?: string;

  @IsOptional()
  @IsString()
  planCode?: string;

  @IsOptional()
  @IsEnum(BillingInterval)
  billingInterval?: BillingInterval;

  @IsOptional()
  @IsString()
  tenantId?: string; // Only allowed for platform admin

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  includeComparison?: boolean = false;

  @IsOptional()
  @IsDateString()
  comparisonStartDate?: string;

  @IsOptional()
  @IsDateString()
  comparisonEndDate?: string;

  @IsOptional()
  @IsString()
  timezone?: string = 'UTC';

  @IsOptional()
  @IsEnum(CohortDefinition)
  cohortDefinition?: CohortDefinition;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  includeTrials?: boolean = false;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  multiCurrency?: boolean = false;
}

export class MrrQueryDto {
  @IsOptional()
  @IsString()
  currency?: string = 'USD';

  @IsOptional()
  @IsString()
  tenantId?: string;

  @IsOptional()
  @IsDateString()
  asOfDate?: string;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  includeTrials?: boolean = false;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  includeLifetimeAsRecurring?: boolean = false;
}

export class ArrQueryDto {
  @IsOptional()
  @IsString()
  currency?: string = 'USD';

  @IsOptional()
  @IsString()
  tenantId?: string;

  @IsOptional()
  @IsDateString()
  asOfDate?: string;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  includeTrials?: boolean = false;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  includeLifetimeAsRecurring?: boolean = false;
}

export class CashflowQueryDto {
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

export class BillingHealthQueryDto {
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

export class CohortQueryDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  currency?: string = 'USD';

  @IsOptional()
  @IsEnum(CohortDefinition)
  cohortDefinition?: CohortDefinition = CohortDefinition.FIRST_SUBSCRIPTION_MONTH;

  @IsOptional()
  @IsString()
  tenantId?: string;

  @Type(() => Number)
  @IsOptional()
  retentionPeriods?: number = 12;

  @IsOptional()
  @IsString()
  timezone?: string = 'UTC';
}

export class ReconciliationQueryDto {
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

export class PlanPerformanceQueryDto {
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
  planId?: string;

  @IsOptional()
  @IsString()
  timezone?: string = 'UTC';

  @IsOptional()
  @Type(() => Number)
  limit?: number = 20;
}

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
  tenantId?: string; // For platform admin to query specific tenant

  @IsOptional()
  @IsString()
  timezone?: string = 'UTC';

  @IsOptional()
  @Type(() => Number)
  limit?: number = 20;
}
