import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { randomUUID } from 'crypto';

/**
 * Persistence abstraction for backtest runs, simulated trades, portfolio snapshots, metrics, and deterministic result references.
 * Do not write records into live order/fill tables.
 */
@Injectable()
export class BacktestRepository {
  private readonly logger = new Logger(BacktestRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async createRun(input: {
    tenantId: string;
    strategyVersionId: string;
    datasetId?: string | null;
    datasetFingerprint?: string | null;
    config: Record<string, any>;
    configFingerprint: string;
    timeframe: string;
    symbols: string[];
    startTime: Date;
    endTime: Date;
    initialCapital: string;
    quoteCurrency?: string;
    feeAssumption?: Record<string, any>;
    slippageAssumption?: Record<string, any>;
    latencyAssumption?: Record<string, any>;
    leverage?: string | null;
    benchmark?: string | null;
    executionModel?: Record<string, any>;
    runIdentifier: string;
    createdBy?: string | null;
    idempotencyKey?: string | null;
  }): Promise<any> {
    if (input.idempotencyKey) {
      const existing = await (this.prisma as any).researchBacktestRun.findFirst({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) {
        this.logger.log(`Backtest idempotent by key=${input.idempotencyKey}`);
        return existing;
      }
    }

    const existingByIdentifier = await (this.prisma as any).researchBacktestRun.findFirst({ where: { tenantId: input.tenantId, runIdentifier: input.runIdentifier } });
    if (existingByIdentifier) {
      this.logger.log(`Backtest duplicate by runIdentifier=${input.runIdentifier}`);
      return existingByIdentifier;
    }

    const id = randomUUID();
    const data = {
      id,
      tenantId: input.tenantId,
      strategyVersionId: input.strategyVersionId,
      datasetId: input.datasetId || null,
      datasetFingerprint: input.datasetFingerprint || null,
      status: 'QUEUED',
      config: input.config,
      configFingerprint: input.configFingerprint,
      timeframe: input.timeframe,
      symbols: input.symbols,
      startTime: input.startTime,
      endTime: input.endTime,
      initialCapital: input.initialCapital,
      quoteCurrency: input.quoteCurrency || 'USDT',
      feeAssumption: input.feeAssumption || {},
      slippageAssumption: input.slippageAssumption || {},
      latencyAssumption: input.latencyAssumption || {},
      leverage: input.leverage || null,
      benchmark: input.benchmark || null,
      executionModel: input.executionModel || {},
      runIdentifier: input.runIdentifier,
      idempotencyKey: input.idempotencyKey || null,
      createdBy: input.createdBy || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    try {
      const created = await (this.prisma as any).researchBacktestRun.create({ data });
      this.logger.log(`Backtest run created id=${created.id} tenant=${input.tenantId} identifier=${input.runIdentifier}`);
      return created;
    } catch (e: any) {
      if (e.code === 'P2002') {
        const existing = await (this.prisma as any).researchBacktestRun.findFirst({ where: { tenantId: input.tenantId, runIdentifier: input.runIdentifier } });
        if (existing) return existing;
      }
      throw e;
    }
  }

  async findById(id: string, tenantId: string): Promise<any | null> {
    return (this.prisma as any).researchBacktestRun.findFirst({ where: { id, tenantId } }) || null;
  }

  async findByRunIdentifier(tenantId: string, runIdentifier: string): Promise<any | null> {
    return (this.prisma as any).researchBacktestRun.findFirst({ where: { tenantId, runIdentifier } }) || null;
  }

  async listByStrategyVersion(tenantId: string, strategyVersionId: string, filters?: { status?: string; page?: number; limit?: number }): Promise<{ data: any[]; total: number }> {
    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    const skip = (page - 1) * limit;
    const where: any = { tenantId, strategyVersionId, ...(filters?.status ? { status: filters.status } : {}) };
    const [data, total] = await Promise.all([
      (this.prisma as any).researchBacktestRun.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
      (this.prisma as any).researchBacktestRun.count({ where }),
    ]);
    return { data, total };
  }

  async listByTenant(tenantId: string, filters?: { status?: string; page?: number; limit?: number }): Promise<{ data: any[]; total: number }> {
    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    const skip = (page - 1) * limit;
    const where: any = { tenantId, ...(filters?.status ? { status: filters.status } : {}) };
    const [data, total] = await Promise.all([
      (this.prisma as any).researchBacktestRun.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
      (this.prisma as any).researchBacktestRun.count({ where }),
    ]);
    return { data, total };
  }

  async updateStatus(id: string, tenantId: string, status: string, extra?: { startedAt?: Date; completedAt?: Date; errorCode?: string; errorSummary?: string; resultSummary?: Record<string, any>; metrics?: Record<string, any>; equityCurve?: any[] }): Promise<any | null> {
    try {
      return await (this.prisma as any).researchBacktestRun.update({ where: { id }, data: { status, ...extra, updatedAt: new Date() } });
    } catch { return null; }
  }

  async createTrade(input: { tenantId: string; backtestRunId: string; sequence: number; symbol: string; side: string; type: string; quantity: string; entryPrice: string; exitPrice?: string | null; grossPnl?: string | null; fee?: string; netPnl?: string | null; isWin?: boolean | null; openedAt: Date; closedAt?: Date | null; holdingMs?: number | null }): Promise<any> {
    const id = randomUUID();
    const data = {
      id,
      tenantId: input.tenantId,
      backtestRunId: input.backtestRunId,
      sequence: input.sequence,
      symbol: input.symbol,
      side: input.side,
      type: input.type,
      quantity: input.quantity,
      entryPrice: input.entryPrice,
      exitPrice: input.exitPrice || null,
      grossPnl: input.grossPnl || null,
      fee: input.fee || '0',
      netPnl: input.netPnl || null,
      isWin: input.isWin ?? null,
      openedAt: input.openedAt,
      closedAt: input.closedAt || null,
      holdingMs: input.holdingMs || null,
      isSimulated: true,
      createdAt: new Date(),
    };
    try {
      return await (this.prisma as any).researchBacktestTrade.create({ data });
    } catch (e: any) {
      if (e.code === 'P2002') {
        const existing = await (this.prisma as any).researchBacktestTrade.findFirst({ where: { backtestRunId: input.backtestRunId, sequence: input.sequence } });
        if (existing) return existing;
      }
      throw e;
    }
  }

  async listTrades(tenantId: string, backtestRunId: string, filters?: { page?: number; limit?: number }): Promise<{ data: any[]; total: number }> {
    const page = filters?.page || 1;
    const limit = filters?.limit || 100;
    const skip = (page - 1) * limit;
    const where: any = { tenantId, backtestRunId };
    const [data, total] = await Promise.all([
      (this.prisma as any).researchBacktestTrade.findMany({ where, orderBy: { sequence: 'asc' }, skip, take: limit }),
      (this.prisma as any).researchBacktestTrade.count({ where }),
    ]);
    return { data, total };
  }

  async createSnapshot(input: { tenantId: string; backtestRunId: string; sequence: number; timestamp: Date; cash: string; equity: string; exposure?: string | null; realizedPnl?: string; unrealizedPnl?: string | null; drawdown?: string | null }): Promise<any> {
    const id = randomUUID();
    const data = {
      id,
      tenantId: input.tenantId,
      backtestRunId: input.backtestRunId,
      sequence: input.sequence,
      timestamp: input.timestamp,
      cash: input.cash,
      equity: input.equity,
      exposure: input.exposure || null,
      realizedPnl: input.realizedPnl || '0',
      unrealizedPnl: input.unrealizedPnl || null,
      drawdown: input.drawdown || null,
      createdAt: new Date(),
    };
    try {
      return await (this.prisma as any).researchBacktestSnapshot.create({ data });
    } catch (e: any) {
      if (e.code === 'P2002') {
        const existing = await (this.prisma as any).researchBacktestSnapshot.findFirst({ where: { backtestRunId: input.backtestRunId, sequence: input.sequence } });
        if (existing) return existing;
      }
      throw e;
    }
  }

  async listSnapshots(tenantId: string, backtestRunId: string): Promise<any[]> {
    return (this.prisma as any).researchBacktestSnapshot.findMany({ where: { tenantId, backtestRunId }, orderBy: { sequence: 'asc' } }) || [];
  }
}
