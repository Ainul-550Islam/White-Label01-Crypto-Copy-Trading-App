import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConsentRecord, ConsentState, GovernanceActionType } from './governance.types';
import { GovernancePolicyService } from './governance-policy.service';
import { GovernanceAuditService } from './governance-audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

@Injectable()
export class ConsentService {
  private readonly logger = new Logger(ConsentService.name);
  private readonly inMemory: Map<string, ConsentRecord> = new Map();

  constructor(
    private readonly policyService: GovernancePolicyService,
    private readonly audit: GovernanceAuditService,
    private readonly prisma: PrismaService,
  ) {}

  async captureConsent(params: {
    tenantId: string;
    subjectUserId: string;
    purpose: string;
    version: string;
    policyReference: string;
    source: string;
    correlationId: string;
    capturedBy: string;
    evidenceReference?: string;
  }): Promise<ConsentRecord> {
    if (!params.tenantId || !params.subjectUserId || !params.purpose || !params.version || !params.policyReference) {
      throw new BadRequestException('tenantId, subjectUserId, purpose, version, policyReference required');
    }

    const record: ConsentRecord = {
      id: `cons_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      tenantId: params.tenantId,
      subjectUserId: params.subjectUserId,
      purpose: params.purpose,
      version: params.version,
      policyReference: params.policyReference,
      source: params.source,
      capturedAt: new Date().toISOString(),
      withdrawnAt: null,
      status: ConsentState.ACTIVE,
      evidenceReference: params.evidenceReference ?? null,
      correlationId: params.correlationId,
    };

    this.inMemory.set(record.id, record);
    try {
      await (this.prisma as any).consentRecord?.create?.({
        data: {
          id: record.id,
          tenantId: record.tenantId,
          subjectUserId: record.subjectUserId,
          purpose: record.purpose,
          version: record.version,
          policyReference: record.policyReference,
          source: record.source,
          capturedAt: new Date(record.capturedAt),
          status: record.status,
          evidenceReference: record.evidenceReference,
          correlationId: record.correlationId,
        },
      });
    } catch {
      this.logger.debug(`consent persist skipped id=${record.id}`);
    }

    await this.audit.recordEvent({
      tenantId: params.tenantId,
      actionType: GovernanceActionType.CONSENT_CAPTURE,
      subjectUserId: params.subjectUserId,
      consentId: record.id,
      state: record.status,
      result: 'CAPTURED',
      correlationId: params.correlationId,
      createdBy: params.capturedBy,
      safeEvidence: { purpose: params.purpose, version: params.version, policyReference: params.policyReference },
    });

    this.logger.log(`consent captured id=${record.id} tenant=${params.tenantId} purpose=${params.purpose} corr=${params.correlationId}`);
    return record;
  }

  async withdrawConsent(params: {
    tenantId: string;
    consentId: string;
    subjectUserId: string;
    correlationId: string;
    withdrawnBy: string;
    reason?: string;
  }): Promise<ConsentRecord> {
    const existing = await this.getConsent(params.tenantId, params.consentId);
    if (existing.subjectUserId !== params.subjectUserId) throw new BadRequestException('subject mismatch');
    if (existing.status !== ConsentState.ACTIVE) throw new BadRequestException(`cannot withdraw from status ${existing.status}`);

    existing.status = ConsentState.WITHDRAWN;
    existing.withdrawnAt = new Date().toISOString();
    this.inMemory.set(existing.id, existing);
    try {
      await (this.prisma as any).consentRecord?.update?.({
        where: { id: existing.id },
        data: { status: existing.status, withdrawnAt: new Date(existing.withdrawnAt) },
      });
    } catch {
      this.logger.debug(`consent withdraw persist skipped id=${existing.id}`);
    }

    await this.audit.recordEvent({
      tenantId: params.tenantId,
      actionType: GovernanceActionType.CONSENT_WITHDRAW,
      subjectUserId: params.subjectUserId,
      consentId: existing.id,
      state: existing.status,
      result: 'WITHDRAWN',
      reason: params.reason,
      correlationId: params.correlationId,
      createdBy: params.withdrawnBy,
      safeEvidence: { purpose: existing.purpose, version: existing.version },
    });

    this.logger.log(`consent withdrawn id=${existing.id} corr=${params.correlationId}`);
    return existing;
  }

  async getConsent(tenantId: string, consentId: string): Promise<ConsentRecord> {
    const mem = this.inMemory.get(consentId);
    if (mem) {
      this.policyService.assertTenantIsolation(tenantId, mem.tenantId);
      return mem;
    }
    try {
      const row = await (this.prisma as any).consentRecord?.findUnique?.({ where: { id: consentId } });
      if (row) {
        this.policyService.assertTenantIsolation(tenantId, row.tenantId);
        return this.mapRow(row);
      }
    } catch {
      /* ignore */
    }
    throw new BadRequestException(`consent ${consentId} not found`);
  }

  async listConsents(tenantId: string, subjectUserId: string): Promise<ConsentRecord[]> {
    let list = [...this.inMemory.values()].filter((c) => c.tenantId === tenantId && c.subjectUserId === subjectUserId);
    try {
      const rows = await (this.prisma as any).consentRecord?.findMany?.({ where: { tenantId, subjectUserId }, take: 500, orderBy: { capturedAt: 'desc' } });
      if (rows && rows.length > 0) list = rows.map((r: any) => this.mapRow(r));
    } catch {
      /* ignore */
    }
    return list;
  }

  private mapRow(row: any): ConsentRecord {
    return {
      id: row.id,
      tenantId: row.tenantId,
      subjectUserId: row.subjectUserId,
      purpose: row.purpose,
      version: row.version,
      policyReference: row.policyReference,
      source: row.source,
      capturedAt: row.capturedAt instanceof Date ? row.capturedAt.toISOString() : row.capturedAt,
      withdrawnAt: row.withdrawnAt ? (row.withdrawnAt instanceof Date ? row.withdrawnAt.toISOString() : row.withdrawnAt) : null,
      status: row.status,
      evidenceReference: row.evidenceReference ?? null,
      correlationId: row.correlationId,
    };
  }
}
