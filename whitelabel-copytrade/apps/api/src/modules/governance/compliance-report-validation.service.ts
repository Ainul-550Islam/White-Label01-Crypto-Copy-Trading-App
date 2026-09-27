import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ComplianceReport, ReportState, GovernanceActionType } from './governance.types';
import { ComplianceReportService } from './compliance-report.service';
import { ComplianceReportTemplateService } from './compliance-report-template.service';
import { GovernanceAuditService } from './governance-audit.service';
import { GovernanceReconciliationService } from './governance-reconciliation.service';
import { GovernancePolicyService } from './governance-policy.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export interface ValidationResult {
  reportId: string;
  tenantId: string;
  isValid: boolean;
  validationStatus: 'PASSED' | 'FAILED' | 'PENDING';
  errors: Array<{ field: string; message: string; severity: 'ERROR' | 'WARNING' }>;
  warnings: Array<{ field: string; message: string }>;
  sourceCompleteness: boolean;
  reconciliationResolved: boolean;
  periodCompleteness: boolean;
  fingerprintValid: boolean;
  validatedAt: string;
  validator: string;
  correlationId: string;
  policyVersion: string;
  sourceReferencesChecked: string[];
}

@Injectable()
export class ComplianceReportValidationService {
  private readonly logger = new Logger(ComplianceReportValidationService.name);
  private readonly inMemory: Map<string, ValidationResult> = new Map();

  constructor(
    private readonly reportService: ComplianceReportService,
    private readonly templateService: ComplianceReportTemplateService,
    private readonly audit: GovernanceAuditService,
    private readonly reconciliation: GovernanceReconciliationService,
    private readonly policyService: GovernancePolicyService,
    private readonly prisma: PrismaService,
  ) {}

  async validateReport(params: {
    tenantId: string;
    reportId: string;
    correlationId: string;
    validatorId: string;
    sourceAvailability?: Record<string, boolean>;
  }): Promise<ValidationResult> {
    const report = await this.reportService.getReport(params.tenantId, params.reportId);
    if (report.state !== ReportState.GENERATED && report.state !== ReportState.VALIDATING && report.state !== ReportState.VALIDATION_FAILED) {
      // Allow transition to VALIDATING first
      if (report.state === ReportState.DRAFT) {
        await this.reportService.transitionState({
          tenantId: params.tenantId,
          reportId: report.id,
          targetState: ReportState.GENERATING,
          correlationId: params.correlationId,
          operatorId: params.validatorId,
        });
        await this.reportService.transitionState({
          tenantId: params.tenantId,
          reportId: report.id,
          targetState: ReportState.GENERATED,
          correlationId: params.correlationId,
          operatorId: params.validatorId,
        });
      }
    }

    const template = this.templateService.getTemplate(report.reportType, report.jurisdiction);
    const errors: ValidationResult['errors'] = [];
    const warnings: ValidationResult['warnings'] = [];

    // Source completeness
    let sourceCompleteness = true;
    for (const requiredSource of template.sourceSystems) {
      const available = params.sourceAvailability ? params.sourceAvailability[requiredSource] : undefined;
      const hasRef = report.sourceReferences.some((ref) => ref.startsWith(requiredSource + ':'));
      if (!hasRef) {
        errors.push({ field: 'sourceReferences', message: `missing required source ${requiredSource}`, severity: 'ERROR' });
        sourceCompleteness = false;
      } else if (available === false) {
        errors.push({ field: 'sourceReferences', message: `source ${requiredSource} marked unavailable`, severity: 'ERROR' });
        sourceCompleteness = false;
      }
    }

    // Period completeness - timezone-safe
    let periodCompleteness = true;
    try {
      const start = new Date(report.periodStart);
      const end = new Date(report.periodEnd);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        errors.push({ field: 'period', message: 'invalid period dates', severity: 'ERROR' });
        periodCompleteness = false;
      } else if (start >= end) {
        errors.push({ field: 'period', message: 'periodStart must be before periodEnd', severity: 'ERROR' });
        periodCompleteness = false;
      } else {
        // Check period is not in future and is complete (end <= now)
        const now = new Date();
        if (end > now) {
          warnings.push({ field: 'period', message: 'periodEnd is in future, report may be incomplete' });
          periodCompleteness = false;
        }
      }
    } catch {
      errors.push({ field: 'period', message: 'period validation failed', severity: 'ERROR' });
      periodCompleteness = false;
    }

    // Reconciliation check
    const mismatches = await this.reconciliation.listMismatches(params.tenantId, { reportId: report.id });
    const unresolved = mismatches.filter((m) => m.severity === 'HIGH' || m.severity === 'CRITICAL');
    let reconciliationResolved = true;
    if (unresolved.length > 0) {
      errors.push({ field: 'reconciliation', message: `${unresolved.length} unresolved reconciliation mismatch(es)`, severity: 'ERROR' });
      reconciliationResolved = false;
    }

    // Fingerprint deterministic check
    let fingerprintValid = true;
    if (!report.fingerprint || report.fingerprint.length < 32) {
      errors.push({ field: 'fingerprint', message: 'missing or invalid fingerprint', severity: 'ERROR' });
      fingerprintValid = false;
    }

