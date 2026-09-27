import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ResearchRepository } from './research-repository';
import { ResearchSignalState, ResearchSignalSide } from './signal.types';
import { randomUUID, createHash } from 'crypto';

/**
 * Creates, validates, deduplicates, stores, and publishes strategy signals to the existing strategy/copy-trading integration boundary.
 * Do not place exchange orders here.
 */
@Injectable()
export class SignalService {
  private readonly logger = new Logger(SignalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly researchRepo: ResearchRepository,
  ) {}

  private fingerprintSignal(input: { strategyVersionId: string; symbol: string; side: string; timestamp: string; price?: string | null; quantity?: string | null }): string {
    const hash = createHash('sha256');
    hash.update(`${input.strategyVersionId}|${input.symbol}|${input.side}|${input.timestamp}|${input.price||''}|${input.quantity||''}`);
    return hash.digest('hex');
  }

  async createSignal(input: {
    tenantId: string;
    strategyVersionId: string;
    symbol: string;
    side: ResearchSignalSide;
    strength?: string | null;
    confidence?: string | null;
    price?: string | null;
    quantity?: string | null;
    timestamp: Date;
    expiresAt?: Date | null;
    sourceEvent?: Record<string, any> | null;
    metadata?: Record<string, any>;
    idempotencyKey?: string | null;
    createdBy?: string | null;
  }): Promise<any> {
    // Validate strategy version exists and is PUBLISHED
    const strategyVersion = await this.researchRepo.findStrategyVersionById(input.strategyVersionId, input.tenantId);
    if (!strategyVersion) throw new Error(`Strategy version ${input.strategyVersionId} not found`);
    if (!['PUBLISHED','FROZEN'].includes(strategyVersion.status)) throw new Error(`Strategy version must be PUBLISHED/FROZEN to create signals, current=${strategyVersion.status}`);

    // Validate symbol format
    if (!input.symbol || input.symbol.length < 2) throw new Error('Symbol required');

    // Validate side
    if (!Object.values(ResearchSignalSide).includes(input.side as any)) throw new Error(`Invalid signal side ${input.side}`);

    // Decimal validation
    if (input.price && !/^-?\d+(\.\d+)?$/.test(input.price)) throw new Error('price must be valid decimal string');
    if (input.quantity && !/^-?\d+(\.\d+)?$/.test(input.quantity)) throw new Error('quantity must be valid decimal string');

    const fingerprint = this.fingerprintSignal({
      strategyVersionId: input.strategyVersionId,
      symbol: input.symbol,
      side: input.side,
      timestamp: input.timestamp.toISOString(),
      price: input.price || null,
      quantity: input.quantity || null,
    });

    const signalKey = `sig_${fingerprint.substring(0,16)}_${Date.now()}`;

    // Idempotency - deduplicate
    if (input.idempotencyKey) {
      const existingByKey = await (this.prisma as any).researchSignal.findFirst({ where: { idempotencyKey: input.idempotencyKey } });
      if (existingByKey) {
        this.logger.log(`Signal idempotent by key=${input.idempotencyKey}`);
        return existingByKey;
      }
    }

    const existingByFingerprint = await (this.prisma as any).researchSignal.findFirst({ where: { tenantId: input.tenantId, signalKey } });
    if (existingByFingerprint) {
      this.logger.log(`Signal duplicate by key=${signalKey}`);
      return existingByFingerprint;
    }

    const id = randomUUID();
    const data = {
      id,
      tenantId: input.tenantId,
      strategyVersionId: input.strategyVersionId,
      signalKey,
      symbol: input.symbol,
      side: input.side,
      strength: input.strength || null,
      confidence: input.confidence || null,
      price: input.price || null,
      quantity: input.quantity || null,
      timestamp: input.timestamp,
      expiresAt: input.expiresAt || null,
      state: 'DRAFT',
      sourceEvent: input.sourceEvent || null,
      metadata: input.metadata || {},
      idempotencyKey: input.idempotencyKey || `sig_${input.tenantId}_${fingerprint.substring(0,16)}_${Date.now()}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    try {
      const created = await (this.prisma as any).researchSignal.create({ data });

      await this.researchRepo.createAuditLog({
        tenantId: input.tenantId,
        event: 'SIGNAL_CREATED',
        actorId: input.createdBy || null,
        strategyVersionId: input.strategyVersionId,
        signalId: created.id,
        result: 'SUCCESS',
        safeMetadata: { signalKey, symbol: input.symbol, side: input.side, strength: input.strength },
      });

      this.logger.log(`Signal created id=${created.id} tenant=${input.tenantId} symbol=${input.symbol} side=${input.side}`);

      return created;
    } catch (e: any) {
      if (e.code === 'P2002') {
        const existing = await (this.prisma as any).researchSignal.findFirst({ where: { tenantId: input.tenantId, signalKey } });
        if (existing) return existing;
      }
      throw e;
    }
  }

  async validateSignal(tenantId: string, signalId: string): Promise<any | null> {
    const signal = await (this.prisma as any).researchSignal.findFirst({ where: { id: signalId, tenantId } });
    if (!signal) return null;

    if (signal.state !== 'DRAFT') throw new Error(`Only DRAFT signal can be validated, current=${signal.state}`);

    // Check expiry
    if (signal.expiresAt && new Date(signal.expiresAt).getTime() < Date.now()) {
      const updated = await (this.prisma as any).researchSignal.update({ where: { id: signalId }, data: { state: 'EXPIRED', updatedAt: new Date() } });
      return updated;
    }

    const updated = await (this.prisma as any).researchSignal.update({ where: { id: signalId }, data: { state: 'VALID', updatedAt: new Date() } });

    return updated;
  }

  async publishSignal(tenantId: string, signalId: string, actorId: string): Promise<any | null> {
    const signal = await (this.prisma as any).researchSignal.findFirst({ where: { id: signalId, tenantId } });
    if (!signal) return null;

    if (signal.state !== 'VALID') throw new Error(`Only VALID signal can be published, current=${signal.state}`);

    const updated = await (this.prisma as any).researchSignal.update({ where: { id: signalId }, data: { state: 'PUBLISHED', updatedAt: new Date() } });

    await this.researchRepo.createAuditLog({
      tenantId,
      event: 'SIGNAL_PUBLISHED',
      actorId,
      strategyVersionId: signal.strategyVersionId,
      signalId,
      result: 'SUCCESS',
      safeMetadata: { signalKey: signal.signalKey, symbol: signal.symbol, side: signal.side },
    });

    this.logger.log(`Signal published id=${signalId} tenant=${tenantId} symbol=${signal.symbol} side=${signal.side} - downstream handoff to copy-trading`);

    return updated;
  }

  async expireSignal(tenantId: string, signalId: string): Promise<any | null> {
    try {
      return await (this.prisma as any).researchSignal.update({ where: { id: signalId }, data: { state: 'EXPIRED', updatedAt: new Date() } });
    } catch { return null; }
  }

  async revokeSignal(tenantId: string, signalId: string, actorId: string, reason?: string): Promise<any | null> {
    const signal = await (this.prisma as any).researchSignal.findFirst({ where: { id: signalId, tenantId } });
    if (!signal) return null;

    const updated = await (this.prisma as any).researchSignal.update({ where: { id: signalId }, data: { state: 'REVOKED', updatedAt: new Date() } });

    await this.researchRepo.createAuditLog({
      tenantId,
      event: 'SIGNAL_REVOKED',
      actorId,
      strategyVersionId: signal.strategyVersionId,
      signalId,
      result: 'SUCCESS',
      safeMetadata: { reason: reason || 'Manual revoke' },
    });

    return updated;
  }

  async findById(tenantId: string, signalId: string): Promise<any | null> {
    return (this.prisma as any).researchSignal.findFirst({ where: { id: signalId, tenantId } }) || null;
  }

  async listByStrategyVersion(tenantId: string, strategyVersionId: string, filters?: { state?: string; symbol?: string; page?: number; limit?: number }): Promise<{ data: any[]; total: number }> {
    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    const skip = (page - 1) * limit;
    const where: any = { tenantId, strategyVersionId, ...(filters?.state ? { state: filters.state } : {}), ...(filters?.symbol ? { symbol: filters.symbol } : {}) };
    const [data, total] = await Promise.all([
      (this.prisma as any).researchSignal.findMany({ where, orderBy: { timestamp: 'desc' }, skip, take: limit }),
      (this.prisma as any).researchSignal.count({ where }),
    ]);
    return { data, total };
  }

  async listByTenant(tenantId: string, filters?: { state?: string; symbol?: string; page?: number; limit?: number }): Promise<{ data: any[]; total: number }> {
    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    const skip = (page - 1) * limit;
    const where: any = { tenantId, ...(filters?.state ? { state: filters.state } : {}), ...(filters?.symbol ? { symbol: filters.symbol } : {}) };
    const [data, total] = await Promise.all([
      (this.prisma as any).researchSignal.findMany({ where, orderBy: { timestamp: 'desc' }, skip, take: limit }),
      (this.prisma as any).researchSignal.count({ where }),
    ]);
    return { data, total };
  }
}
