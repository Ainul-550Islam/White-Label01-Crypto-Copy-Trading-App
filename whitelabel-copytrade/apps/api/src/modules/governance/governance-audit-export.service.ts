import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { GovernanceAuditService } from './governance-audit.service';
import { GovernancePolicyService } from './governance-policy.service';
import { GovernanceActionType } from './governance.types';
import * as crypto from 'crypto';

export interface AuditExport {
  id: string;
  tenantId: string;
  exportVersion: string;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  dataAsOf: string;
  recordCount: number;
  sourceReferences: string[];
  fileLocation: string;
  fileHash: string;
  methodology: string;
  policyVersion: string;
  correlationId: string;
  isDeterministic: boolean;
  filtersApplied: Record<string, unknown>;
}

@Injectable()
export class GovernanceAuditExportService {
  private readonly logger = new Logger(GovernanceAuditExportService.name);

  constructor(
    private readonly audit: GovernanceAuditService,
    private readonly policyService: GovernancePolicyService,
  ) {}

  async exportAuditTrail(params: {
    tenantId: string;
    periodStart: string;
    periodEnd: string;
    correlationId: string;
    operatorId: string;
    filters?: { actionType?: GovernanceActionType; subjectUserId?: string };
  }): Promise<AuditExport> {
    if (!params.tenantId || !params.periodStart || !params.periodEnd) throw new BadRequestException('tenantId, periodStart, periodEnd required');
    const start = new Date(params.periodStart);
    const end = new Date(params.periodEnd);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) throw new BadRequestException('invalid period dates');
    if (start >= end) throw new BadRequestException('periodStart must be before periodEnd');

    // Non-mutating: only reads, never modifies audit
    const allEvents = await this.audit.listEvents(params.tenantId, {
      actionType: params.filters?.actionType,
      subjectUserId: params.filters?.subjectUserId,
      take: 10000,
    });

    const filtered = allEvents.filter((e) => {
      const created = new Date(e.createdAt);
      return created >= start && created <= end;
    });

    // Deterministic sort
    filtered.sort((a, b) => {
      if (a.createdAt !== b.createdAt) return a.createdAt.localeCompare(b.createdAt);
      return a.id.localeCompare(b.id);
    });

    const sourceReferences = [...new Set(filtered.map((e) => `${e.actionType}:${e.correlationId}`))].sort();

    const contentForHash = JSON.stringify({
      tenantId: params.tenantId,
      periodStart: params.periodStart,
      periodEnd: params.periodEnd,
      recordIds: filtered.map((e) => e.id).sort(),
      policyVersion: this.policyService.getPolicyVersion(),
    });
    const fileHash = crypto.createHash('sha256').update(contentForHash).digest('hex');

    const exportRecord: AuditExport = {
      id: `aexp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      tenantId: params.tenantId,
      exportVersion: `v${this.policyService.getPolicyVersion()}_${new Date().toISOString().slice(0, 10)}`,
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
      generatedAt: new Date().toISOString(),
      dataAsOf: new Date().toISOString(),
      recordCount: filtered.length,
      sourceReferences,
      fileLocation: `governance/audit-exports/${params.tenantId}/${Date.now()}.json`,
      fileHash,
      methodology: `NON_MUTATING_AUDIT_EXPORT_DETERMINISTIC_SORTED_POLICY_${this.policyService.getPolicyVersion()}`,
      policyVersion: this.policyService.getPolicyVersion(),
      correlationId: params.correlationId,
      isDeterministic: true,
      filtersApplied: params.filters ?? {},
    };

    await this.audit.recordEvent({
      tenantId: params.tenantId,
      actionType: GovernanceActionType.AUDIT_EXPORT,
      state: 'EXPORTED',
      result: 'SUCCESS',
      correlationId: params.correlationId,
      createdBy: params.operatorId,
      safeEvidence: { exportId: exportRecord.id, recordCount: exportRecord.recordCount, fileHash },
    });

    this.logger.log(`audit export generated id=${exportRecord.id} tenant=${params.tenantId} records=${exportRecord.recordCount} corr=${params.correlationId}`);
    return exportRecord;
  }
}