    // Required fields
    for (const field of template.requiredFields) {
      const value = (report as any)[field] ?? (field === 'tenantId' ? report.tenantId : undefined);
      if (field === 'sourceReferences' && (!report.sourceReferences || report.sourceReferences.length === 0)) {
        errors.push({ field, message: `required field ${field} missing`, severity: 'ERROR' });
      } else if (field !== 'sourceReferences' && !value) {
        // Allow recordCount 0
        if (field === 'recordCount' && report.recordCount === 0) continue;
        if (!value) {
          errors.push({ field, message: `required field ${field} missing`, severity: 'ERROR' });
        }
      }
    }

    // Policy version check
    if (!report.policyVersion) {
      errors.push({ field: 'policyVersion', message: 'policyVersion missing', severity: 'ERROR' });
    }

    const isValid = errors.filter((e) => e.severity === 'ERROR').length === 0;
    const result: ValidationResult = {
      reportId: report.id,
      tenantId: report.tenantId,
      isValid,
      validationStatus: isValid ? 'PASSED' : 'FAILED',
      errors,
      warnings,
      sourceCompleteness,
      reconciliationResolved,
      periodCompleteness,
      fingerprintValid,
      validatedAt: new Date().toISOString(),
      validator: params.validatorId,
      correlationId: params.correlationId,
      policyVersion: report.policyVersion,
      sourceReferencesChecked: report.sourceReferences,
    };

    this.inMemory.set(report.id, result);
    try {
      await (this.prisma as any).complianceReportValidation?.create?.({
        data: {
          id: `val_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          reportId: report.id,
          tenantId: report.tenantId,
          isValid,
          validationStatus: result.validationStatus,
          errors: errors as any,
          warnings: warnings as any,
          sourceCompleteness,
          reconciliationResolved,
          periodCompleteness,
          fingerprintValid,
          validatedAt: new Date(result.validatedAt),
          validator: params.validatorId,
          correlationId: params.correlationId,
          policyVersion: report.policyVersion,
        },
      });
    } catch {
      this.logger.debug(`validation persist skipped reportId=${report.id}`);
    }

    await this.reportService.updateValidationStatus(params.tenantId, report.id, result.validationStatus, params.correlationId);

    if (isValid) {
      await this.reportService.transitionState({
        tenantId: params.tenantId,
        reportId: report.id,
        targetState: ReportState.VALIDATING,
        correlationId: params.correlationId,
        operatorId: params.validatorId,
      });
      await this.reportService.transitionState({
        tenantId: params.tenantId,
        reportId: report.id,
        targetState: ReportState.READY,
        correlationId: params.correlationId,
        operatorId: params.validatorId,
      });
    } else {
      // If not already VALIDATING, transition
      try {
        const current = await this.reportService.getReport(params.tenantId, report.id);
        if (current.state === ReportState.GENERATED) {
          await this.reportService.transitionState({
            tenantId: params.tenantId,
            reportId: report.id,
            targetState: ReportState.VALIDATING,
            correlationId: params.correlationId,
            operatorId: params.validatorId,
          });
        }
        await this.reportService.transitionState({
          tenantId: params.tenantId,
          reportId: report.id,
          targetState: ReportState.VALIDATION_FAILED,
          correlationId: params.correlationId,
          operatorId: params.validatorId,
          reason: errors.map((e) => e.message).join('; '),
        });
      } catch (e) {
        this.logger.warn(`validation transition failed reportId=${report.id} err=${(e as Error).message}`);
      }
    }

    await this.audit.recordEvent({
      tenantId: params.tenantId,
      actionType: GovernanceActionType.REPORT_VALIDATE,
      reportId: report.id,
      state: result.validationStatus,
      result: result.validationStatus,
      correlationId: params.correlationId,
      createdBy: params.validatorId,
      safeEvidence: { isValid, errors: errors.length, warnings: warnings.length, sourceCompleteness, reconciliationResolved },
    });

    this.logger.log(`report validated id=${report.id} valid=${isValid} corr=${params.correlationId}`);
    return result;
  }

  async getValidation(tenantId: string, reportId: string): Promise<ValidationResult | null> {
    const mem = this.inMemory.get(reportId);
    if (mem) {
      this.policyService.assertTenantIsolation(tenantId, mem.tenantId);
      return mem;
    }
    try {
      const row = await (this.prisma as any).complianceReportValidation?.findFirst?.({ where: { reportId, tenantId }, orderBy: { validatedAt: 'desc' } });
      if (row) {
        return {
          reportId: row.reportId,
          tenantId: row.tenantId,
          isValid: row.isValid,
          validationStatus: row.validationStatus,
          errors: row.errors ?? [],
          warnings: row.warnings ?? [],
          sourceCompleteness: row.sourceCompleteness,
          reconciliationResolved: row.reconciliationResolved,
          periodCompleteness: row.periodCompleteness,
          fingerprintValid: row.fingerprintValid,
          validatedAt: row.validatedAt instanceof Date ? row.validatedAt.toISOString() : row.validatedAt,
          validator: row.validator,
          correlationId: row.correlationId,
          policyVersion: row.policyVersion,
          sourceReferencesChecked: row.sourceReferencesChecked ?? [],
        };
      }
    } catch {
      /* ignore */
    }
    return null;
  }
}
