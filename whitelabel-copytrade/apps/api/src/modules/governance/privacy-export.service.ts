import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrivacyExport, GovernanceActionType, DataClassification } from './governance.types';
import { PrivacyDiscoveryService, DiscoveryResult } from './privacy-discovery.service';
import { GovernancePolicyService } from './governance-policy.service';
import { GovernanceAuditService } from './governance-audit.service';
import { DataClassificationService } from './data-classification.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import * as crypto from 'crypto';

@Injectable()
export class PrivacyExportService {
  private readonly logger = new Logger(PrivacyExportService.name);
  private readonly inMemory: Map<string, PrivacyExport> = new Map();

  constructor(
    private readonly discovery: PrivacyDiscoveryService,
    private readonly policyService: GovernancePolicyService,
    private readonly audit: GovernanceAuditService,
    private readonly classification: DataClassificationService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async generateExport(params: {
    tenantId: string;
    requestId: string;
    subjectUserId: string;
    jurisdiction: string;
    correlationId: string;
    operatorId: string;
    discoveryResult?: DiscoveryResult;
  }): Promise<PrivacyExport> {
    if (!params.tenantId || !params.subjectUserId || !params.requestId) {
      throw new BadRequestException('tenantId, subjectUserId, requestId required');
    }
    this.policyService.validateJurisdiction(params.jurisdiction);

    const discovery = params.discoveryResult ?? (await this.discovery.discoverForSubject({
      tenantId: params.tenantId,
      subjectUserId: params.subjectUserId,
      jurisdiction: params.jurisdiction,
      correlationId: params.correlationId,
    }));

    const policy = this.policyService.buildPolicy(params.tenantId, params.jurisdiction);
    const eligibleClasses: DataClassification[] = [];
    for (const dc of discovery.locations.flatMap((l) => l.dataClasses)) {
      if (this.classification.isExportAllowed(dc, policy)) {
        if (!eligibleClasses.includes(dc)) eligibleClasses.push(dc);
      }
    }

    const exportRecord: PrivacyExport = {
      id: `pex_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      tenantId: params.tenantId,
      requestId: params.requestId,
      subjectUserId: params.subjectUserId,
      exportVersion: `v${policy.policyVersion}_${new Date().toISOString().slice(0, 10)}`,
      dataAsOf: discovery.generatedAt,
      generatedAt: new Date().toISOString(),
      dataCategories: eligibleClasses,
      sourceReferences: discovery.sourceReferences,
      recordCount: discovery.totalRecords,
      fileLocation: null,
      fileHash: null,
      methodology: `AUTHORITATIVE_SOURCE_AGGREGATION: inventory discovery deterministic sorted, export eligibility filtered by policy ${policy.policyVersion}`,
      policyVersion: policy.policyVersion,
      correlationId: params.correlationId,
      isDeterministic: true,
    };

    // Deterministic hash of content (not including actual PII, only references)
    const contentForHash = JSON.stringify({
      tenantId: exportRecord.tenantId,
      subjectUserId: exportRecord.subjectUserId,
      dataAsOf: exportRecord.dataAsOf,
      sourceReferences: [...exportRecord.sourceReferences].sort(),
      dataCategories: [...exportRecord.dataCategories].sort(),
      policyVersion: exportRecord.policyVersion,
    });
    exportRecord.fileHash = crypto.createHash('sha256').update(contentForHash).digest('hex');
    exportRecord.fileLocation = `governance/exports/${params.tenantId}/${exportRecord.id}.json`;

    this.inMemory.set(exportRecord.id, exportRecord);
    try {
      await (this.prisma as any).privacyExport?.create?.({
        data: {
          id: exportRecord.id,
          tenantId: exportRecord.tenantId,
          requestId: exportRecord.requestId,
          subjectUserId: exportRecord.subjectUserId,
          exportVersion: exportRecord.exportVersion,
          dataAsOf: new Date(exportRecord.dataAsOf),
          generatedAt: new Date(exportRecord.generatedAt),
          dataCategories: exportRecord.dataCategories,
          sourceReferences: exportRecord.sourceReferences,
          recordCount: exportRecord.recordCount,
          fileLocation: exportRecord.fileLocation,
          fileHash: exportRecord.fileHash,
          methodology: exportRecord.methodology,
          policyVersion: exportRecord.policyVersion,
          correlationId: exportRecord.correlationId,
          isDeterministic: exportRecord.isDeterministic,
        },
      });
    } catch {
      this.logger.debug(`privacyExport persist skipped id=${exportRecord.id}`);
    }

    await this.audit.recordEvent({
      tenantId: params.tenantId,
      actionType: GovernanceActionType.PRIVACY_EXPORT,
      subjectUserId: params.subjectUserId,
      requestId: params.requestId,
      state: 'EXPORT_GENERATED',
      result: 'SUCCESS',
      correlationId: params.correlationId,
      createdBy: params.operatorId,
      safeEvidence: { exportId: exportRecord.id, recordCount: exportRecord.recordCount, fileHash: exportRecord.fileHash },
    });

    this.logger.log(`export generated id=${exportRecord.id} tenant=${params.tenantId} records=${exportRecord.recordCount} corr=${params.correlationId}`);
    return exportRecord;
  }

  async getExport(tenantId: string, exportId: string): Promise<PrivacyExport> {
    const mem = this.inMemory.get(exportId);
    if (mem) {
      this.policyService.assertTenantIsolation(tenantId, mem.tenantId);
      return mem;
    }
    try {
      const row = await (this.prisma as any).privacyExport?.findUnique?.({ where: { id: exportId } });
      if (row) {
        this.policyService.assertTenantIsolation(tenantId, row.tenantId);
        return this.mapRow(row);
      }
    } catch {
      /* ignore */
    }
    throw new BadRequestException(`export ${exportId} not found`);
  }

  async listExports(tenantId: string, requestId?: string): Promise<PrivacyExport[]> {
    let list = [...this.inMemory.values()].filter((r) => r.tenantId === tenantId);
    if (requestId) list = list.filter((r) => r.requestId === requestId);
    try {
      const where: any = { tenantId };
      if (requestId) where.requestId = requestId;
      const rows = await (this.prisma as any).privacyExport?.findMany?.({ where, take: 200, orderBy: { generatedAt: 'desc' } });
      if (rows && rows.length > 0) list = rows.map((r: any) => this.mapRow(r));
    } catch {
      /* ignore */
    }
    return list;
  }

  private mapRow(row: any): PrivacyExport {
    return {
      id: row.id,
      tenantId: row.tenantId,
      requestId: row.requestId,
      subjectUserId: row.subjectUserId,
      exportVersion: row.exportVersion,
      dataAsOf: row.dataAsOf instanceof Date ? row.dataAsOf.toISOString() : row.dataAsOf,
      generatedAt: row.generatedAt instanceof Date ? row.generatedAt.toISOString() : row.generatedAt,
      dataCategories: row.dataCategories,
      sourceReferences: row.sourceReferences,
      recordCount: row.recordCount,
      fileLocation: row.fileLocation ?? null,
      fileHash: row.fileHash ?? null,
      methodology: row.methodology,
      policyVersion: row.policyVersion,
      correlationId: row.correlationId,
      isDeterministic: !!row.isDeterministic,
    };
  }
}
