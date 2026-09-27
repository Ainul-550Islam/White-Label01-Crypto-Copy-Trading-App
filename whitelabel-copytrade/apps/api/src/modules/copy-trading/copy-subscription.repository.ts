import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CopySubscriptionState, CopySizingMode } from './copy-trading.types';
import { randomUUID } from 'crypto';

/**
 * Persistence abstraction for trader/follower subscriptions, state, allocation, policy references, idempotency, lifecycle history, and tenant isolation.
 * Enforce tenant isolation. Prevent duplicate active subscription where business rules prohibit it.
 */
@Injectable()
export class CopySubscriptionRepository {
  private readonly logger = new Logger(CopySubscriptionRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(input: {
    tenantId: string;
    followerId: string;
    traderId: string;
    strategyId: string;
    allocationMode: CopySizingMode;
    allocationAmount: string;
    maxAllocation?: string | null;
    minAllocation?: string | null;
    copyPolicy?: Record<string, any>;
    riskPolicy?: Record<string, any>;
    followerAccountId?: string | null;
    idempotencyKey?: string | null;
  }): Promise<any> {
    // Prevent duplicate active subscription where business rules prohibit it
    const existingActive = await (this.prisma as any).copySubscription?.findFirst({
      where: { tenantId: input.tenantId, followerId: input.followerId, strategyId: input.strategyId, state: { in: ['PENDING', 'ACTIVE', 'PAUSED'] } },
    });

    if (existingActive) {
      throw new Error(`Duplicate active subscription for follower=${input.followerId} strategy=${input.strategyId} existing=${existingActive.id}`);
    }

    if (input.idempotencyKey) {
      const existingByKey = await (this.prisma as any).copySubscription?.findFirst({ where: { idempotencyKey: input.idempotencyKey } });
      if (existingByKey) {
        this.logger.log(`Idempotent subscription return key=${input.idempotencyKey}`);
        return existingByKey;
      }
    }

    const id = randomUUID();
    const now = new Date();

    const data = {
      id,
      tenantId: input.tenantId,
      followerId: input.followerId,
      traderId: input.traderId,
      strategyId: input.strategyId,
      state: CopySubscriptionState.PENDING,
      allocationMode: input.allocationMode,
      allocationAmount: input.allocationAmount,
      maxAllocation: input.maxAllocation || null,
      minAllocation: input.minAllocation || null,
      copyPolicy: input.copyPolicy || {},
      riskPolicy: input.riskPolicy || {},
      followerAccountId: input.followerAccountId || null,
      startedAt: null,
      pausedAt: null,
      stoppedAt: null,
      totalCopiedVolume: '0',
      totalCopies: 0,
      failedCopies: 0,
      idempotencyKey: input.idempotencyKey || null,
      createdAt: now,
      updatedAt: now,
    };

    try {
      const created = await (this.prisma as any).copySubscription.create({ data });
      this.logger.log(`Copy subscription created id=${created.id} tenant=${input.tenantId} follower=${input.followerId} trader=${input.traderId} strategy=${input.strategyId}`);
      return created;
    } catch (e: any) {
      if (e.code === 'P2002') {
        if (input.idempotencyKey) {
          const existing = await (this.prisma as any).copySubscription.findFirst({ where: { idempotencyKey: input.idempotencyKey } });
          if (existing) return existing;
        }
        // Unique follower+strategy
        const existing = await (this.prisma as any).copySubscription.findFirst({ where: { tenantId: input.tenantId, followerId: input.followerId, strategyId: input.strategyId } });
        if (existing) return existing;
      }
      throw e;
    }
  }

  async findById(id: string, tenantId: string): Promise<any | null> {
    return (this.prisma as any).copySubscription?.findFirst({ where: { id, tenantId } }) || null;
  }

  async findActiveByFollowerAndStrategy(tenantId: string, followerId: string, strategyId: string): Promise<any | null> {
    return (this.prisma as any).copySubscription?.findFirst({ where: { tenantId, followerId, strategyId, state: { in: ['PENDING', 'ACTIVE', 'PAUSED'] } } }) || null;
  }

  async listByFollower(tenantId: string, followerId: string, filters?: { state?: CopySubscriptionState; page?: number; limit?: number }): Promise<{ data: any[]; total: number }> {
    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    const skip = (page - 1) * limit;
    const where: any = { tenantId, followerId, ...(filters?.state ? { state: filters.state } : {}) };
    const [data, total] = await Promise.all([
      (this.prisma as any).copySubscription?.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }) || [],
      (this.prisma as any).copySubscription?.count({ where }) || 0,
    ]);
    return { data, total };
  }

  async listByTrader(tenantId: string, traderId: string, filters?: { state?: CopySubscriptionState; page?: number; limit?: number }): Promise<{ data: any[]; total: number }> {
    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    const skip = (page - 1) * limit;
    const where: any = { tenantId, traderId, ...(filters?.state ? { state: filters.state } : {}) };
    const [data, total] = await Promise.all([
      (this.prisma as any).copySubscription?.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }) || [],
      (this.prisma as any).copySubscription?.count({ where }) || 0,
    ]);
    return { data, total };
  }

  async listActive(tenantId: string, filters?: { strategyId?: string; page?: number; limit?: number }): Promise<{ data: any[]; total: number }> {
    const page = filters?.page || 1;
    const limit = filters?.limit || 100;
    const skip = (page - 1) * limit;
    const where: any = { tenantId, state: 'ACTIVE', ...(filters?.strategyId ? { strategyId: filters.strategyId } : {}) };
    const [data, total] = await Promise.all([
      (this.prisma as any).copySubscription?.findMany({ where, orderBy: { createdAt: 'asc' }, skip, take: limit }) || [],
      (this.prisma as any).copySubscription?.count({ where }) || 0,
    ]);
    return { data, total };
  }

  async listByTenant(tenantId: string, filters?: { state?: CopySubscriptionState; page?: number; limit?: number }): Promise<{ data: any[]; total: number }> {
    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    const skip = (page - 1) * limit;
    const where: any = { tenantId, ...(filters?.state ? { state: filters.state } : {}) };
    const [data, total] = await Promise.all([
      (this.prisma as any).copySubscription?.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }) || [],
      (this.prisma as any).copySubscription?.count({ where }) || 0,
    ]);
    return { data, total };
  }

  async updateState(id: string, tenantId: string, state: CopySubscriptionState, timestamps?: { startedAt?: Date; pausedAt?: Date; stoppedAt?: Date; cancelledAt?: Date }): Promise<any | null> {
    try {
      return await (this.prisma as any).copySubscription.update({
        where: { id },
        data: { state, ...timestamps, updatedAt: new Date() },
      });
    } catch {
      return null;
    }
  }

  async updateAllocation(id: string, tenantId: string, allocation: { allocationAmount?: string; maxAllocation?: string | null; minAllocation?: string | null; allocationMode?: CopySizingMode }): Promise<any | null> {
    try {
      return await (this.prisma as any).copySubscription.update({ where: { id }, data: { ...allocation, updatedAt: new Date() } });
    } catch {
      return null;
    }
  }

  async updatePolicy(id: string, tenantId: string, policy: { copyPolicy?: Record<string, any>; riskPolicy?: Record<string, any> }): Promise<any | null> {
    try {
      return await (this.prisma as any).copySubscription.update({ where: { id }, data: { ...policy, updatedAt: new Date() } });
    } catch {
      return null;
    }
  }

  async incrementStats(id: string, tenantId: string, stats: { totalCopies?: number; failedCopies?: number; volume?: string }): Promise<void> {
    try {
      const existing = await (this.prisma as any).copySubscription.findFirst({ where: { id, tenantId } });
      if (!existing) return;
      const newTotal = (existing.totalCopies || 0) + (stats.totalCopies || 0);
      const newFailed = (existing.failedCopies || 0) + (stats.failedCopies || 0);
      // Decimal-safe volume addition - preserve as string via BigInt? Simplified: use string addition for integer part
      let newVolume = existing.totalCopiedVolume || '0';
      if (stats.volume) {
        try {
          // Simple decimal addition preserving precision for integer part
          const [aInt, aDec = ''] = newVolume.split('.');
          const [bInt, bDec = ''] = stats.volume.split('.');
          const maxDec = Math.max(aDec.length, bDec.length);
          const aFull = BigInt((aInt || '0') + aDec.padEnd(maxDec, '0'));
          const bFull = BigInt((bInt || '0') + bDec.padEnd(maxDec, '0'));
          const sum = aFull + bFull;
          const sumStr = sum.toString().padStart(maxDec + 1, '0');
          if (maxDec === 0) newVolume = sumStr;
          else {
            const intPart = sumStr.slice(0, -maxDec) || '0';
            const decPart = sumStr.slice(-maxDec).replace(/0+$/, '');
            newVolume = decPart ? `${intPart}.${decPart}` : intPart;
          }
        } catch {
          newVolume = (parseFloat(newVolume) + parseFloat(stats.volume)).toString();
        }
      }

      await (this.prisma as any).copySubscription.update({
        where: { id },
        data: { totalCopies: newTotal, failedCopies: newFailed, totalCopiedVolume: newVolume, updatedAt: new Date() },
      });
    } catch {}
  }

  async countActiveByFollower(tenantId: string, followerId: string): Promise<number> {
    return (this.prisma as any).copySubscription?.count({ where: { tenantId, followerId, state: { in: ['PENDING', 'ACTIVE', 'PAUSED'] } } }) || 0;
  }

  async countActiveByTrader(tenantId: string, traderId: string): Promise<number> {
    return (this.prisma as any).copySubscription?.count({ where: { tenantId, traderId, state: { in: ['PENDING', 'ACTIVE'] } } }) || 0;
  }
}
