// # Persists copy execution intents with tenant-scoped idempotency keys and duplicate protection
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OutboxService } from '../../infrastructure/outbox/outbox.service';
import { CopyExecutionStatus, CopySizingMode, CopyRiskDecision } from './copy-trading.types';
import { randomUUID } from 'crypto';

function copyExecutionEventType(status: CopyExecutionStatus): string | null {
  switch (status) {
    case CopyExecutionStatus.FILLED:
      return 'copy.execution.filled';
    case CopyExecutionStatus.FAILED:
    case CopyExecutionStatus.REJECTED:
      return 'copy.execution.failed';
    case CopyExecutionStatus.SKIPPED:
      return 'copy.execution.skipped';
    default:
      return null;
  }
}

function safeExecutionIntent(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

/**
 * Persistence abstraction for copy execution intents/results, leader event references, follower mappings, idempotency, status transitions, and reconciliation metadata.
 * Prevent duplicate execution intent from same leader event/subscription combination.
 */
@Injectable()
export class CopyExecutionRepository {
  private readonly logger = new Logger(CopyExecutionRepository.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  async create(input: {
    tenantId: string;
    leaderEventId: string;
    leaderOrderId?: string | null;
    leaderFillId?: string | null;
    subscriptionId: string;
    followerId: string;
    traderId: string;
    followerAccountId?: string | null;
    sizingMode: CopySizingMode;
    leaderQuantity: string;
    leaderPrice?: string | null;
    followerQuantity?: string | null;
    followerPrice?: string | null;
    slippageTolerance?: string | null;
    maxNotional?: string | null;
    executionIntent?: Record<string, any>;
    idempotencyKey?: string | null;
  }): Promise<any> {
    const resolvedKey = input.idempotencyKey || `copy_${input.tenantId}_${input.leaderEventId}_${input.subscriptionId}`;

    // Prevent duplicate execution intent from same leader event/subscription
    const existing = await (this.prisma as any).copyExecution?.findFirst({
      where: { tenantId: input.tenantId, leaderEventId: input.leaderEventId, subscriptionId: input.subscriptionId },
    });
    if (existing) {
      this.logger.log(`Duplicate copy execution prevented tenant=${input.tenantId} leaderEvent=${input.leaderEventId} sub=${input.subscriptionId} existing=${existing.id}`);
      return existing;
    }

    const existingByKey = await (this.prisma as any).copyExecution?.findFirst({ where: { tenantId: input.tenantId, idempotencyKey: resolvedKey } });
    if (existingByKey) {
      this.logger.log(`Idempotent execution return key=${resolvedKey}`);
      return existingByKey;
    }

    const id = randomUUID();
    const now = new Date();

    const data = {
      id,
      tenantId: input.tenantId,
      leaderEventId: input.leaderEventId,
      leaderOrderId: input.leaderOrderId || null,
      leaderFillId: input.leaderFillId || null,
      subscriptionId: input.subscriptionId,
      followerId: input.followerId,
      traderId: input.traderId,
      followerAccountId: input.followerAccountId || null,
      status: CopyExecutionStatus.PENDING,
      sizingMode: input.sizingMode,
      leaderQuantity: input.leaderQuantity,
      leaderPrice: input.leaderPrice || null,
      followerQuantity: input.followerQuantity || null,
      followerPrice: input.followerPrice || null,
      slippageTolerance: input.slippageTolerance || null,
      maxNotional: input.maxNotional || null,
      executionIntent: input.executionIntent || {},
      idempotencyKey: resolvedKey,
      createdAt: now,
      updatedAt: now,
    };

    try {
      const created = await (this.prisma as any).copyExecution.create({ data });
      this.logger.log(`Copy execution created id=${created.id} tenant=${input.tenantId} leaderEvent=${input.leaderEventId} sub=${input.subscriptionId}`);
      return created;
    } catch (e: any) {
      if (e.code === 'P2002') {
        const existingDup = await (this.prisma as any).copyExecution.findFirst({ where: { tenantId: input.tenantId, leaderEventId: input.leaderEventId, subscriptionId: input.subscriptionId } });
        if (existingDup) return existingDup;
        const byKey = await (this.prisma as any).copyExecution.findFirst({ where: { tenantId: input.tenantId, idempotencyKey: resolvedKey } });
        if (byKey) return byKey;
      }
      throw e;
    }
  }

  async findById(id: string, tenantId: string): Promise<any | null> {
    return (this.prisma as any).copyExecution?.findFirst({ where: { id, tenantId } }) || null;
  }

  async findByLeaderEventAndSubscription(tenantId: string, leaderEventId: string, subscriptionId: string): Promise<any | null> {
    return (this.prisma as any).copyExecution?.findFirst({ where: { tenantId, leaderEventId, subscriptionId } }) || null;
  }

  async findByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<any | null> {
    return (this.prisma as any).copyExecution?.findFirst({ where: { tenantId, idempotencyKey } }) || null;
  }

  async listBySubscription(tenantId: string, subscriptionId: string, filters?: { status?: CopyExecutionStatus; page?: number; limit?: number }): Promise<{ data: any[]; total: number }> {
    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    const skip = (page - 1) * limit;
    const where: any = { tenantId, subscriptionId, ...(filters?.status ? { status: filters.status } : {}) };
    const [data, total] = await Promise.all([
      (this.prisma as any).copyExecution?.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }) || [],
      (this.prisma as any).copyExecution?.count({ where }) || 0,
    ]);
    return { data, total };
  }

  async listByFollower(tenantId: string, followerId: string, filters?: { status?: CopyExecutionStatus; page?: number; limit?: number }): Promise<{ data: any[]; total: number }> {
    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    const skip = (page - 1) * limit;
    const where: any = { tenantId, followerId, ...(filters?.status ? { status: filters.status } : {}) };
    const [data, total] = await Promise.all([
      (this.prisma as any).copyExecution?.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }) || [],
      (this.prisma as any).copyExecution?.count({ where }) || 0,
    ]);
    return { data, total };
  }

  async listByTrader(tenantId: string, traderId: string, filters?: { status?: CopyExecutionStatus; page?: number; limit?: number }): Promise<{ data: any[]; total: number }> {
    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    const skip = (page - 1) * limit;
    const where: any = { tenantId, traderId, ...(filters?.status ? { status: filters.status } : {}) };
    const [data, total] = await Promise.all([
      (this.prisma as any).copyExecution?.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }) || [],
      (this.prisma as any).copyExecution?.count({ where }) || 0,
    ]);
    return { data, total };
  }

  async updateStatus(
    id: string,
    tenantId: string,
    status: CopyExecutionStatus,
    extra?: {
      followerOrderId?: string;
      followerFillId?: string;
      providerOrderId?: string;
      providerTradeId?: string;
      failureReason?: string;
      followerQuantity?: string;
      followerPrice?: string;
      riskDecision?: CopyRiskDecision;
      riskRuleId?: string;
    },
  ): Promise<any | null> {
    const eventType = copyExecutionEventType(status);
    try {
      return await this.prisma.withTenantRls(tenantId, async (tx) => {
        const existing = await tx.copyExecution.findFirst({ where: { id, tenantId } });
        if (!existing) return null;

        const terminal = [
          CopyExecutionStatus.FILLED,
          CopyExecutionStatus.FAILED,
          CopyExecutionStatus.REJECTED,
          CopyExecutionStatus.BLOCKED,
        ];
        if (terminal.includes(existing.status as CopyExecutionStatus) && existing.status !== status) {
          if (existing.status === CopyExecutionStatus.FILLED && status !== CopyExecutionStatus.FILLED) {
            this.logger.warn(`Invalid status transition rejected id=${id} from=${existing.status} to=${status}`);
            return existing;
          }
        }

        const updated = await tx.copyExecution.update({
          where: { id, tenantId },
          data: {
            status,
            ...extra,
            updatedAt: new Date(),
            retryCount: extra?.failureReason ? { increment: 1 } : undefined,
          },
        });

        if (eventType !== null) {
          const subscription = await tx.copySubscription.findFirst({
            where: { id: updated.subscriptionId, tenantId },
            select: { strategyId: true },
          });
          const intent = safeExecutionIntent(updated.executionIntent);
          const symbol = typeof intent.symbol === 'string' ? intent.symbol : null;
          const side = typeof intent.side === 'string' ? intent.side.toUpperCase() : null;
          const quantity = extra?.followerQuantity ?? updated.followerQuantity;

          await this.outbox.append(tx, {
            tenantId,
            aggregateType: 'copy.execution',
            aggregateId: updated.id,
            eventType,
            idempotencyKey: `copy-execution:${updated.id}:${status}`,
            payload: {
              executionId: updated.id,
              subscriptionId: updated.subscriptionId,
              followerId: updated.followerId,
              traderId: updated.traderId,
              strategyId: subscription?.strategyId ?? null,
              status,
              symbol,
              side,
              quantity: typeof quantity === 'string' ? quantity : null,
            },
          });
        }

        return updated;
      });
    } catch (error) {
      if (eventType !== null) {
        this.logger.error(
          `Terminal copy execution state and outbox event were rolled back id=${id} tenant=${tenantId}`,
        );
        throw error;
      }
      this.logger.warn(
        `Failed to update execution status id=${id} error=${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return null;
    }
  }

  async listPending(tenantId: string, limit = 100): Promise<any[]> {
    return (this.prisma as any).copyExecution?.findMany({ where: { tenantId, status: { in: ['PENDING', 'VALIDATED', 'MAPPED', 'RISK_CHECKED', 'ROUTED'] } }, orderBy: { createdAt: 'asc' }, take: limit }) || [];
  }
}
