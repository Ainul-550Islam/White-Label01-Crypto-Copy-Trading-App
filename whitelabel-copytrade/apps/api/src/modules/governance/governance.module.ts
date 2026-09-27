import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GovernancePolicyService } from './governance-policy.service';
import { DataClassificationService } from './data-classification.service';
import { DataInventoryService } from './data-inventory.service';
import { PrivacyRequestService } from './privacy-request.service';
import { PrivacyDiscoveryService } from './privacy-discovery.service';
import { PrivacyExportService } from './privacy-export.service';
import { PrivacyDeletionService } from './privacy-deletion.service';
import { RetentionPolicyService } from './retention-policy.service';
import { RetentionEngineService } from './retention-engine.service';
import { LegalHoldService } from './legal-hold.service';
import { ConsentService } from './consent.service';
import { ComplianceReportService } from './compliance-report.service';
import { ComplianceReportTemplateService } from './compliance-report-template.service';
import { ComplianceReportValidationService } from './compliance-report-validation.service';
import { ComplianceReportCertificationService } from './compliance-report-certification.service';
import { ComplianceReportDeliveryService } from './compliance-report-delivery.service';
import { EvidencePackageService } from './evidence-package.service';
import { GovernanceAuditService } from './governance-audit.service';
import { GovernanceAuditExportService } from './governance-audit-export.service';
import { GovernanceReconciliationService } from './governance-reconciliation.service';
import { GovernanceMetricsService } from './governance-metrics.service';
import { GovernanceActionService } from './governance-action.service';
import { GovernanceReportQueryService } from './governance-report-query.service';
import { GovernanceController } from './governance.controller';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

@Module({
  imports: [ConfigModule],
  controllers: [GovernanceController],
  providers: [
    PrismaService,
    GovernancePolicyService,
    DataClassificationService,
    DataInventoryService,
    GovernanceAuditService,
    GovernanceActionService,
    PrivacyRequestService,
    PrivacyDiscoveryService,
    PrivacyExportService,
    LegalHoldService,
    RetentionPolicyService,
    RetentionEngineService,
    PrivacyDeletionService,
    ConsentService,
    ComplianceReportTemplateService,
    ComplianceReportService,
    GovernanceReconciliationService,
    ComplianceReportValidationService,
    ComplianceReportCertificationService,
    ComplianceReportDeliveryService,
    EvidencePackageService,
    GovernanceAuditExportService,
    GovernanceMetricsService,
    GovernanceReportQueryService,
  ],
  exports: [
    GovernancePolicyService,
    DataClassificationService,
    DataInventoryService,
    PrivacyRequestService,
    PrivacyDiscoveryService,
    PrivacyExportService,
    PrivacyDeletionService,
    RetentionPolicyService,
    RetentionEngineService,
    LegalHoldService,
    ConsentService,
    ComplianceReportService,
    ComplianceReportTemplateService,
    ComplianceReportValidationService,
    ComplianceReportCertificationService,
    ComplianceReportDeliveryService,
    EvidencePackageService,
    GovernanceAuditService,
    GovernanceAuditExportService,
    GovernanceReconciliationService,
    GovernanceMetricsService,
    GovernanceActionService,
    GovernanceReportQueryService,
  ],
})
export class GovernanceModule {}
