import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PartnerPolicyService } from './partner-policy.service';
import { PartnerProfileService } from './partner-profile.service';
import { PartnerAgreementService } from './partner-agreement.service';
import { PartnerTenantService } from './partner-tenant.service';
import { PartnerUserService } from './partner-user.service';
import { PartnerPlanService } from './partner-plan.service';
import { PartnerPricingService } from './partner-pricing.service';
import { PartnerDiscountService } from './partner-discount.service';
import { PartnerReferralService } from './partner-referral.service';
import { PartnerAttributionService } from './partner-attribution.service';
import { PartnerCommissionService } from './partner-commission.service';
import { PartnerCommissionLedgerService } from './partner-commission-ledger.service';
import { PartnerPayoutService } from './partner-payout.service';
import { PartnerInvoiceService } from './partner-invoice.service';
import { PartnerSettlementService } from './partner-settlement.service';
import { PartnerUsageService } from './partner-usage.service';
import { PartnerPerformanceService } from './partner-performance.service';
import { PartnerAnalyticsService } from './partner-analytics.service';
import { PartnerReconciliationService } from './partner-reconciliation.service';
import { PartnerAuditService } from './partner-audit.service';
import { PartnerPortalService } from './partner-portal.service';
import { PartnerController } from './partner.controller';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

@Module({
  imports: [ConfigModule],
  controllers: [PartnerController],
  providers: [
    PrismaService,
    PartnerPolicyService,
    PartnerAuditService,
    PartnerProfileService,
    PartnerAgreementService,
    PartnerTenantService,
    PartnerUserService,
    PartnerPlanService,
    PartnerPricingService,
    PartnerDiscountService,
    PartnerReferralService,
    PartnerAttributionService,
    PartnerCommissionService,
    PartnerCommissionLedgerService,
    PartnerReconciliationService,
    PartnerSettlementService,
    PartnerPayoutService,
    PartnerInvoiceService,
    PartnerUsageService,
    PartnerPerformanceService,
    PartnerAnalyticsService,
    PartnerPortalService,
  ],
  exports: [
    PartnerPolicyService,
    PartnerProfileService,
    PartnerAgreementService,
    PartnerTenantService,
    PartnerUserService,
    PartnerPlanService,
    PartnerPricingService,
    PartnerDiscountService,
    PartnerReferralService,
    PartnerAttributionService,
    PartnerCommissionService,
    PartnerCommissionLedgerService,
    PartnerPayoutService,
    PartnerInvoiceService,
    PartnerSettlementService,
    PartnerUsageService,
    PartnerPerformanceService,
    PartnerAnalyticsService,
    PartnerReconciliationService,
    PartnerAuditService,
    PartnerPortalService,
  ],
})
export class PartnerModule {}
