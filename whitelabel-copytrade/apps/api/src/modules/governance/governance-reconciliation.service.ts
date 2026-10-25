// # Responsibility: inspect all native tenant governance records and persist findings; unread source tables and failed finding writes are explicit incomplete diagnostics, never a clean reconciliation or memory-backed durable evidence.
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { type GovernanceReconciliation, type Prisma } from '@prisma/client';
import { type GovernanceReconciliationMismatch, GovernanceActionType } from './governance.types';
import { GovernancePolicyService } from './governance-policy.service';
import { GovernanceAuditService } from './governance-audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

const TYPES: GovernanceReconciliationMismatch['type'][] = ['REPORT_SOURCE_MISSING', 'REPORT_SOURCE_STALE', 'PRIVACY_REQUEST_STUCK',
  'DELETION_BLOCKED_WITHOUT_REASON', 'RETENTION_EXPIRED_WITHOUT_ACTION', 'LEGAL_HOLD_CONFLICT', 'CERTIFICATION_MISSING',
  'DELIVERY_STATUS_UNKNOWN', 'EVIDENCE_INCOMPLETE', 'TENANT_SCOPE_MISMATCH', 'AUDIT_EXPORT_INCOMPLETE'];
const SEVERITIES: GovernanceReconciliationMismatch['severity'][] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

@Injectable()
export class GovernanceReconciliationService {
  private readonly logger = new Logger(GovernanceReconciliationService.name);
  constructor(
    private readonly policyService: GovernancePolicyService,
    private readonly audit: GovernanceAuditService,
    private readonly prisma: PrismaService,
  ) {}

  async detectMismatches(params: { tenantId: string; correlationId: string; operatorId: string; reportId?: string }): Promise<GovernanceReconciliationMismatch[]> {
    if (!params.tenantId) throw new BadRequestException('tenantId required');
    const detected: GovernanceReconciliationMismatch[] = [];
    const now = new Date().toISOString();
    const add = (type: GovernanceReconciliationMismatch['type'], entityId: string, severity: GovernanceReconciliationMismatch['severity'],
      description: string, sourceReferences: string[] = []): void => {
      detected.push({ type, entityId, tenantId: params.tenantId, severity, description, detectedAt: now,
        correlationId: params.correlationId, sourceReferences });
    };
    const unread = (source: string): void => add('REPORT_SOURCE_MISSING', `SOURCE:${source}`, 'CRITICAL',
      `Required ${source} source read failed; reconciliation is INCOMPLETE`);
    try {
      const reports = await this.prisma.complianceReport.findMany({ where: { tenantId: params.tenantId, ...(params.reportId ? { id: params.reportId } : {}) } });
      for (const report of reports) {
        this.policyService.assertTenantIsolation(params.tenantId, report.tenantId);
        if (report.sourceReferences.length === 0 || report.sourceReferences.some((reference) => reference.startsWith('DECLARED:'))) {
          add('REPORT_SOURCE_MISSING', report.id, 'HIGH', 'Report has no verified source references', report.sourceReferences);
        }
        if ((report.state === 'DELIVERING' || report.state === 'QUEUED_FOR_DELIVERY') && Date.now() - report.generatedAt.getTime() > 24 * 60 * 60_000) {
          add('DELIVERY_STATUS_UNKNOWN', report.id, 'MEDIUM', `Report delivery stuck in ${report.state} for more than 24 hours`);
        }
        if (report.state === 'READY' && report.certificationStatus === 'PENDING') add('CERTIFICATION_MISSING', report.id, 'MEDIUM', 'Ready report certification is pending');
        if (report.validationStatus === 'FAILED') add('REPORT_SOURCE_STALE', report.id, 'HIGH', 'Report validation failed');
      }
    } catch { unread('complianceReport'); }
    try {
      const requests = await this.prisma.privacyRequest.findMany({ where: { tenantId: params.tenantId } });
      for (const request of requests) {
        this.policyService.assertTenantIsolation(params.tenantId, request.tenantId);
        if (['RECEIVED', 'UNDER_REVIEW', 'IN_PROGRESS'].includes(request.state) && Date.now() - request.requestedAt.getTime() > 30 * 24 * 60 * 60_000) {
          add('PRIVACY_REQUEST_STUCK', request.id, 'MEDIUM', `Privacy request stuck in ${request.state} for more than 30 days`);
        }
        if (['BLOCKED_BY_RETENTION', 'BLOCKED_BY_LEGAL_HOLD'].includes(request.state) && !request.blockedReason) {
          add('DELETION_BLOCKED_WITHOUT_REASON', request.id, 'HIGH', 'Blocked privacy request lacks a reason');
        }
      }
    } catch { unread('privacyRequest'); }
    try {
      const candidates = await this.prisma.retentionCandidate.findMany({ where: { tenantId: params.tenantId } });
      for (const candidate of candidates) {
        this.policyService.assertTenantIsolation(params.tenantId, candidate.tenantId);
        if (candidate.retentionEndAt < new Date() && candidate.state === 'RETENTION_REQUIRED') add('RETENTION_EXPIRED_WITHOUT_ACTION', candidate.id, 'LOW', 'Retention candidate expired without action');
        if (candidate.blockedByLegalHold && candidate.legalHoldIds.length === 0) add('LEGAL_HOLD_CONFLICT', candidate.id, 'HIGH', 'Legal-hold blockage lacks hold ids');
      }
    } catch { unread('retentionCandidate'); }
    try {
      const packages = await this.prisma.evidencePackage.findMany({ where: { tenantId: params.tenantId } });
      for (const evidence of packages) {
        this.policyService.assertTenantIsolation(params.tenantId, evidence.tenantId);
        if (['DRAFT', 'COLLECTING'].includes(evidence.state) && evidence.sourceRecords.length === 0) add('EVIDENCE_INCOMPLETE', evidence.id, 'HIGH', 'Evidence package lacks source records');
      }
    } catch { unread('evidencePackage'); }
    let failedWrites = 0;
    for (const mismatch of detected) {
      try {
        const data = { severity: mismatch.severity, description: mismatch.description, detectedAt: new Date(mismatch.detectedAt),
          correlationId: mismatch.correlationId, sourceReferences: mismatch.sourceReferences ?? [] };
        await this.prisma.governanceReconciliation.upsert({ where: { tenantId_entityId_type: { tenantId: params.tenantId,
          entityId: mismatch.entityId, type: mismatch.type } }, create: { tenantId: params.tenantId, entityId: mismatch.entityId, type: mismatch.type, ...data }, update: data });
        mismatch.persistence = 'DURABLE';
      } catch {
        failedWrites += 1; mismatch.persistence = 'FAILED';
        this.logger.warn(`Required finding persistence failed tenant=${params.tenantId} entity=${mismatch.entityId} type=${mismatch.type}`);
      }
    }
    const incomplete = failedWrites > 0 || detected.some((mismatch) => mismatch.entityId.startsWith('SOURCE:'));
    await this.audit.recordEvent({ tenantId: params.tenantId, actionType: GovernanceActionType.RECONCILIATION,
      state: incomplete ? 'INCOMPLETE' : 'INSPECTED', result: `${detected.length} detected mismatches; ${failedWrites} persistence failures`,
      correlationId: params.correlationId, createdBy: params.operatorId,
      safeEvidence: { incomplete, failedWrites, mismatchCount: detected.length, types: [...new Set(detected.map((mismatch) => mismatch.type))] } });
    return detected;
  }

