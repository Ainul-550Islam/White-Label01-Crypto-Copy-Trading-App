import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { RedisModule } from '../../infrastructure/redis/redis.module';
import { CompliancePolicyService } from './compliance-policy.service';
import { IdentityVerificationService } from './identity-verification.service';
import { KycProviderFactory } from './kyc-provider.factory';
import { AmlScreeningService } from './aml-screening.service';
import { AmlProviderFactory } from './aml-provider.factory';
import { RiskScoringService } from './risk-scoring.service';
import { TransactionMonitoringService } from './transaction-monitoring.service';
import { ComplianceCaseService } from './compliance-case.service';
import { ComplianceCaseRepository } from './compliance-case.repository';
import { ComplianceAuditService } from './compliance-audit.service';
import { ComplianceReconciliationService } from './compliance-reconciliation.service';
import { ComplianceController } from './compliance.controller';

/**
 * Compliance Control Plane module integrating existing auth/RBAC/tenant/billing/payment/subscription/enforcement/finance/usage/notifications/SaaS admin/audit/trading architecture
 * No second identity/tenant/permission/payment source, compliance never directly rewrite financial history, KYC/AML behind provider-neutral interfaces
 * Idempotent screening/case/decision/hold/release, auditable, provider outage tolerant
 */
@Module({
  imports: [PrismaModule, RedisModule],
  providers: [
    CompliancePolicyService,
    KycProviderFactory,
    AmlProviderFactory,
    ComplianceAuditService,
    ComplianceCaseRepository,
    IdentityVerificationService,
    AmlScreeningService,
    RiskScoringService,
    TransactionMonitoringService,
    ComplianceCaseService,
    ComplianceReconciliationService,
  ],
  controllers: [ComplianceController],
  exports: [
    CompliancePolicyService,
    IdentityVerificationService,
    AmlScreeningService,
    RiskScoringService,
    TransactionMonitoringService,
    ComplianceCaseService,
    ComplianceCaseRepository,
    ComplianceAuditService,
    ComplianceReconciliationService,
    KycProviderFactory,
    AmlProviderFactory,
  ],
})
export class ComplianceModule {}
