// # Responsibility: persist native tenant-bound certification requests/decisions before report advancement; required reads/writes never substitute process memory for durable evidence.
import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { type ComplianceReportCertification, type Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { CertificationState, ReportState, GovernanceActionType } from './governance.types';
import { ComplianceReportService } from './compliance-report.service';
import { ComplianceReportValidationService, type ValidationResult } from './compliance-report-validation.service';
import { GovernancePolicyService } from './governance-policy.service';
import { GovernanceAuditService } from './governance-audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export interface CertificationRecord {
  id: string; tenantId: string; reportId: string; state: CertificationState; reviewerId: string; reviewerRole: string;
  fingerprint: string; validationEvidence: string; comments?: string | null; createdAt: string; updatedAt: string;
  correlationId: string; policyVersion: string;
}

@Injectable()
export class ComplianceReportCertificationService {
  private readonly logger = new Logger(ComplianceReportCertificationService.name);
  constructor(
    private readonly reportService: ComplianceReportService,
    private readonly validationService: ComplianceReportValidationService,
    private readonly policyService: GovernancePolicyService,
    private readonly audit: GovernanceAuditService,
    private readonly prisma: PrismaService,
  ) {}

  async requestCertification(params: { tenantId: string; reportId: string; correlationId: string; requesterId: string }): Promise<CertificationRecord> {
    const report = await this.reportService.getReport(params.tenantId, params.reportId);
    if (this.policyService.buildPolicy(params.tenantId, report.jurisdiction).policyVersion !== report.policyVersion) throw new BadRequestException('Report policy version is stale; current revalidation required');
    if (report.state !== ReportState.READY) throw new BadRequestException('Report must be READY for certification');
    const validation = await this.validationService.getValidation(params.tenantId, params.reportId);
    this.assertValidation(validation, report.policyVersion, report.sourceReferences);
    const now = new Date();
    const row = await this.prisma.complianceReportCertification.create({ data: { id: randomUUID(), tenantId: params.tenantId,
      reportId: report.id, state: CertificationState.PENDING, fingerprint: report.fingerprint,
      validationEvidence: `${validation.validationStatus}:${validation.validatedAt}`, correlationId: params.correlationId,
      policyVersion: report.policyVersion, createdAt: now, updatedAt: now } });
    await this.reportService.transitionState({ tenantId: params.tenantId, reportId: report.id, targetState: ReportState.PENDING_CERTIFICATION,
      correlationId: params.correlationId, operatorId: params.requesterId });
    this.logger.log(`Certification requested id=${row.id} report=${report.id}`);
    return this.mapRow(row);
  }

  async certifyReport(params: {
    tenantId: string; reportId: string; certificationId: string; reviewerId: string; reviewerRole: string;
    decision: 'APPROVED' | 'REJECTED' | 'REWORK_REQUIRED'; comments?: string; correlationId: string;
  }): Promise<CertificationRecord> {
    const reviewerRole = params.reviewerRole.toUpperCase();
    if (!params.reviewerId || !['ADMIN', 'COMPLIANCE', 'FINANCE', 'LEGAL', 'AUDIT'].includes(reviewerRole)) throw new BadRequestException('Authorized reviewer identity/role required');
    const report = await this.reportService.getReport(params.tenantId, params.reportId);
    if (this.policyService.buildPolicy(params.tenantId, report.jurisdiction).policyVersion !== report.policyVersion) throw new BadRequestException('Report policy version is stale; current revalidation required');
    if (report.state !== ReportState.PENDING_CERTIFICATION) throw new BadRequestException('Report must be PENDING_CERTIFICATION');
    if (params.reviewerId === report.createdBy) throw new BadRequestException('Report certification requires an independent reviewer');
    const existing = await this.getCertification(params.tenantId, params.certificationId);
    if (existing.reportId !== report.id || existing.state !== CertificationState.PENDING) throw new BadRequestException('Pending certification must match the report');
    const validation = await this.validationService.getValidation(params.tenantId, params.reportId);
    this.assertValidation(validation, report.policyVersion, report.sourceReferences);
    if (existing.fingerprint !== report.fingerprint || existing.policyVersion !== report.policyVersion) throw new BadRequestException('Report fingerprint/policy changed after request');
    let state: CertificationState; let targetState: ReportState;
    switch (params.decision) {
      case 'APPROVED': state = CertificationState.APPROVED; targetState = ReportState.CERTIFIED; break;
      case 'REJECTED': state = CertificationState.REJECTED; targetState = ReportState.REJECTED; break;
      case 'REWORK_REQUIRED': state = CertificationState.REWORK_REQUIRED; targetState = ReportState.CERTIFICATION_FAILED; break;
      default: throw new BadRequestException('Invalid certification decision');
    }
    const row = await this.prisma.complianceReportCertification.update({ where: { id: existing.id, tenantId: params.tenantId,
      reportId: report.id, state: CertificationState.PENDING }, data: { state, reviewerId: params.reviewerId, reviewerRole,
      comments: params.comments ?? null, validationEvidence: `${validation.validationStatus}:${validation.validatedAt}`, updatedAt: new Date() } });
    await this.reportService.updateCertificationStatus(params.tenantId, report.id, state, params.correlationId);
    await this.reportService.transitionState({ tenantId: params.tenantId, reportId: report.id, targetState,
      correlationId: params.correlationId, operatorId: params.reviewerId, reason: params.comments });
    await this.audit.recordEvent({ tenantId: params.tenantId, actionType: GovernanceActionType.REPORT_CERTIFY, reportId: report.id,
      state, result: params.decision, reason: params.comments, correlationId: params.correlationId, createdBy: params.reviewerId,
      safeEvidence: { reviewerRole, fingerprint: existing.fingerprint, validationEvidence: row.validationEvidence } });
    return this.mapRow(row);
  }

  async getCertification(tenantId: string, certificationId: string): Promise<CertificationRecord> {
    const row = await this.prisma.complianceReportCertification.findFirst({ where: { id: certificationId, tenantId } });
    if (!row) throw new NotFoundException('Certification not found for tenant');
    this.policyService.assertTenantIsolation(tenantId, row.tenantId);
    return this.mapRow(row);
  }

  async listCertifications(tenantId: string, reportId?: string): Promise<CertificationRecord[]> {
    const where: Prisma.ComplianceReportCertificationWhereInput = { tenantId, ...(reportId ? { reportId } : {}) };
    const rows = await this.prisma.complianceReportCertification.findMany({ where, orderBy: { createdAt: 'desc' } });
    return rows.map((row) => this.mapRow(row));
  }

  private assertValidation(validation: ValidationResult | null, policyVersion: string, sourceReferences: string[]): asserts validation is ValidationResult {
    if (!validation || !validation.isValid || validation.validationStatus !== 'PASSED' || !validation.sourceCompleteness
      || !validation.reconciliationResolved || !validation.periodCompleteness || !validation.fingerprintValid
      || validation.policyVersion !== policyVersion
      || JSON.stringify([...validation.sourceReferencesChecked].sort()) !== JSON.stringify([...sourceReferences].sort())) {
      throw new BadRequestException('Complete current persisted PASSED validation evidence is required');
    }
  }

  private mapRow(row: ComplianceReportCertification): CertificationRecord {
    const state = Object.values(CertificationState).find((value) => value === row.state);
    if (!state || (state === CertificationState.APPROVED && (!row.reviewerId || !row.reviewerRole))) throw new Error('Malformed persisted certification state/reviewer');
    return { ...row, state, reviewerId: row.reviewerId ?? '', reviewerRole: row.reviewerRole ?? '',
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
  }
}
