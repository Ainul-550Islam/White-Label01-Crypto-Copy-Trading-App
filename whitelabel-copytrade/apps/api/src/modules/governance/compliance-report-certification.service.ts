import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { CertificationState, ReportState, GovernanceActionType, ComplianceReport } from './governance.types';
import { ComplianceReportService } from './compliance-report.service';
import { ComplianceReportValidationService } from './compliance-report-validation.service';
import { GovernancePolicyService } from './governance-policy.service';
import { GovernanceAuditService } from './governance-audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import * as crypto from 'crypto';

export interface CertificationRecord {
  id: string;
  tenantId: string;
  reportId: string;
  state: CertificationState;
  reviewerId: string;
  reviewerRole: string;
  fingerprint: string;
  validationEvidence: string;
  comments?: string | null;
  createdAt: string;
  updatedAt: string;
  correlationId: string;
  policyVersion: string;
}

@Injectable()
export class ComplianceReportCertificationService {
  private readonly logger = new Logger(ComplianceReportCertificationService.name);
  private readonly inMemory: Map<string, CertificationRecord> = new Map();

  constructor(
    private readonly reportService: ComplianceReportService,
    private readonly validationService: ComplianceReportValidationService,
    private readonly policyService: GovernancePolicyService,
    private readonly audit: GovernanceAuditService,
    private readonly prisma: PrismaService,
  ) {}

