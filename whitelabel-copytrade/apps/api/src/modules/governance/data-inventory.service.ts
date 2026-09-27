import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { DataClassification } from './governance.types';
import { DataClassificationService } from './data-classification.service';
import { GovernancePolicyService } from './governance-policy.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export interface DataInventoryRecord {
  id: string;
  tenantId: string;
  subjectUserId?: string | null;
  sourceSystem: string;
  sourceTable: string;
  sourceId: string;
  dataClasses: DataClassification[];
  jurisdiction: string;
  retentionStartAt: string;
  locationReference: string;
  recordHash: string;
  correlationId: string;
  lastSeenAt: string;
  policyVersion: string;
}

@Injectable()
export class DataInventoryService {
  private readonly logger = new Logger(DataInventoryService.name);

  constructor(
    private readonly classificationService: DataClassificationService,
    private readonly policyService: GovernancePolicyService,
    private readonly prisma: PrismaService,
  ) {}

  async upsertInventory(params: {
    tenantId: string;
    subjectUserId?: string;
    sourceSystem: string;
    sourceTable: string;
    sourceId: string;
    fields: string[];
    jurisdiction: string;
    locationReference: string;
    correlationId: string;
  }): Promise<DataInventoryRecord> {
    if (!params.tenantId) throw new BadRequestException('tenantId required');
    if (!params.sourceId) throw new BadRequestException('sourceId required');
    this.policyService.validateJurisdiction(params.jurisdiction);

    const dataClasses = params.fields.map((f) => this.classificationService.classifyField(f, params.sourceSystem));
    const unique = [...new Set(dataClasses)];

    const record: DataInventoryRecord = {
      id: `dinv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      tenantId: params.tenantId,
      subjectUserId: params.subjectUserId ?? null,
      sourceSystem: params.sourceSystem,
      sourceTable: params.sourceTable,
      sourceId: params.sourceId,
      dataClasses: unique,
      jurisdiction: params.jurisdiction.toUpperCase(),
      retentionStartAt: new Date().toISOString(),
      locationReference: params.locationReference,
      recordHash: this.hashLocation(params.locationReference + params.sourceId),
      correlationId: params.correlationId,
      lastSeenAt: new Date().toISOString(),
      policyVersion: this.policyService.getPolicyVersion(),
    };

    try {
      await (this.prisma as any).governanceDataInventory?.upsert?.({
        where: { tenantId_sourceSystem_sourceId: { tenantId: params.tenantId, sourceSystem: params.sourceSystem, sourceId: params.sourceId } },
        create: {
          id: record.id,
          tenantId: record.tenantId,
          subjectUserId: record.subjectUserId,
          sourceSystem: record.sourceSystem,
          sourceTable: record.sourceTable,
          sourceId: record.sourceId,
          dataClasses: record.dataClasses,
          jurisdiction: record.jurisdiction,
          retentionStartAt: new Date(record.retentionStartAt),
          locationReference: record.locationReference,
          recordHash: record.recordHash,
          correlationId: record.correlationId,
          lastSeenAt: new Date(record.lastSeenAt),
          policyVersion: record.policyVersion,
        },
        update: {
          dataClasses: record.dataClasses,
          jurisdiction: record.jurisdiction,
          lastSeenAt: new Date(record.lastSeenAt),
          correlationId: record.correlationId,
        },
      });
    } catch {
      this.logger.debug(`inventory persist skipped tenant=${params.tenantId} sourceId=${params.sourceId}`);
    }

    this.logger.log(`inventory upsert tenant=${params.tenantId} source=${params.sourceSystem}/${params.sourceTable} corr=${params.correlationId}`);
    return record;
  }

  private hashLocation(input: string): string {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
    }
    return `sha_${hash.toString(16)}`;
  }

  async listForSubject(tenantId: string, subjectUserId: string): Promise<DataInventoryRecord[]> {
    if (!tenantId || !subjectUserId) throw new BadRequestException('tenantId and subjectUserId required');
    try {
      const rows = await (this.prisma as any).governanceDataInventory?.findMany?.({
        where: { tenantId, subjectUserId },
        take: 1000,
        orderBy: { lastSeenAt: 'desc' },
      });
      if (rows) {
        return rows.map((r: any) => ({
          id: r.id,
          tenantId: r.tenantId,
          subjectUserId: r.subjectUserId,
          sourceSystem: r.sourceSystem,
          sourceTable: r.sourceTable,
          sourceId: r.sourceId,
          dataClasses: r.dataClasses,
          jurisdiction: r.jurisdiction,
          retentionStartAt: r.retentionStartAt instanceof Date ? r.retentionStartAt.toISOString() : r.retentionStartAt,
          locationReference: r.locationReference,
          recordHash: r.recordHash,
          correlationId: r.correlationId,
          lastSeenAt: r.lastSeenAt instanceof Date ? r.lastSeenAt.toISOString() : r.lastSeenAt,
          policyVersion: r.policyVersion,
        }));
      }
    } catch {
      this.logger.debug(`listForSubject fallback tenant=${tenantId}`);
    }
    return [];
  }

  async listForTenant(tenantId: string, filters?: { dataClass?: DataClassification; sourceSystem?: string }): Promise<DataInventoryRecord[]> {
    if (!tenantId) throw new BadRequestException('tenantId required');
    try {
      const where: any = { tenantId };
      if (filters?.sourceSystem) where.sourceSystem = filters.sourceSystem;
      const rows = await (this.prisma as any).governanceDataInventory?.findMany?.({
        where,
        take: 1000,
        orderBy: { lastSeenAt: 'desc' },
      });
      if (rows) {
        let mapped = rows.map((r: any) => ({
          id: r.id,
          tenantId: r.tenantId,
          subjectUserId: r.subjectUserId,
          sourceSystem: r.sourceSystem,
          sourceTable: r.sourceTable,
          sourceId: r.sourceId,
          dataClasses: r.dataClasses,
          jurisdiction: r.jurisdiction,
          retentionStartAt: r.retentionStartAt instanceof Date ? r.retentionStartAt.toISOString() : r.retentionStartAt,
          locationReference: r.locationReference,
          recordHash: r.recordHash,
          correlationId: r.correlationId,
          lastSeenAt: r.lastSeenAt instanceof Date ? r.lastSeenAt.toISOString() : r.lastSeenAt,
          policyVersion: r.policyVersion,
        }));
        if (filters?.dataClass) {
          mapped = mapped.filter((m: DataInventoryRecord) => m.dataClasses.includes(filters.dataClass!));
        }
        return mapped;
      }
    } catch {
      this.logger.debug(`listForTenant fallback tenant=${tenantId}`);
    }
    return [];
  }
}
