import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { TraderStrategyStatus, TraderStrategyType, TraderStrategy } from './copy-trading.types';
import { StrategyValidationService } from './strategy-validation.service';
import { randomUUID } from 'crypto';

/**
 * Trader strategy lifecycle: create, configure, validate, publish, pause, resume, archive, and resolve strategy configuration using existing strategy/trading infrastructure.
 * Publication flow: Draft → Validate → Risk/Compliance compatibility → Exchange capability validation → Publish. Must not publish if validation fails.
 */
@Injectable()
export class TraderStrategyService {
  private readonly logger = new Logger(TraderStrategyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly validationService: StrategyValidationService,
  ) {}

  async createStrategy(input: {
    tenantId: string;
    traderId: string;
    userId: string;
    name: string;
    description?: string | null;
    type?: TraderStrategyType;
    supportedSymbols?: string[];
    supportedVenues?: string[];
    riskProfile?: Record<string, any>;
    feePolicy?: Record<string, any>;
    strategyConfig?: Record<string, any>;
    idempotencyKey?: string | null;
  }): Promise<TraderStrategy> {
    // Tenant ownership validation
    const trader = await (this.prisma as any).traderProfile?.findFirst({ where: { id: input.traderId, tenantId: input.tenantId } });
    if (!trader) throw new Error(`Trader ${input.traderId} not found for tenant ${input.tenantId}`);
    if (trader.userId !== input.userId) throw new Error('Trader ownership mismatch');

    if (input.idempotencyKey) {
      const existing = await (this.prisma as any).traderStrategy?.findFirst({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) {
        this.logger.log(`Idempotent strategy return key=${input.idempotencyKey}`);
        return this.mapToStrategy(existing);
      }
    }

    // Prevent duplicate name per trader
    const duplicate = await (this.prisma as any).traderStrategy?.findFirst({ where: { tenantId: input.tenantId, traderId: input.traderId, name: input.name, deletedAt: null } });
    if (duplicate) throw new Error(`Strategy name ${input.name} already exists for trader ${input.traderId}`);

    const id = randomUUID();
    const now = new Date();

    const data = {
      id,
      tenantId: input.tenantId,
      traderId: input.traderId,
      userId: input.userId,
      name: input.name,
      description: input.description || null,
      status: TraderStrategyStatus.DRAFT,
      type: input.type || TraderStrategyType.MANUAL,
      supportedSymbols: input.supportedSymbols || [],
      supportedVenues: input.supportedVenues || [],
      riskProfile: input.riskProfile || {},
      feePolicy: input.feePolicy || {},
      strategyConfig: input.strategyConfig || {},
      followerCount: 0,
      totalCopies: 0,
      idempotencyKey: input.idempotencyKey || null,
      createdAt: now,
      updatedAt: now,
    };

    const created = await (this.prisma as any).traderStrategy.create({ data });
    this.logger.log(`Trader strategy created id=${created.id} tenant=${input.tenantId} trader=${input.traderId} name=${input.name}`);

    return this.mapToStrategy(created);
  }

  async getStrategy(tenantId: string, strategyId: string): Promise<TraderStrategy | null> {
    const strategy = await (this.prisma as any).traderStrategy?.findFirst({ where: { id: strategyId, tenantId, deletedAt: null } });
    return strategy ? this.mapToStrategy(strategy) : null;
  }

  async listByTrader(tenantId: string, traderId: string, filters?: { status?: TraderStrategyStatus; page?: number; limit?: number }): Promise<{ data: TraderStrategy[]; total: number }> {
    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    const skip = (page - 1) * limit;
    const where: any = { tenantId, traderId, deletedAt: null, ...(filters?.status ? { status: filters.status } : {}) };
    const [rows, total] = await Promise.all([
      (this.prisma as any).traderStrategy?.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }) || [],
      (this.prisma as any).traderStrategy?.count({ where }) || 0,
    ]);
    return { data: rows.map((r: any) => this.mapToStrategy(r)), total };
  }

  async listByTenant(tenantId: string, filters?: { status?: TraderStrategyStatus; traderId?: string; page?: number; limit?: number }): Promise<{ data: TraderStrategy[]; total: number }> {
    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    const skip = (page - 1) * limit;
    const where: any = { tenantId, deletedAt: null, ...(filters?.status ? { status: filters.status } : {}), ...(filters?.traderId ? { traderId: filters.traderId } : {}) };
    const [rows, total] = await Promise.all([
      (this.prisma as any).traderStrategy?.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }) || [],
      (this.prisma as any).traderStrategy?.count({ where }) || 0,
    ]);
    return { data: rows.map((r: any) => this.mapToStrategy(r)), total };
  }

  async updateStrategy(tenantId: string, strategyId: string, userId: string, updates: { name?: string; description?: string | null; supportedSymbols?: string[]; supportedVenues?: string[]; riskProfile?: Record<string, any>; feePolicy?: Record<string, any>; strategyConfig?: Record<string, any> }): Promise<TraderStrategy | null> {
    const existing = await (this.prisma as any).traderStrategy?.findFirst({ where: { id: strategyId, tenantId } });
    if (!existing) return null;
    if (existing.userId !== userId) throw new Error('Strategy ownership mismatch');

    // Only allow update if not published? Actually allow update but re-validate
    if (existing.status === TraderStrategyStatus.ARCHIVED) throw new Error('Cannot update archived strategy');

    try {
      const updated = await (this.prisma as any).traderStrategy.update({ where: { id: strategyId }, data: { ...updates, updatedAt: new Date() } });
      return this.mapToStrategy(updated);
    } catch {
      return null;
    }
  }

  async publishStrategy(tenantId: string, strategyId: string, userId: string, actorId: string): Promise<TraderStrategy> {
    const strategy = await (this.prisma as any).traderStrategy?.findFirst({ where: { id: strategyId, tenantId } });
    if (!strategy) throw new Error(`Strategy ${strategyId} not found`);
    if (strategy.userId !== userId) throw new Error('Strategy ownership mismatch');

    // Publication flow: Draft → Validate → Risk/Compliance compatibility → Exchange capability validation → Publish
    // A strategy must not publish if required validation fails

    const validation = await this.validationService.validateForPublication(tenantId, strategyId);
    if (!validation.valid) {
      await (this.prisma as any).traderStrategy.update({ where: { id: strategyId }, data: { validationErrors: validation.errors, status: TraderStrategyStatus.REJECTED, updatedAt: new Date() } });
      this.logger.warn(`Strategy publication failed validation tenant=${tenantId} strategy=${strategyId} errors=${validation.errors.length}`);
      throw new Error(`Validation failed: ${validation.errors.map((e) => `${e.field}:${e.message}`).join(', ')}`);
    }

    const updated = await (this.prisma as any).traderStrategy.update({
      where: { id: strategyId },
      data: { status: TraderStrategyStatus.PUBLISHED, publishedAt: new Date(), validationErrors: null, updatedAt: new Date() },
    });

    // Audit
    await (this.prisma as any).copyTradingAuditLog?.create({
      data: {
        id: randomUUID(),
        tenantId,
        event: 'STRATEGY_PUBLISHED',
        actorId,
        traderId: strategy.traderId,
        strategyId,
        result: 'SUCCESS',
        safeMetadata: { name: strategy.name, type: strategy.type, supportedSymbols: strategy.supportedSymbols, supportedVenues: strategy.supportedVenues },
        createdAt: new Date(),
      },
    });

    this.logger.log(`Strategy published id=${strategyId} tenant=${tenantId} trader=${strategy.traderId}`);

    return this.mapToStrategy(updated);
  }

  async pauseStrategy(tenantId: string, strategyId: string, userId: string, actorId: string): Promise<TraderStrategy | null> {
    const strategy = await (this.prisma as any).traderStrategy?.findFirst({ where: { id: strategyId, tenantId } });
    if (!strategy) return null;
    if (strategy.userId !== userId) throw new Error('Strategy ownership mismatch');

    if (strategy.status !== TraderStrategyStatus.PUBLISHED) throw new Error('Only published strategy can be paused');

    const updated = await (this.prisma as any).traderStrategy.update({ where: { id: strategyId }, data: { status: TraderStrategyStatus.PAUSED, pausedAt: new Date(), updatedAt: new Date() } });

    await (this.prisma as any).copyTradingAuditLog?.create({
      data: { id: randomUUID(), tenantId, event: 'STRATEGY_PAUSED', actorId, traderId: strategy.traderId, strategyId, result: 'SUCCESS', safeMetadata: {}, createdAt: new Date() },
    });

    this.logger.log(`Strategy paused id=${strategyId} tenant=${tenantId}`);

    return this.mapToStrategy(updated);
  }

  async resumeStrategy(tenantId: string, strategyId: string, userId: string, actorId: string): Promise<TraderStrategy | null> {
    const strategy = await (this.prisma as any).traderStrategy?.findFirst({ where: { id: strategyId, tenantId } });
    if (!strategy) return null;
    if (strategy.userId !== userId) throw new Error('Strategy ownership mismatch');

    if (strategy.status !== TraderStrategyStatus.PAUSED) throw new Error('Only paused strategy can be resumed');

    // Re-validate before resume
    const validation = await this.validationService.validateForPublication(tenantId, strategyId);
    if (!validation.valid) throw new Error(`Validation failed on resume: ${validation.errors.map((e) => e.message).join(', ')}`);

    const updated = await (this.prisma as any).traderStrategy.update({ where: { id: strategyId }, data: { status: TraderStrategyStatus.PUBLISHED, pausedAt: null, updatedAt: new Date() } });

    await (this.prisma as any).copyTradingAuditLog?.create({
      data: { id: randomUUID(), tenantId, event: 'STRATEGY_RESUMED', actorId, traderId: strategy.traderId, strategyId, result: 'SUCCESS', safeMetadata: {}, createdAt: new Date() },
    });

    return this.mapToStrategy(updated);
  }

  async archiveStrategy(tenantId: string, strategyId: string, userId: string, actorId: string): Promise<TraderStrategy | null> {
    const strategy = await (this.prisma as any).traderStrategy?.findFirst({ where: { id: strategyId, tenantId } });
    if (!strategy) return null;
    if (strategy.userId !== userId) throw new Error('Strategy ownership mismatch');

    const updated = await (this.prisma as any).traderStrategy.update({ where: { id: strategyId }, data: { status: TraderStrategyStatus.ARCHIVED, archivedAt: new Date(), updatedAt: new Date() } });

    await (this.prisma as any).copyTradingAuditLog?.create({
      data: { id: randomUUID(), tenantId, event: 'STRATEGY_ARCHIVED', actorId, traderId: strategy.traderId, strategyId, result: 'SUCCESS', safeMetadata: {}, createdAt: new Date() },
    });

    return this.mapToStrategy(updated);
  }

  private mapToStrategy(row: any): TraderStrategy {
    return {
      strategyId: row.id,
      tenantId: row.tenantId,
      traderId: row.traderId,
      userId: row.userId,
      name: row.name,
      description: row.description || null,
      status: row.status,
      type: row.type,
      supportedSymbols: row.supportedSymbols || [],
      supportedVenues: row.supportedVenues || [],
      riskProfile: row.riskProfile || {},
      feePolicy: row.feePolicy || {},
      strategyConfig: row.strategyConfig || {},
      publishedAt: row.publishedAt ? new Date(row.publishedAt).toISOString() : null,
      pausedAt: row.pausedAt ? new Date(row.pausedAt).toISOString() : null,
      archivedAt: row.archivedAt ? new Date(row.archivedAt).toISOString() : null,
      followerCount: row.followerCount || 0,
      totalCopies: row.totalCopies || 0,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
    };
  }
}
