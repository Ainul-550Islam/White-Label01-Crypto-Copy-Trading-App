import { IsOptional, IsString, IsEnum, IsDateString } from 'class-validator';
import { ReportingPeriodType } from '../revenue-analytics.types';

/**
 * Financial report DTOs: revenue, cashflow, refunds, tax, fees, receivables, and net amounts with source/period references.
 * All amounts returned as safe decimal strings.
 */

export class FinancialReportQueryDto {
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
  tenantId?: string; // Platform admin only

  @IsOptional()
  @IsString()
  timezone?: string = 'UTC';

  @IsOptional()
  @IsString()
  planId?: string;

  @IsOptional()
  @IsString()
  includeComparison?: string; // boolean as string for query

  @IsOptional()
  @IsDateString()
  comparisonStartDate?: string;

  @IsOptional()
  @IsDateString()
  comparisonEndDate?: string;
}

export class RevenueReportQueryDto {
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

export class CashflowReportQueryDto {
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

// Response DTOs

export class MoneyAmountDto {
  amount!: string; // Decimal-safe string
  currency!: string;
  minorUnit!: number;
}

export class FinancialReportResponseDto {
  period!: {
    type: string;
    startDate: string;
    endDate: string;
    timezone: string;
    label: string;
  };
  currency!: string;
  grossRevenue!: MoneyAmountDto;
  netRevenue!: MoneyAmountDto;
  recurringRevenue!: MoneyAmountDto;
  oneTimeRevenue!: MoneyAmountDto;
  cashCollected!: MoneyAmountDto;
  refunds!: MoneyAmountDto;
  taxes!: MoneyAmountDto;
  fees!: MoneyAmountDto;
  platformFees!: MoneyAmountDto;
  performanceFees!: MoneyAmountDto;
  receivables!: MoneyAmountDto;
  outstanding!: MoneyAmountDto;
  mrr!: MoneyAmountDto;
  arr!: MoneyAmountDto;
  arpu!: MoneyAmountDto;
  customerCount!: number;
  activeSubscriptions!: number;
  sourceReferences!: {
    invoiceIds: string[];
    paymentIds: string[];
    refundIds: string[];
    subscriptionIds: string[];
  };
  methodology!: string;
  calculatedAt!: string;
  comparison?: {
    previousPeriod: {
      type: string;
      startDate: string;
      endDate: string;
      timezone: string;
      label: string;
    };
    grossRevenueChange: string;
    netRevenueChange: string;
    mrrChange: string;
  };
}

export class CashflowResponseDto {
  period!: {
    type: string;
    startDate: string;
    endDate: string;
    timezone: string;
    label: string;
  };
  currency!: string;
  collectedCash!: MoneyAmountDto;
  successfulPaymentAmount!: MoneyAmountDto;
  failedPaymentAmount!: MoneyAmountDto;
  pendingPaymentAmount!: MoneyAmountDto;
  refunds!: MoneyAmountDto;
  netCash!: MoneyAmountDto;
  outstandingInvoicesAmount!: MoneyAmountDto;
  dunningExposure!: MoneyAmountDto;
  feePayouts!: MoneyAmountDto;
  taxCollected!: MoneyAmountDto;
  grossCashIn!: MoneyAmountDto;
  grossCashOut!: MoneyAmountDto;
  source!: {
    paymentCount: number;
    invoiceCount: number;
    refundCount: number;
  };
  calculatedAt!: string;
}

export class BillingHealthResponseDto {
  period!: {
    type: string;
    startDate: string;
    endDate: string;
    timezone: string;
    label: string;
  };
  currency!: string;
  totalPayments!: number;
  successfulPayments!: number;
  failedPayments!: number;
  pendingPayments!: number;
  paymentSuccessRate!: string; // percent
  paymentFailureRate!: string;
  pendingRate!: string;
  totalInvoices!: number;
  paidInvoices!: number;
  overdueInvoices!: number;
  outstandingInvoices!: number;
  overdueRate!: string;
  totalRefunds!: number;
  refundRate!: string;
  refundAmount!: MoneyAmountDto;
  openDunningCases!: number;
  recoveredDunningCases!: number;
  failedDunningCases!: number;
  dunningRecoveryRate!: string;
  averagePaymentProcessingDurationMs?: number;
  checkoutConversionRate?: string;
  calculatedAt!: string;
}
