// # Responsibility: validate persisted report metadata without manufacturing generation/source proof; failed required reconciliation/persistence reads propagate and stored JSON/state are runtime-narrowed.
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { ReportState, GovernanceActionType } from './governance.types';
import { ComplianceReportService, reportMetadataFingerprint } from './compliance-report.service';
import { ComplianceReportTemplateService } from './compliance-report-template.service';
import { GovernanceAuditService } from './governance-audit.service';
import { GovernanceReconciliationService } from './governance-reconciliation.service';
import { GovernancePolicyService } from './governance-policy.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export interface ValidationResult {
  reportId: string; tenantId: string; isValid: boolean; validationStatus: 'PASSED' | 'FAILED' | 'PENDING';
  errors: Array<{ field: string; message: string; severity: 'ERROR' | 'WARNING' }>;
  warnings: Array<{ field: string; message: string }>;
  sourceCompleteness: boolean; reconciliationResolved: boolean; periodCompleteness: boolean; fingerprintValid: boolean;
  validatedAt: string; validator: string; correlationId: string; policyVersion: string; sourceReferencesChecked: string[];
}
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }

@Injectable()
export class ComplianceReportValidationService {
  private readonly logger = new Logger(ComplianceReportValidationService.name);
  constructor(
    private readonly reportService: ComplianceReportService,
    private readonly templateService: ComplianceReportTemplateService,
    private readonly audit: GovernanceAuditService,
    private readonly reconciliation: GovernanceReconciliationService,
    private readonly policyService: GovernancePolicyService,
    private readonly prisma: PrismaService,
  ) {}

