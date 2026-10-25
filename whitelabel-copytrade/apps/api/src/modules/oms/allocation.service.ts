// # Responsibility: persist native tenant-bound allocations and propagate required read/write failures instead of fabricating in-memory success.
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { isValidDecimal, parseScaled, formatScaled, sub } from './oms.types';

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

    if (intendedNotional !== undefined && intendedNotional !== null && (!isValidDecimal(intendedNotional)
      || (intendedNotional.split('.')[1] ?? '').replace(/0+$/, '').length > 12 || parseScaled(intendedNotional) < 0n)) throw new Error('Invalid intended notional');
    if (!isValidDecimal(intendedQuantity) || (intendedQuantity.split('.')[1] ?? '').replace(/0+$/, '').length > 12 || parseScaled(intendedQuantity) <= 0n) throw new Error(`Invalid intendedQuantity ${intendedQuantity}`);

    try {
      const record = await this.prisma.omsAllocation.create({
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
    } catch (error) {
      this.logger.warn(`Allocation persistence failed: ${error instanceof Error ? error.constructor.name : 'UnknownError'}`);
      throw error;
    }
  }

  async updateExecutedAllocation(params: {
    tenantId: string;
    allocationId: string;
    executedQuantity: string;
    executedNotional?: string | null;
  }) {
    const { tenantId, allocationId, executedQuantity, executedNotional } = params;
    if (!isValidDecimal(executedQuantity) || (executedQuantity.split('.')[1] ?? '').replace(/0+$/, '').length > 12 || parseScaled(executedQuantity) < 0n) throw new Error(`Invalid executedQuantity ${executedQuantity}`);

    try {
      const existing = await this.prisma.omsAllocation.findFirst({ where: { id: allocationId, tenantId } });
      if (!existing) throw new Error(`Allocation ${allocationId} not found`);

      const intendedQty = parseScaled(existing.intendedQuantity);
      const execQty = parseScaled(executedQuantity);
      if (execQty > intendedQty) throw new Error('Executed allocation exceeds intended quantity');
      if (executedNotional !== undefined && executedNotional !== null && (!isValidDecimal(executedNotional)
        || (executedNotional.split('.')[1] ?? '').replace(/0+$/, '').length > 12 || parseScaled(executedNotional) < 0n)) throw new Error('Invalid executed notional');
      const remainingQty = intendedQty - execQty;
      const remaining = remainingQty > 0n ? formatScaled(remainingQty) : '0';

      const updated = await this.prisma.omsAllocation.update({
        where: { id: allocationId, tenantId, executedQuantity: existing.executedQuantity },
        data: {
          executedQuantity,
          executedNotional: executedNotional ?? null,
          remainingQuantity: remaining,
          ...(executedNotional && existing.intendedNotional ? { remainingNotional: sub(existing.intendedNotional, executedNotional) } : {}),
        },
      });
      return updated;
    } catch (e) {
      this.logger.warn(`Allocation update failed: ${e instanceof Error ? e.constructor.name : 'UnknownError'}`);
      throw e;
    }
  }

  async getAllocations(params: { tenantId: string; accountId?: string; strategyId?: string; traderId?: string; followerId?: string; symbol?: string }) {
    const { tenantId, accountId, strategyId, traderId, followerId, symbol } = params;
    return await this.prisma.omsAllocation.findMany({
      where: { tenantId, ...(accountId ? { accountId } : {}), ...(strategyId ? { strategyId } : {}), ...(traderId ? { traderId } : {}), ...(followerId ? { followerId } : {}), ...(symbol ? { symbol } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
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
