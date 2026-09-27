import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import {
  ComplianceReport,
  ReportState,
  CertificationState,
  DeliveryState,
  REPORT_TRANSITIONS,
  GovernanceActionType,
  AUTHORITATIVE_SOURCE_SYSTEMS,
} from './governance.types';
import { GovernancePolicyService } from './governance-policy.service';
import { GovernanceAuditService } from './governance-audit.service';
import { ComplianceReportTemplateService } from './compliance-report-template.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import * as crypto from 'crypto';

@Injectable()
export class ComplianceReportService {
  private readonly logger = new Logger(ComplianceReportService.name);
  private readonly inMemory: Map<string, ComplianceReport> = new Map();

  constructor(
    private readonly policyService: GovernancePolicyService,
    private readonly audit: GovernanceAuditService,
    private readonly templateService: ComplianceReportTemplateService,
    private readonly prisma: PrismaService,
  ) {}

  async generateReport(params: {
    tenantId: string;
    reportType: string;
    jurisdiction: string;
    periodStart: string;
    periodEnd: string;
    correlationId: string;
    createdBy: string;
    sourceData?: Record<string, unknown>;
  }): Promise<ComplianceReport> {
    if (!params.tenantId || !params.reportType || !params.periodStart || !params.periodEnd) {
      throw new BadRequestException('tenantId, reportType, periodStart, periodEnd required');
    }
    this.policyService.validateJurisdiction(params.jurisdiction);
    const periodStart = new Date(params.periodStart);
    const periodEnd = new Date(params.periodEnd);
    if (isNaN(periodStart.getTime()) || isNaN(periodEnd.getTime())) throw new BadRequestException('invalid period dates');
    if (periodStart >= periodEnd) throw new BadRequestException('periodStart must be before periodEnd');

    const template = this.templateService.getTemplate(params.reportType, params.jurisdiction);
    const policy = this.policyService.buildPolicy(params.tenantId, params.jurisdiction);

    // Validate sourceData comes from authoritative systems only, not client-supplied compliance state
    const sourceReferences: string[] = [];
    let recordCount = 0;
    if (params.sourceData) {
      for (const [system, data] of Object.entries(params.sourceData)) {
        if (!AUTHORITATIVE_SOURCE_SYSTEMS.includes(system as any)) {
          throw new BadRequestException(`source system ${system} not authoritative`);
        }
        sourceReferences.push(`${system}:${params.periodStart}:${params.periodEnd}`);
        if (Array.isArray(data)) recordCount += data.length;
        else if (typeof data === 'object' && data !== null) recordCount += Object.keys(data).length;
      }
    } else {
      // If no sourceData provided, we still generate report skeleton with source references from template
      for (const sys of template.sourceSystems) {
        sourceReferences.push(`${sys}:${params.periodStart}:${params.periodEnd}`);
      }
    }

    // Ensure required sources are present
    for (const requiredSource of template.sourceSystems) {
      const hasSource = sourceReferences.some((ref) => ref.startsWith(requiredSource + ':'));
      if (!hasSource) {
        // For draft generation we allow missing but validation will fail - record intent
        this.logger.warn(`report generation missing required source ${requiredSource} type=${params.reportType} corr=${params.correlationId}`);
      }
    }

    sourceReferences.sort();

    const fingerprint = this.generateFingerprint({
      tenantId: params.tenantId,
      reportType: params.reportType,
      jurisdiction: params.jurisdiction,
      periodStart: params.periodStart,
      periodEnd: params.periodEnd,
      sourceReferences,
      policyVersion: policy.policyVersion,
      templateVersion: template.templateVersion,
    });

    const report: ComplianceReport = {
      id: `rpt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      tenantId: params.tenantId,
      reportType: params.reportType,
      reportVersion: template.templateVersion,
      schemaVersion: template.schemaVersion,
      jurisdiction: params.jurisdiction.toUpperCase(),
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      generatedAt: new Date().toISOString(),
      dataAsOf: new Date().toISOString(),
      sourceReferences,
      methodology: template.methodology,
      calculationVersion: template.calculationVersion,
      policyVersion: policy.policyVersion,
      validationStatus: 'PENDING',
      certificationStatus: CertificationState.PENDING,
      deliveryStatus: DeliveryState.NOT_DELIVERED,
      state: ReportState.DRAFT,
      recordCount,
      fileLocation: `governance/reports/${params.tenantId}/${params.reportType}/${Date.now()}.json`,
      fileHash: fingerprint,
      fingerprint,
      correlationId: params.correlationId,
      createdBy: params.createdBy,
    };

    this.inMemory.set(report.id, report);
    try {
      await (this.prisma as any).complianceReport?.create?.({
        data: {
          id: report.id,
          tenantId: report.tenantId,
          reportType: report.reportType,
          reportVersion: report.reportVersion,
          schemaVersion: report.schemaVersion,
          jurisdiction: report.jurisdiction,
          periodStart: new Date(report.periodStart),
          periodEnd: new Date(report.periodEnd),
          generatedAt: new Date(report.generatedAt),
          dataAsOf: new Date(report.dataAsOf),
          sourceReferences: report.sourceReferences,
          methodology: report.methodology,
          calculationVersion: report.calculationVersion,
          policyVersion: report.policyVersion,
          validationStatus: report.validationStatus,
          certificationStatus: report.certificationStatus,
          deliveryStatus: report.deliveryStatus,
          state: report.state,
          recordCount: report.recordCount,
          fileLocation: report.fileLocation,
          fileHash: report.fileHash,
          fingerprint: report.fingerprint,
          correlationId: report.correlationId,
          createdBy: report.createdBy,
        },
      });
    } catch {
      this.logger.debug(`complianceReport persist skipped id=${report.id}`);
    }

    await this.audit.recordEvent({
      tenantId: params.tenantId,
      actionType: GovernanceActionType.REPORT_GENERATE,
      reportId: report.id,
      state: report.state,
      result: 'GENERATED',
      correlationId: params.correlationId,
      createdBy: params.createdBy,
      safeEvidence: { reportType: params.reportType, jurisdiction: params.jurisdiction, fingerprint, sourceReferences: sourceReferences.length },
    });

    this.logger.log(`report generated id=${report.id} type=${params.reportType} tenant=${params.tenantId} corr=${params.correlationId}`);
    return report;
  }

  async transitionState(params: { tenantId: string; reportId: string; targetState: ReportState; correlationId: string; operatorId: string; reason?: string }): Promise<ComplianceReport> {
    const report = await this.getReport(params.tenantId, params.reportId);
    const allowed = REPORT_TRANSITIONS[report.state];
    if (!allowed.includes(params.targetState)) throw new BadRequestException(`invalid transition ${report.state} -> ${params.targetState}`);

    report.state = params.targetState;
    this.inMemory.set(report.id, report);
    try {
      await (this.prisma as any).complianceReport?.update?.({ where: { id: report.id }, data: { state: report.state } });
    } catch {
      this.logger.debug(`report transition persist skipped id=${report.id}`);
    }

    await this.audit.recordEvent({
      tenantId: params.tenantId,
      actionType: GovernanceActionType.REPORT_VALIDATE,
      reportId: report.id,
      state: report.state,
      result: params.targetState,
      reason: params.reason,
      correlationId: params.correlationId,
      createdBy: params.operatorId,
      safeEvidence: { targetState: params.targetState },
    });

    return report;
  }

  async getReport(tenantId: string, reportId: string): Promise<ComplianceReport> {
    const mem = this.inMemory.get(reportId);
    if (mem) {
      this.policyService.assertTenantIsolation(tenantId, mem.tenantId);
      return mem;
    }
    try {
      const row = await (this.prisma as any).complianceReport?.findUnique?.({ where: { id: reportId } });
      if (row) {
        this.policyService.assertTenantIsolation(tenantId, row.tenantId);
        const mapped = this.mapRow(row);
        this.inMemory.set(mapped.id, mapped);
        return mapped;
      }
    } catch {
      /* ignore */
    }
    throw new NotFoundException(`report ${reportId} not found`);
  }

  async listReports(tenantId: string, filters?: { reportType?: string; state?: ReportState; jurisdiction?: string }): Promise<ComplianceReport[]> {
    let list = [...this.inMemory.values()].filter((r) => r.tenantId === tenantId);
    if (filters?.reportType) list = list.filter((r) => r.reportType === filters.reportType);
    if (filters?.state) list = list.filter((r) => r.state === filters.state);
    if (filters?.jurisdiction) {
      const jUpper = filters.jurisdiction.toUpperCase();
      list = list.filter((r) => r.jurisdiction === jUpper);
    }
    try {
      const where: any = { tenantId };
      if (filters?.reportType) where.reportType = filters.reportType;
      if (filters?.state) where.state = filters.state;
      if (filters?.jurisdiction) where.jurisdiction = filters.jurisdiction.toUpperCase();
      const rows = await (this.prisma as any).complianceReport?.findMany?.({ where, take: 500, orderBy: { generatedAt: 'desc' } });
      if (rows && rows.length > 0) list = rows.map((r: any) => this.mapRow(r));
    } catch {
      /* ignore */
    }
    return list;
  }

  async updateValidationStatus(tenantId: string, reportId: string, status: string, correlationId: string): Promise<ComplianceReport> {
    const report = await this.getReport(tenantId, reportId);
    report.validationStatus = status;
    this.inMemory.set(report.id, report);
    try {
      await (this.prisma as any).complianceReport?.update?.({ where: { id: report.id }, data: { validationStatus: status } });
    } catch {
      this.logger.debug(`updateValidation persist skipped id=${report.id}`);
    }
    return report;
  }

  async updateCertificationStatus(tenantId: string, reportId: string, status: CertificationState, correlationId: string): Promise<ComplianceReport> {
    const report = await this.getReport(tenantId, reportId);
    report.certificationStatus = status;
    this.inMemory.set(report.id, report);
    try {
      await (this.prisma as any).complianceReport?.update?.({ where: { id: report.id }, data: { certificationStatus: status } });
    } catch {
      this.logger.debug(`updateCertification persist skipped id=${report.id}`);
    }
    return report;
  }

  async updateDeliveryStatus(tenantId: string, reportId: string, status: DeliveryState, correlationId: string): Promise<ComplianceReport> {
    const report = await this.getReport(tenantId, reportId);
    report.deliveryStatus = status;
    this.inMemory.set(report.id, report);
    try {
      await (this.prisma as any).complianceReport?.update?.({ where: { id: report.id }, data: { deliveryStatus: status } });
    } catch {
      this.logger.debug(`updateDelivery persist skipped id=${report.id}`);
    }
    return report;
  }

  private generateFingerprint(input: Record<string, unknown>): string {
    const sorted = JSON.stringify(input, Object.keys(input).sort());
    return crypto.createHash('sha256').update(sorted).digest('hex');
  }

  private mapRow(row: any): ComplianceReport {
    return {
      id: row.id,
      tenantId: row.tenantId,
      reportType: row.reportType,
      reportVersion: row.reportVersion,
      schemaVersion: row.schemaVersion,
      jurisdiction: row.jurisdiction,
      periodStart: row.periodStart instanceof Date ? row.periodStart.toISOString() : row.periodStart,
      periodEnd: row.periodEnd instanceof Date ? row.periodEnd.toISOString() : row.periodEnd,
      generatedAt: row.generatedAt instanceof Date ? row.generatedAt.toISOString() : row.generatedAt,
      dataAsOf: row.dataAsOf instanceof Date ? row.dataAsOf.toISOString() : row.dataAsOf,
      sourceReferences: row.sourceReferences ?? [],
      methodology: row.methodology,
      calculationVersion: row.calculationVersion,
      policyVersion: row.policyVersion,
      validationStatus: row.validationStatus,
      certificationStatus: row.certificationStatus,
      deliveryStatus: row.deliveryStatus,
      state: row.state,
      recordCount: row.recordCount,
      fileLocation: row.fileLocation ?? null,
      fileHash: row.fileHash ?? null,
      fingerprint: row.fingerprint,
      correlationId: row.correlationId,
      createdBy: row.createdBy,
    };
  }
}
