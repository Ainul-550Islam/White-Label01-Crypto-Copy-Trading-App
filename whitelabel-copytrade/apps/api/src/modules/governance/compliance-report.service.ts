// # Responsibility: store/read native tenant-bound report intents; declared inputs are not verified sources, metadata fingerprints are not artifact hashes, and required persistence never falls back to memory.
import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { type ComplianceReport as NativeReport, type Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { type ComplianceReport, ReportState, CertificationState, DeliveryState, REPORT_TRANSITIONS,
  GovernanceActionType, AUTHORITATIVE_SOURCE_SYSTEMS } from './governance.types';
import { GovernancePolicyService } from './governance-policy.service';
import { GovernanceAuditService } from './governance-audit.service';
import { ComplianceReportTemplateService } from './compliance-report-template.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export function reportMetadataFingerprint(report: Pick<ComplianceReport,
  'tenantId' | 'reportType' | 'jurisdiction' | 'periodStart' | 'periodEnd' | 'sourceReferences' | 'policyVersion' | 'reportVersion'>): string {
  const input = { tenantId: report.tenantId, reportType: report.reportType, jurisdiction: report.jurisdiction,
    periodStart: report.periodStart, periodEnd: report.periodEnd, sourceReferences: [...report.sourceReferences].sort(),
    policyVersion: report.policyVersion, templateVersion: report.reportVersion };
  return createHash('sha256').update(JSON.stringify(input, Object.keys(input).sort())).digest('hex');
}

@Injectable()
export class ComplianceReportService {
  private readonly logger = new Logger(ComplianceReportService.name);
  constructor(
    private readonly policyService: GovernancePolicyService,
    private readonly audit: GovernanceAuditService,
    private readonly templateService: ComplianceReportTemplateService,
    private readonly prisma: PrismaService,
  ) {}

  async generateReport(params: {
    tenantId: string; reportType: string; jurisdiction: string; periodStart: string; periodEnd: string;
    correlationId: string; createdBy: string; sourceData?: Record<string, unknown>;
  }): Promise<ComplianceReport> {
    if (!params.tenantId || !params.reportType || !params.periodStart || !params.periodEnd) throw new BadRequestException('Explicit report identity/period required');
    this.policyService.validateJurisdiction(params.jurisdiction);
    const periodStart = new Date(params.periodStart); const periodEnd = new Date(params.periodEnd);
    if (!Number.isFinite(periodStart.getTime()) || !Number.isFinite(periodEnd.getTime()) || periodStart >= periodEnd) throw new BadRequestException('Invalid report period');
    const template = this.templateService.getTemplate(params.reportType, params.jurisdiction);
    const policy = this.policyService.buildPolicy(params.tenantId, params.jurisdiction);
    const sourceReferences: string[] = [];
    let recordCount = 0;
    if (params.sourceData) {
      for (const [system, data] of Object.entries(params.sourceData)) {
        if (!AUTHORITATIVE_SOURCE_SYSTEMS.some((source) => source === system)) throw new BadRequestException('Unsupported declared report source system');
        // The endpoint accepts declared draft inputs, not proof of a server-side fetch from an authoritative system.
        sourceReferences.push(`DECLARED:${system}:${periodStart.toISOString()}:${periodEnd.toISOString()}`);
        if (Array.isArray(data)) recordCount += data.length;
        else if (data !== null && typeof data === 'object') recordCount += Object.keys(data).length;
      }
    }
    sourceReferences.sort();
    const now = new Date();
    const draft = { tenantId: params.tenantId, reportType: params.reportType, jurisdiction: params.jurisdiction.toUpperCase(),
      periodStart: periodStart.toISOString(), periodEnd: periodEnd.toISOString(), sourceReferences,
      policyVersion: policy.policyVersion, reportVersion: template.templateVersion };
    const row = await this.prisma.complianceReport.create({ data: { ...draft, id: randomUUID(), schemaVersion: template.schemaVersion,
      periodStart, periodEnd, generatedAt: now, dataAsOf: now,
      methodology: 'DRAFT_INTENT_NO_VERIFIED_SOURCE_ARTIFACT', calculationVersion: template.calculationVersion,
      validationStatus: 'PENDING', certificationStatus: CertificationState.PENDING, deliveryStatus: DeliveryState.NOT_DELIVERED,
      state: ReportState.DRAFT, recordCount, fileLocation: null, fileHash: null,
      fingerprint: reportMetadataFingerprint(draft), correlationId: params.correlationId, createdBy: params.createdBy } });
    await this.audit.recordEvent({ tenantId: params.tenantId, actionType: GovernanceActionType.REPORT_GENERATE, reportId: row.id,
      state: ReportState.DRAFT, result: 'DRAFT_INTENT_PERSISTED', correlationId: params.correlationId, createdBy: params.createdBy,
      safeEvidence: { reportType: row.reportType, declaredSourceCount: sourceReferences.length, artifactGenerated: false } });
    this.logger.log(`Report draft intent persisted id=${row.id} tenant=${params.tenantId}`);
    return this.mapRow(row);
  }