  async requestCertification(params: {
    tenantId: string;
    reportId: string;
    correlationId: string;
    requesterId: string;
  }): Promise<CertificationRecord> {
    const report = await this.reportService.getReport(params.tenantId, params.reportId);
    if (report.state !== ReportState.READY) throw new BadRequestException(`report must be READY for certification, current ${report.state}`);

    const validation = await this.validationService.getValidation(params.tenantId, params.reportId);
    if (!validation || !validation.isValid) throw new BadRequestException('report must have passed validation before certification');

    await this.reportService.transitionState({
      tenantId: params.tenantId,
      reportId: report.id,
      targetState: ReportState.PENDING_CERTIFICATION,
      correlationId: params.correlationId,
      operatorId: params.requesterId,
    });

    const record: CertificationRecord = {
      id: `cert_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      tenantId: params.tenantId,
      reportId: report.id,
      state: CertificationState.PENDING,
      reviewerId: '',
      reviewerRole: '',
      fingerprint: report.fingerprint,
      validationEvidence: validation.validationStatus,
      comments: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      correlationId: params.correlationId,
      policyVersion: report.policyVersion,
    };

    this.inMemory.set(record.id, record);
    try {
      await (this.prisma as any).complianceReportCertification?.create?.({
        data: {
          id: record.id,
          tenantId: record.tenantId,
          reportId: record.reportId,
          state: record.state,
          fingerprint: record.fingerprint,
          validationEvidence: record.validationEvidence,
          correlationId: record.correlationId,
          policyVersion: record.policyVersion,
          createdAt: new Date(record.createdAt),
          updatedAt: new Date(record.updatedAt),
        },
      });
    } catch {
      this.logger.debug(`certification persist skipped id=${record.id}`);
    }

    this.logger.log(`certification requested id=${record.id} report=${report.id} corr=${params.correlationId}`);
    return record;
  }

  async certifyReport(params: {
    tenantId: string;
    reportId: string;
    certificationId: string;
    reviewerId: string;
    reviewerRole: string;
    decision: 'APPROVED' | 'REJECTED' | 'REWORK_REQUIRED';
    comments?: string;
    correlationId: string;
  }): Promise<CertificationRecord> {
    if (!params.reviewerId || !params.reviewerRole) throw new BadRequestException('reviewerId and reviewerRole required');
    const allowedRoles = ['ADMIN', 'COMPLIANCE', 'FINANCE', 'LEGAL', 'AUDIT'];
    if (!allowedRoles.includes(params.reviewerRole.toUpperCase())) throw new BadRequestException(`reviewerRole must be one of ${allowedRoles.join(',')}`);

    const report = await this.reportService.getReport(params.tenantId, params.reportId);
    if (report.state !== ReportState.PENDING_CERTIFICATION) throw new BadRequestException(`report must be PENDING_CERTIFICATION, current ${report.state}`);

    const existing = await this.getCertification(params.tenantId, params.certificationId);
    if (existing.reportId !== params.reportId) throw new BadRequestException('certification report mismatch');

    // Validate evidence exists
    const validation = await this.validationService.getValidation(params.tenantId, params.reportId);
    if (!validation || validation.validationStatus !== 'PASSED') throw new BadRequestException('validation evidence must be PASSED before certification');

    // Fingerprint must match report fingerprint
    if (existing.fingerprint !== report.fingerprint) throw new BadRequestException('fingerprint mismatch, report may have changed after certification request');

    let newState: CertificationState;
    let reportTarget: ReportState | null = null;
    switch (params.decision) {
      case 'APPROVED':
        newState = CertificationState.APPROVED;
        reportTarget = ReportState.CERTIFIED;
        break;
      case 'REJECTED':
        newState = CertificationState.REJECTED;
        reportTarget = ReportState.REJECTED;
        break;
      case 'REWORK_REQUIRED':
        newState = CertificationState.REWORK_REQUIRED;
        reportTarget = null; // will need to go back to DRAFT via explicit action
        break;
      default:
        throw new BadRequestException('invalid decision');
    }

    existing.state = newState;
    existing.reviewerId = params.reviewerId;
    existing.reviewerRole = params.reviewerRole.toUpperCase();
    existing.comments = params.comments ?? null;
    existing.updatedAt = new Date().toISOString();
    existing.validationEvidence = `${validation.validationStatus}:${validation.validatedAt}`;

    this.inMemory.set(existing.id, existing);
    try {
      await (this.prisma as any).complianceReportCertification?.update?.({
        where: { id: existing.id },
        data: {
          state: existing.state,
          reviewerId: existing.reviewerId,
          reviewerRole: existing.reviewerRole,
          comments: existing.comments,
          validationEvidence: existing.validationEvidence,
          updatedAt: new Date(existing.updatedAt),
        },
      });
    } catch {
      this.logger.debug(`cert update persist skipped id=${existing.id}`);
    }

    await this.reportService.updateCertificationStatus(params.tenantId, report.id, newState, params.correlationId);

    if (reportTarget) {
      await this.reportService.transitionState({
        tenantId: params.tenantId,
        reportId: report.id,
        targetState: reportTarget,
        correlationId: params.correlationId,
        operatorId: params.reviewerId,
        reason: params.comments,
      });
    } else if (newState === CertificationState.REWORK_REQUIRED) {
      // Rework requires explicit rejection to draft - we transition to CERTIFICATION_FAILED
      await this.reportService.transitionState({
        tenantId: params.tenantId,
        reportId: report.id,
        targetState: ReportState.CERTIFICATION_FAILED,
        correlationId: params.correlationId,
        operatorId: params.reviewerId,
        reason: params.comments,
      });
    }

    await this.audit.recordEvent({
      tenantId: params.tenantId,
      actionType: GovernanceActionType.REPORT_CERTIFY,
      reportId: report.id,
      state: newState,
      result: params.decision,
      reason: params.comments,
      correlationId: params.correlationId,
      createdBy: params.reviewerId,
      safeEvidence: { reviewerRole: params.reviewerRole, fingerprint: existing.fingerprint, validationEvidence: existing.validationEvidence },
    });

    this.logger.log(`report certified id=${report.id} decision=${params.decision} reviewer=${params.reviewerId} corr=${params.correlationId}`);
    return existing;
  }

  async getCertification(tenantId: string, certificationId: string): Promise<CertificationRecord> {
    const mem = this.inMemory.get(certificationId);
    if (mem) {
      this.policyService.assertTenantIsolation(tenantId, mem.tenantId);
      return mem;
    }
    try {
      const row = await (this.prisma as any).complianceReportCertification?.findUnique?.({ where: { id: certificationId } });
      if (row) {
        this.policyService.assertTenantIsolation(tenantId, row.tenantId);
        const mapped = this.mapRow(row);
        this.inMemory.set(mapped.id, mapped);
        return mapped;
      }
    } catch {
      /* ignore */
    }
    throw new NotFoundException(`certification ${certificationId} not found`);
  }

  async listCertifications(tenantId: string, reportId?: string): Promise<CertificationRecord[]> {
    let list = [...this.inMemory.values()].filter((c) => c.tenantId === tenantId);
    if (reportId) list = list.filter((c) => c.reportId === reportId);
    try {
      const where: any = { tenantId };
      if (reportId) where.reportId = reportId;
      const rows = await (this.prisma as any).complianceReportCertification?.findMany?.({ where, take: 200, orderBy: { createdAt: 'desc' } });
      if (rows && rows.length > 0) list = rows.map((r: any) => this.mapRow(r));
    } catch {
      /* ignore */
    }
    return list;
  }

  private mapRow(row: any): CertificationRecord {
    return {
      id: row.id,
      tenantId: row.tenantId,
      reportId: row.reportId,
      state: row.state,
      reviewerId: row.reviewerId ?? '',
      reviewerRole: row.reviewerRole ?? '',
      fingerprint: row.fingerprint,
      validationEvidence: row.validationEvidence,
      comments: row.comments ?? null,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
      correlationId: row.correlationId,
      policyVersion: row.policyVersion,
    };
  }
}