  async validateReport(params: {
    tenantId: string; reportId: string; correlationId: string; validatorId: string; sourceAvailability?: Record<string, boolean>;
  }): Promise<ValidationResult> {
    const report = await this.reportService.getReport(params.tenantId, params.reportId);
    if (report.state !== ReportState.GENERATED && report.state !== ReportState.VALIDATING) {
      throw new BadRequestException('Validation requires a genuinely GENERATED/VALIDATING report; it cannot promote a DRAFT');
    }
    const template = this.templateService.getTemplate(report.reportType, report.jurisdiction);
    const errors: ValidationResult['errors'] = []; const warnings: ValidationResult['warnings'] = [];
    let sourceCompleteness = template.sourceSystems.length > 0;
    if (template.sourceSystems.length === 0) errors.push({ field: 'sourceProvenance', message: 'No authoritative source verifier configured', severity: 'ERROR' });
    for (const source of template.sourceSystems) {
      const hasReference = report.sourceReferences.some((reference) => reference.startsWith(`${source}:`));
      if (!hasReference) errors.push({ field: 'sourceReferences', message: `Missing required source ${source}`, severity: 'ERROR' });
      if (params.sourceAvailability?.[source] === false) errors.push({ field: 'sourceReferences', message: `Source ${source} declared unavailable`, severity: 'ERROR' });
      // A caller's Boolean and a reference prefix are assertions, not proof of an authoritative fetch for this tenant/period.
      // No source-provenance verifier is configured, so this required check stays unavailable rather than fabricating PASSED.
      errors.push({ field: 'sourceProvenance', message: `Authoritative source-provenance verifier not configured for ${source}`, severity: 'ERROR' });
      sourceCompleteness = false;
    }
    const start = new Date(report.periodStart); const end = new Date(report.periodEnd); const now = new Date();
    const periodCompleteness = Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()) && start < end && end <= now;
    if (!periodCompleteness) errors.push({ field: 'period', message: 'Report period must be valid, ordered and completed', severity: 'ERROR' });
    const mismatches = await this.reconciliation.listMismatches(params.tenantId, { reportId: report.id });
    const unresolved = mismatches.filter((mismatch) => mismatch.severity === 'HIGH' || mismatch.severity === 'CRITICAL');
    const reconciliationResolved = unresolved.length === 0;
    if (!reconciliationResolved) errors.push({ field: 'reconciliation', message: 'Required reconciliation contains unresolved high/critical mismatches', severity: 'ERROR' });
    const fingerprintValid = /^[a-f0-9]{64}$/.test(report.fingerprint) && report.fingerprint === reportMetadataFingerprint(report);
    if (!fingerprintValid) errors.push({ field: 'fingerprint', message: 'Metadata fingerprint mismatch', severity: 'ERROR' });
    if (!report.fileLocation || !report.fileHash || !/^[a-f0-9]{64}$/.test(report.fileHash)) {
      errors.push({ field: 'artifact', message: 'Real report artifact metadata is unavailable; metadata fingerprint is not file evidence', severity: 'ERROR' });
    }
    const fields: Record<string, unknown> = { ...report };
    for (const field of template.requiredFields) {
      const value = fields[field];
      if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) {
        errors.push({ field, message: 'Required report field missing', severity: 'ERROR' });
      }
    }
    if (!Number.isSafeInteger(report.recordCount) || report.recordCount < 0) errors.push({ field: 'recordCount', message: 'Invalid report record count', severity: 'ERROR' });
    if (!report.policyVersion || this.policyService.buildPolicy(params.tenantId, report.jurisdiction).policyVersion !== report.policyVersion) {
      errors.push({ field: 'policyVersion', message: 'Current report policy version is required', severity: 'ERROR' });
    }
    const isValid = errors.every((error) => error.severity !== 'ERROR') && sourceCompleteness && reconciliationResolved && periodCompleteness && fingerprintValid;
    const result: ValidationResult = { reportId: report.id, tenantId: report.tenantId, isValid, validationStatus: isValid ? 'PASSED' : 'FAILED',
      errors, warnings, sourceCompleteness, reconciliationResolved, periodCompleteness, fingerprintValid, validatedAt: now.toISOString(),
      validator: params.validatorId, correlationId: params.correlationId, policyVersion: report.policyVersion, sourceReferencesChecked: report.sourceReferences };
    await this.prisma.complianceReportValidation.create({ data: { id: randomUUID(), reportId: report.id, tenantId: report.tenantId, isValid,
      validationStatus: result.validationStatus, errors: this.errorJson(errors), warnings: this.warningJson(warnings),
      sourceCompleteness, reconciliationResolved, periodCompleteness, fingerprintValid, validatedAt: now, validator: params.validatorId,
      correlationId: params.correlationId, policyVersion: report.policyVersion, sourceReferencesChecked: report.sourceReferences } });
    await this.reportService.updateValidationStatus(params.tenantId, report.id, result.validationStatus, params.correlationId);
    if (report.state === ReportState.GENERATED) await this.reportService.transitionState({ tenantId: params.tenantId, reportId: report.id,
      targetState: ReportState.VALIDATING, correlationId: params.correlationId, operatorId: params.validatorId });
    await this.reportService.transitionState({ tenantId: params.tenantId, reportId: report.id,
      targetState: isValid ? ReportState.READY : ReportState.VALIDATION_FAILED, correlationId: params.correlationId, operatorId: params.validatorId,
      reason: isValid ? undefined : errors.map((error) => error.message).join('; ') });
    await this.audit.recordEvent({ tenantId: params.tenantId, actionType: GovernanceActionType.REPORT_VALIDATE, reportId: report.id,
      state: result.validationStatus, result: result.validationStatus, correlationId: params.correlationId, createdBy: params.validatorId,
      safeEvidence: { isValid, errorCount: errors.length, sourceCompleteness, reconciliationResolved, periodCompleteness, fingerprintValid } });
    this.logger.log(`Report validation persisted id=${report.id} valid=${isValid}`);
    return result;
  }

  async getValidation(tenantId: string, reportId: string): Promise<ValidationResult | null> {
    const row = await this.prisma.complianceReportValidation.findFirst({ where: { reportId, tenantId }, orderBy: { validatedAt: 'desc' } });
    if (!row) return null;
    this.policyService.assertTenantIsolation(tenantId, row.tenantId);
    const validationStatus = ['PASSED', 'FAILED', 'PENDING'].find((status): status is ValidationResult['validationStatus'] => status === row.validationStatus);
    if (!validationStatus) throw new Error('Malformed persisted validation status');
    const errors = this.parseErrors(row.errors); const warnings = this.parseWarnings(row.warnings);
    if (row.isValid !== (validationStatus === 'PASSED') || (row.isValid && (!row.sourceCompleteness || !row.reconciliationResolved
      || !row.periodCompleteness || !row.fingerprintValid || errors.some((error) => error.severity === 'ERROR')))) throw new Error('Inconsistent persisted validation evidence');
    return { ...row, validationStatus, errors, warnings, validatedAt: row.validatedAt.toISOString(), sourceReferencesChecked: row.sourceReferencesChecked };
  }

  private parseErrors(value: unknown): ValidationResult['errors'] {
    if (!Array.isArray(value)) throw new Error('Malformed persisted validation errors');
    const entries: unknown[] = value;
    return entries.map((entry) => {
      if (!record(entry) || typeof entry.field !== 'string' || typeof entry.message !== 'string' || (entry.severity !== 'ERROR' && entry.severity !== 'WARNING')) throw new Error('Malformed persisted validation error entry');
      return { field: entry.field, message: entry.message, severity: entry.severity };
    });
  }
  private parseWarnings(value: unknown): ValidationResult['warnings'] {
    if (!Array.isArray(value)) throw new Error('Malformed persisted validation warnings');
    const entries: unknown[] = value;
    return entries.map((entry) => {
      if (!record(entry) || typeof entry.field !== 'string' || typeof entry.message !== 'string') throw new Error('Malformed persisted validation warning entry');
      return { field: entry.field, message: entry.message };
    });
  }
  private errorJson(errors: ValidationResult['errors']): Prisma.InputJsonArray { return errors.map((error) => ({ ...error })); }
  private warningJson(warnings: ValidationResult['warnings']): Prisma.InputJsonArray { return warnings.map((warning) => ({ ...warning })); }
}