  async listMismatches(tenantId: string, filters?: { reportId?: string; type?: GovernanceReconciliationMismatch['type'] }): Promise<GovernanceReconciliationMismatch[]> {
    const where: Prisma.GovernanceReconciliationWhereInput = { tenantId };
    // A failed required table read blocks every report, not only the synthetic source diagnostic id.
    if (filters?.reportId) where.OR = [{ entityId: filters.reportId }, { entityId: { startsWith: 'SOURCE:' } }];
    if (filters?.type) where.type = filters.type;
    const rows = await this.prisma.governanceReconciliation.findMany({ where, orderBy: { detectedAt: 'desc' } });
    return rows.map((row) => {
      this.policyService.assertTenantIsolation(tenantId, row.tenantId);
      return this.mapRow(row);
    });
  }

  async resolveMismatch(params: { tenantId: string; entityId: string; type: GovernanceReconciliationMismatch['type']; correlationId: string; operatorId: string; resolution: string }): Promise<void> {
    if (!params.resolution.trim()) throw new BadRequestException('Explicit mismatch resolution required');
    const result = await this.prisma.governanceReconciliation.deleteMany({ where: { entityId: params.entityId, type: params.type, tenantId: params.tenantId } });
    await this.audit.recordEvent({ tenantId: params.tenantId, actionType: GovernanceActionType.RECONCILIATION,
      state: result.count > 0 ? 'RESOLVED' : 'ALREADY_ABSENT', result: params.resolution, correlationId: params.correlationId,
      createdBy: params.operatorId, safeEvidence: { entityId: params.entityId, type: params.type, deletedCount: result.count } });
  }

  private mapRow(row: GovernanceReconciliation): GovernanceReconciliationMismatch {
    const type = TYPES.find((member) => member === row.type); const severity = SEVERITIES.find((member) => member === row.severity);
    if (!type || !severity) throw new Error('Malformed persisted reconciliation type/severity');
    return { type, severity, tenantId: row.tenantId, entityId: row.entityId, description: row.description,
      detectedAt: row.detectedAt.toISOString(), correlationId: row.correlationId, sourceReferences: row.sourceReferences, persistence: 'DURABLE' };
  }
}
