import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { isValidDecimal, parseScaled, formatScaled, add, sub } from './oms.types';
import { randomUUID } from 'crypto';

/**
 * Allocation Service — tracks intended vs executed allocation across strategy, trader, follower, account, order scopes
 * without creating a second balance system. Actual balances remain authoritative elsewhere.
 */

@Injectable()
export class AllocationService {
  private readonly logger = new Logger(AllocationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async recordIntendedAllocation(params: {
    tenantId: string;
    strategyId?: string | null;
    traderId?: string | null;
    followerId?: string | null;
    subscriptionId?: string | null;
    accountId: string;
    orderIntentId?: string | null;
    symbol: string;
    side: string;
    intendedQuantity: string;
    intendedNotional?: string | null;
    allocationMode?: string | null;
    correlationId?: string | null;
  }) {
    const { tenantId, strategyId, traderId, followerId, subscriptionId, accountId, orderIntentId, symbol, side, intendedQuantity, intendedNotional, allocationMode, correlationId } = params;

    if (!isValidDecimal(intendedQuantity)) throw new Error(`Invalid intendedQuantity ${intendedQuantity}`);

    try {
      const record = await (this.prisma as any).omsAllocation.create({
        data: {
          tenantId,
          strategyId: strategyId ?? null,
          traderId: traderId ?? null,
          followerId: followerId ?? null,
          subscriptionId: subscriptionId ?? null,
          accountId,
          orderIntentId: orderIntentId ?? null,
          symbol,
          side,
          intendedQuantity,
          intendedNotional: intendedNotional ?? null,
          executedQuantity: '0',
          executedNotional: null,
          remainingQuantity: intendedQuantity,
          remainingNotional: intendedNotional ?? null,
          allocationMode: allocationMode ?? null,
          correlationId: correlationId ?? null,
        },
      });
      this.logger.log(`Allocation intended ${record.id} tenant ${tenantId} ${symbol} ${side} qty ${intendedQuantity}`);
      return record;
    } catch (e) {
      this.logger.warn(`OmsAllocation model missing, using in-memory fallback: ${(e as Error).message}`);
      return {
        id: randomUUID(),
        tenantId,
        strategyId,
        traderId,
        followerId,
        subscriptionId,
        accountId,
        orderIntentId,
        symbol,
        side,
        intendedQuantity,
        intendedNotional,
        executedQuantity: '0',
        executedNotional: null,
        remainingQuantity: intendedQuantity,
        remainingNotional: intendedNotional ?? null,
        allocationMode,
        correlationId,
        timestamp: new Date().toISOString(),
      };
    }
  }

  async updateExecutedAllocation(params: {
    tenantId: string;
    allocationId: string;
    executedQuantity: string;
    executedNotional?: string | null;
  }) {
    const { tenantId, allocationId, executedQuantity, executedNotional } = params;
    if (!isValidDecimal(executedQuantity)) throw new Error(`Invalid executedQuantity ${executedQuantity}`);

    try {
      const existing = await (this.prisma as any).omsAllocation.findFirst({ where: { id: allocationId, tenantId } });
      if (!existing) throw new Error(`Allocation ${allocationId} not found`);

      const intendedQty = parseScaled(existing.intendedQuantity);
      const execQty = parseScaled(executedQuantity);
      const remainingQty = intendedQty - execQty;
      const remaining = remainingQty > 0n ? formatScaled(remainingQty) : '0';

      const updated = await (this.prisma as any).omsAllocation.update({
        where: { id: allocationId },
        data: {
          executedQuantity,
          executedNotional: executedNotional ?? null,
          remainingQuantity: remaining,
          ...(executedNotional && existing.intendedNotional ? { remainingNotional: sub(existing.intendedNotional, executedNotional) } : {}),
        },
      });
      return updated;
    } catch (e) {
      this.logger.warn(`Allocation update fallback: ${(e as Error).message}`);
      return null;
    }
  }

  async getAllocations(params: { tenantId: string; accountId?: string; strategyId?: string; traderId?: string; followerId?: string; symbol?: string }) {
    const { tenantId, accountId, strategyId, traderId, followerId, symbol } = params;
    try {
      return await (this.prisma as any).omsAllocation.findMany({
        where: { tenantId, ...(accountId ? { accountId } : {}), ...(strategyId ? { strategyId } : {}), ...(traderId ? { traderId } : {}), ...(followerId ? { followerId } : {}), ...(symbol ? { symbol } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
    } catch {
      return [];
    }
  }

  async getAllocationSummary(params: { tenantId: string; strategyId?: string; traderId?: string; followerId?: string }) {
    const allocations = await this.getAllocations(params);
    let totalIntended = 0n;
    let totalExecuted = 0n;
    for (const a of allocations) {
      if (a.intendedQuantity && isValidDecimal(a.intendedQuantity)) totalIntended += parseScaled(a.intendedQuantity);
      if (a.executedQuantity && isValidDecimal(a.executedQuantity)) totalExecuted += parseScaled(a.executedQuantity);
    }
    const remaining = totalIntended - totalExecuted;
    return {
      totalAllocations: allocations.length,
      totalIntendedQuantity: formatScaled(totalIntended),
      totalExecutedQuantity: formatScaled(totalExecuted),
      totalRemainingQuantity: formatScaled(remaining > 0n ? remaining : 0n),
      executionRate: totalIntended > 0n ? formatScaled((totalExecuted * BigInt(1_000_000_000_000)) / totalIntended) : null,
    };
  }
}