  async transitionState(params: { tenantId: string; reportId: string; targetState: ReportState; correlationId: string; operatorId: string; reason?: string }): Promise<ComplianceReport> {
    const report = await this.getReport(params.tenantId, params.reportId);
    if (!REPORT_TRANSITIONS[report.state].includes(params.targetState)) throw new BadRequestException(`Invalid transition ${report.state} -> ${params.targetState}`);
    if (params.targetState === ReportState.GENERATED && (!report.fileLocation || !report.fileHash || !/^[a-f0-9]{64}$/.test(report.fileHash)
      || report.sourceReferences.length === 0 || report.sourceReferences.some((reference) => reference.startsWith('DECLARED:')))) {
      throw new BadRequestException('GENERATED requires a persisted real artifact and authoritative source references; a draft is not generation evidence');
    }
    const updated = await this.prisma.complianceReport.update({ where: { id: report.id, tenantId: params.tenantId, state: report.state }, data: { state: params.targetState } });
    await this.audit.recordEvent({ tenantId: params.tenantId, actionType: GovernanceActionType.REPORT_VALIDATE, reportId: report.id,
      state: params.targetState, result: params.targetState, reason: params.reason, correlationId: params.correlationId,
      createdBy: params.operatorId, safeEvidence: { previousState: report.state, targetState: params.targetState } });
    return this.mapRow(updated);
  }

  async getReport(tenantId: string, reportId: string): Promise<ComplianceReport> {
    const row = await this.prisma.complianceReport.findFirst({ where: { id: reportId, tenantId } });
    if (!row) throw new NotFoundException('Report not found for tenant');
    this.policyService.assertTenantIsolation(tenantId, row.tenantId);
    return this.mapRow(row);
  }

  async listReports(tenantId: string, filters?: { reportType?: string; state?: ReportState; jurisdiction?: string }): Promise<ComplianceReport[]> {
    const where: Prisma.ComplianceReportWhereInput = { tenantId };
    if (filters?.reportType) where.reportType = filters.reportType;
    if (filters?.state) where.state = filters.state;
    if (filters?.jurisdiction) where.jurisdiction = filters.jurisdiction.toUpperCase();
    const rows = await this.prisma.complianceReport.findMany({ where, orderBy: { generatedAt: 'desc' } });
    return rows.map((row) => this.mapRow(row));
  }

  async updateValidationStatus(tenantId: string, reportId: string, status: string, correlationId: string): Promise<ComplianceReport> {
    if (!['PENDING', 'PASSED', 'FAILED'].includes(status)) throw new BadRequestException('Invalid report validation status');
    const row = await this.prisma.complianceReport.update({ where: { id: reportId, tenantId }, data: { validationStatus: status, correlationId } });
    return this.mapRow(row);
  }
  async updateCertificationStatus(tenantId: string, reportId: string, status: CertificationState, correlationId: string): Promise<ComplianceReport> {
    const row = await this.prisma.complianceReport.update({ where: { id: reportId, tenantId }, data: { certificationStatus: status, correlationId } });
    return this.mapRow(row);
  }
  async updateDeliveryStatus(tenantId: string, reportId: string, status: DeliveryState, correlationId: string): Promise<ComplianceReport> {
    const row = await this.prisma.complianceReport.update({ where: { id: reportId, tenantId }, data: { deliveryStatus: status, correlationId } });
    return this.mapRow(row);
  }

  private mapRow(row: NativeReport): ComplianceReport {
    const state = Object.values(ReportState).find((value) => value === row.state);
    const certificationStatus = Object.values(CertificationState).find((value) => value === row.certificationStatus);
    const deliveryStatus = Object.values(DeliveryState).find((value) => value === row.deliveryStatus);
    if (!state || !certificationStatus || !deliveryStatus || !['PENDING', 'PASSED', 'FAILED'].includes(row.validationStatus)) throw new Error('Malformed persisted report state/status');
    return { ...row, state, certificationStatus, deliveryStatus, periodStart: row.periodStart.toISOString(), periodEnd: row.periodEnd.toISOString(),
      generatedAt: row.generatedAt.toISOString(), dataAsOf: row.dataAsOf.toISOString() };
  }
}
