import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsBoolean, IsArray, IsObject, IsEnum } from 'class-validator';
import { BillingInterval } from '@wlct/shared-types';

export class PortalSubscriptionStateDto {
  @ApiPropertyOptional() id: string | null;
  @ApiProperty() tenantId: string;
  @ApiPropertyOptional() planId: string | null;
  @ApiPropertyOptional() planCode: string | null;
  @ApiPropertyOptional() planName: string | null;
  @ApiPropertyOptional() status: string | null;
  @ApiPropertyOptional({ enum: BillingInterval }) interval: BillingInterval | null;
  @ApiPropertyOptional() currentPeriodStart: string | null;
  @ApiPropertyOptional() currentPeriodEnd: string | null;
  @ApiPropertyOptional() trialEndsAt: string | null;
  @ApiProperty() cancelAtPeriodEnd: boolean;
  @ApiPropertyOptional() canceledAt: string | null;
  @ApiPropertyOptional() renewalDate: string | null;
  @ApiProperty() trialActive: boolean;
  @ApiProperty() isActive: boolean;
  @ApiProperty() isPastDue: boolean;
  @ApiProperty() isCanceled: boolean;
  @ApiProperty() isTrialing: boolean;
  @ApiProperty() willCancelAtPeriodEnd: boolean;
}

export class PortalCurrentPlanDto {
  @ApiProperty() id: string;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional() description: string | null;
  @ApiProperty() price: string;
  @ApiProperty() currency: string;
  @ApiProperty({ enum: BillingInterval }) interval: BillingInterval;
  @ApiProperty() trialDays: number;
  @ApiProperty() limits: Record<string, any>;
  @ApiProperty() features: string[];
  @ApiProperty() isActive: boolean;
  @ApiProperty() sortOrder: number;
}

export class PortalUsageItemDto {
  @ApiProperty() key: string;
  @ApiProperty() label: string;
  @ApiProperty() current: number;
  @ApiPropertyOptional() limit: number | null;
  @ApiPropertyOptional() remaining: number | null;
  @ApiProperty() unlimited: boolean;
  @ApiPropertyOptional() percentageUsed: number | null;
  @ApiProperty() scope: string;
}

export class PortalFeatureAvailabilityDto {
  @ApiProperty() key: string;
  @ApiProperty() label: string;
  @ApiProperty() included: boolean;
  @ApiProperty() source: string;
}

export class PortalUsageSummaryDto {
  @ApiProperty() tenantId: string;
  @ApiProperty({ type: [PortalUsageItemDto] }) items: PortalUsageItemDto[];
  @ApiProperty({ type: [PortalFeatureAvailabilityDto] }) features: PortalFeatureAvailabilityDto[];
  @ApiProperty() fetchedAt: string;
}

export class PortalInvoiceSummaryDto {
  @ApiProperty() id: string;
  @ApiProperty() invoiceNumber: string;
  @ApiProperty() status: string;
  @ApiProperty() issueDate: string;
  @ApiPropertyOptional() dueDate: string | null;
  @ApiProperty() currency: string;
  @ApiProperty() subtotal: string;
  @ApiProperty() discountTotal: string;
  @ApiProperty() taxTotal: string;
  @ApiProperty() total: string;
  @ApiProperty() amountPaid: string;
  @ApiProperty() amountDue: string;
  @ApiProperty() amountRefunded: string;
  @ApiPropertyOptional() billingPeriodStart: string | null;
  @ApiPropertyOptional() billingPeriodEnd: string | null;
  @ApiPropertyOptional() planCode: string | null;
  @ApiPropertyOptional() planName: string | null;
  @ApiProperty() pdfAvailable: boolean;
}

export class PortalPaymentSummaryDto {
  @ApiProperty() id: string;
  @ApiProperty() provider: string;
  @ApiProperty() status: string;
  @ApiProperty() amount: string;
  @ApiProperty() currency: string;
  @ApiPropertyOptional() planId: string | null;
  @ApiPropertyOptional() planCode: string | null;
  @ApiPropertyOptional() paidAt: string | null;
  @ApiPropertyOptional() failedAt: string | null;
  @ApiProperty() createdAt: string;
  @ApiPropertyOptional() checkoutUrl: string | null;
  @ApiPropertyOptional() invoiceUrl: string | null;
  @ApiProperty() hasInvoice: boolean;
}

export class PortalBillingCustomerDto {
  @ApiProperty() tenantId: string;
  @ApiProperty() billingName: string;
  @ApiProperty() billingEmail: string;
  @ApiProperty() billingCountry: string;
  @ApiPropertyOptional() billingCity: string | null;
  @ApiPropertyOptional() billingRegion: string | null;
  @ApiProperty() preferredCurrency: string;
  @ApiPropertyOptional() taxId: string | null;
  @ApiPropertyOptional() vatNumber: string | null;
  @ApiProperty() isBusinessCustomer: boolean;
  @ApiProperty() isTaxExempt: boolean;
}

export class BillingOverviewResponseDto {
  @ApiProperty() tenantId: string;
  @ApiProperty({ type: PortalSubscriptionStateDto }) subscription: PortalSubscriptionStateDto;
  @ApiPropertyOptional({ type: PortalCurrentPlanDto }) currentPlan: PortalCurrentPlanDto | null;
  @ApiProperty({ type: [PortalCurrentPlanDto] }) availablePlans: PortalCurrentPlanDto[];
  @ApiProperty({ type: PortalUsageSummaryDto }) usage: PortalUsageSummaryDto;
  @ApiPropertyOptional({ type: PortalInvoiceSummaryDto }) latestInvoice: PortalInvoiceSummaryDto | null;
  @ApiPropertyOptional({ type: PortalPaymentSummaryDto }) latestPayment: PortalPaymentSummaryDto | null;
  @ApiPropertyOptional({ type: PortalBillingCustomerDto }) billingCustomer: PortalBillingCustomerDto | null;
  @ApiProperty({ type: [String] }) availableActions: string[];
  @ApiProperty() fetchedAt: string;
}
