import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { randomUUID, createHash } from 'crypto';
import { ResearchDatasetStatus, ResearchStrategyVersionStatus } from './research.types';

/**
 * Persistence abstraction for research project, strategy version reference, dataset metadata, backtest run, metrics, validation state, promotion state, and result references with tenant isolation.
 */
@Injectable()
export class ResearchRepository {
  private readonly logger = new Logger(ResearchRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  // Datasets
  async createDataset(input: {
    tenantId: string;
    name: string;
    description?: string | null;
    venue: string;
    symbol: string;
    timeframe: string;
    timezone?: string;
    source: string;
    sourceMetadata?: Record<string, any>;
    startTime: Date;
    endTime: Date;
    fingerprint: string;
    checksum?: string | null;
    status?: ResearchDatasetStatus;
    recordCount?: number;
    gapCount?: number;
    duplicateCount?: number;
    validationResult?: Record<string, any> | null;
    qualityScore?: number | null;
    createdBy?: string | null;
    idempotencyKey?: string | null;
  }): Promise<any> {
    if (input.idempotencyKey) {
      const existing = await (this.prisma as any).researchDataset.findFirst({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) return existing;
    }

    const existingByFingerprint = await (this.prisma as any).researchDataset.findFirst({ where: { tenantId: input.tenantId, fingerprint: input.fingerprint } });
    if (existingByFingerprint) {
      this.logger.log(`Dataset idempotent by fingerprint tenant=${input.tenantId} fp=${input.fingerprint}`);
      return existingByFingerprint;
    }

    const id = randomUUID();
    const data = {
      id,
      tenantId: input.tenantId,
      name: input.name,
      description: input.description || null,
      venue: input.venue,
      symbol: input.symbol,
      timeframe: input.timeframe,
      timezone: input.timezone || 'UTC',
      source: input.source,
      sourceMetadata: input.sourceMetadata || {},
      startTime: input.startTime,
      endTime: input.endTime,
      fingerprint: input.fingerprint,
      checksum: input.checksum || null,
      status: input.status || 'DRAFT',
      recordCount: input.recordCount || 0,
      gapCount: input.gapCount || 0,
      duplicateCount: input.duplicateCount || 0,
      validationResult: input.validationResult || null,
      qualityScore: input.qualityScore || null,
      idempotencyKey: input.idempotencyKey || null,
      createdBy: input.createdBy || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    try {
      const created = await (this.prisma as any).researchDataset.create({ data });
      this.logger.log(`Research dataset created id=${created.id} tenant=${input.tenantId} fingerprint=${input.fingerprint}`);
      return created;
    } catch (e: any) {
      if (e.code === 'P2002') {
        const existing = await (this.prisma as any).researchDataset.findFirst({ where: { tenantId: input.tenantId, fingerprint: input.fingerprint } });
        if (existing) return existing;
      }
      throw e;
    }
  }

  async findDatasetById(id: string, tenantId: string): Promise<any | null> {
    return (this.prisma as any).researchDataset.findFirst({ where: { id, tenantId, deletedAt: null } }) || null;
  }

  async findDatasetByFingerprint(tenantId: string, fingerprint: string): Promise<any | null> {
    return (this.prisma as any).researchDataset.findFirst({ where: { tenantId, fingerprint, deletedAt: null } }) || null;
  }

  async listDatasets(tenantId: string, filters?: { venue?: string; symbol?: string; timeframe?: string; status?: string; page?: number; limit?: number }): Promise<{ data: any[]; total: number }> {
    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    const skip = (page - 1) * limit;
    const where: any = { tenantId, deletedAt: null, ...(filters?.venue ? { venue: filters.venue } : {}), ...(filters?.symbol ? { symbol: filters.symbol } : {}), ...(filters?.timeframe ? { timeframe: filters.timeframe } : {}), ...(filters?.status ? { status: filters.status } : {}) };
    const [data, total] = await Promise.all([
      (this.prisma as any).researchDataset.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
      (this.prisma as any).researchDataset.count({ where }),
    ]);
    return { data, total };
  }

  async updateDatasetStatus(id: string, tenantId: string, status: ResearchDatasetStatus, validationResult?: Record<string, any> | null): Promise<any | null> {
    try {
      return await (this.prisma as any).researchDataset.update({ where: { id }, data: { status, validationResult, updatedAt: new Date() } });
    } catch { return null; }
  }

  // Strategy Versions
  async createStrategyVersion(input: {
    tenantId: string;
    strategyId?: string | null;
    traderStrategyId?: string | null;
    definitionId?: string | null;
    version: string;
    name: string;
    description?: string | null;
    logicHash: string;
    configHash: string;
    fingerprint: string;
    parameters?: Record<string, any>;
    riskProfile?: Record<string, any>;
    executionModel?: Record<string, any>;
    parentVersionId?: string | null;
    changeNote?: string | null;
    createdBy?: string | null;
    idempotencyKey?: string | null;
  }): Promise<any> {
    if (input.idempotencyKey) {
      const existing = await (this.prisma as any).researchStrategyVersion.findFirst({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) return existing;
    }

    const existingFp = await (this.prisma as any).researchStrategyVersion.findFirst({ where: { tenantId: input.tenantId, fingerprint: input.fingerprint } });
    if (existingFp) return existingFp;

    const id = randomUUID();
    const data = {
      id,
      tenantId: input.tenantId,
      strategyId: input.strategyId || null,
      traderStrategyId: input.traderStrategyId || null,
      definitionId: input.definitionId || null,
      version: input.version,
      name: input.name,
      description: input.description || null,
      status: 'DRAFT',
      logicHash: input.logicHash,
      configHash: input.configHash,
      fingerprint: input.fingerprint,
      parameters: input.parameters || {},
      riskProfile: input.riskProfile || {},
      executionModel: input.executionModel || {},
      parentVersionId: input.parentVersionId || null,
      changeNote: input.changeNote || null,
      idempotencyKey: input.idempotencyKey || null,
      createdBy: input.createdBy || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    try {
      const created = await (this.prisma as any).researchStrategyVersion.create({ data });
      this.logger.log(`Research strategy version created id=${created.id} tenant=${input.tenantId} version=${input.version}`);
      return created;
    } catch (e: any) {
      if (e.code === 'P2002') {
        const existing = await (this.prisma as any).researchStrategyVersion.findFirst({ where: { tenantId: input.tenantId, fingerprint: input.fingerprint } });
        if (existing) return existing;
      }
      throw e;
    }
  }

  async findStrategyVersionById(id: string, tenantId: string): Promise<any | null> {
    return (this.prisma as any).researchStrategyVersion.findFirst({ where: { id, tenantId, deletedAt: null } }) || null;
  }

  async listStrategyVersions(tenantId: string, filters?: { strategyId?: string; status?: string; page?: number; limit?: number }): Promise<{ data: any[]; total: number }> {
    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    const skip = (page - 1) * limit;
    const where: any = { tenantId, deletedAt: null, ...(filters?.strategyId ? { strategyId: filters.strategyId } : {}), ...(filters?.status ? { status: filters.status } : {}) };
    const [data, total] = await Promise.all([
      (this.prisma as any).researchStrategyVersion.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
      (this.prisma as any).researchStrategyVersion.count({ where }),
    ]);
    return { data, total };
  }

  async updateStrategyVersionStatus(id: string, tenantId: string, status: ResearchStrategyVersionStatus, extra?: { frozenAt?: Date; publishedAt?: Date; deprecatedAt?: Date }): Promise<any | null> {
    try {
      return await (this.prisma as any).researchStrategyVersion.update({ where: { id }, data: { status, ...extra, updatedAt: new Date() } });
    } catch { return null; }
  }

  // Audit logs helper
  async createAuditLog(input: { tenantId: string; event: string; actorId?: string | null; strategyVersionId?: string | null; datasetId?: string | null; backtestRunId?: string | null; paperSessionId?: string | null; signalId?: string | null; promotionId?: string | null; result?: string; safeMetadata?: Record<string, any>; requestId?: string | null }): Promise<any> {
    try {
      return await (this.prisma as any).researchAuditLog.create({
        data: {
          id: randomUUID(),
          tenantId: input.tenantId,
          event: input.event,
          actorId: input.actorId || null,
          strategyVersionId: input.strategyVersionId || null,
          datasetId: input.datasetId || null,
          backtestRunId: input.backtestRunId || null,
          paperSessionId: input.paperSessionId || null,
          signalId: input.signalId || null,
          promotionId: input.promotionId || null,
          result: input.result || 'SUCCESS',
          safeMetadata: input.safeMetadata || {},
          requestId: input.requestId || null,
          createdAt: new Date(),
        },
      });
    } catch { return null; }
  }

  computeFingerprint(data: Record<string, any>): string {
    const hash = createHash('sha256');
    hash.update(JSON.stringify(data, Object.keys(data).sort()));
    return hash.digest('hex');
  }
}
