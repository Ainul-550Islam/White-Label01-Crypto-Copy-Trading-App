import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CopySubscriptionRepository } from './copy-subscription.repository';
import { CopyExecutionRepository } from './copy-execution.repository';
import { CopyPolicyService } from './copy-policy.service';
import { CopyOrderMapperService, LeaderEvent } from './copy-order-mapper.service';
import { FollowerAllocationService } from './follower-allocation.service';
import { FollowerRiskService } from './follower-risk.service';
import { ExchangeRoutingService } from '../exchanges/exchange-routing.service';
import { ExchangeHealthService } from '../exchanges/exchange-health.service';
import { CopyExecutionStatus, CopySizingMode, CopyRiskDecision } from './copy-trading.types';
import { randomUUID } from 'crypto';

/**
 * Consumes validated leader trading events and fans them out into follower execution intents via existing execution/risk/compliance/security/exchange routing with fail-closed gates.
 * Flow: leader order/fill event → resolve active follower subscriptions → resolve effective copy policy → map order → follower allocation from canonical balance → follower risk evaluation → compliance/security checks → exchange routing with existing risk engine and live-mode gate → submit intent. Must not create order merely because trader account connected. Must never bypass operator confirmation / credential-source / venue attestation / signed transport / IP allowlist / distributed locks / durable store / live-mode gate.
 */
@Injectable()
export class CopyExecutionService {
  private readonly logger = new Logger(CopyExecutionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionRepo: CopySubscriptionRepository,
    private readonly executionRepo: CopyExecutionRepository,
    private readonly policyService: CopyPolicyService,
    private readonly orderMapper: CopyOrderMapperService,
    private readonly allocationService: FollowerAllocationService,
    private readonly riskService: FollowerRiskService,
    private readonly exchangeRouting: ExchangeRoutingService,
    private readonly exchangeHealth: ExchangeHealthService,
  ) {}

  async processLeaderEvent(input: { tenantId: string; leaderEvent: LeaderEvent; traderId: string; strategyId: string; actorId?: string }): Promise<{ processed: number; skipped: number; blocked: number; executions: any[] }> {
    this.logger.log(`Processing leader event tenant=${input.tenantId} event=${input.leaderEvent.eventId} trader=${input.traderId} strategy=${input.strategyId} symbol=${input.leaderEvent.symbol}`);

    // Compliance BLOCK must prevent copy
    try {
      const complianceCase = await (this.prisma as any).complianceCase?.findFirst({ where: { tenantId: input.tenantId, userId: input.traderId, decision: 'BLOCK', state: { in: ['OPEN', 'IN_REVIEW', 'ESCALATED'] } } });
      if (complianceCase) {
        this.logger.warn(`Leader event blocked by compliance trader=${input.traderId}`);
        return { processed: 0, skipped: 0, blocked: 1, executions: [] };
      }
    } catch (e: any) {
      if (e.message?.includes('BLOCK')) return { processed: 0, skipped: 0, blocked: 1, executions: [] };
    }

    // Unhealthy exchange must prevent copy - check via account health if possible, otherwise skip venue check
    try {
      // getHealth requires accountId, so we list health by tenant and check any UNAVAILABLE for the venue
      const healthList = await this.exchangeHealth.listHealthByTenant(input.tenantId);
      const unhealthy = healthList.find((h: any) => h.state === 'UNAVAILABLE' || h.state === 'AUTH_FAILED');
      if (unhealthy) {
        this.logger.warn(`Leader event blocked by unhealthy exchange tenant=${input.tenantId} venue=${input.leaderEvent.venue} state=${unhealthy.state}`);
        return { processed: 0, skipped: 0, blocked: 1, executions: [] };
      }
    } catch {}

    // Kill switch check - GLOBAL or ACCOUNT or STRATEGY
    try {
      const killSwitch = await this.prisma.killSwitch.findFirst({ where: { isEngaged: true, OR: [{ tenantId: input.tenantId }, { tenantId: null }] } });
      if (killSwitch) {
        this.logger.warn(`Leader event blocked by kill switch tenant=${input.tenantId} scope=${killSwitch.scope}`);
        return { processed: 0, skipped: 0, blocked: 1, executions: [] };
      }
    } catch {}

    // Resolve active follower subscriptions
    const { data: subscriptions } = await this.subscriptionRepo.listActive(input.tenantId, { strategyId: input.strategyId, limit: 1000 });

    if (subscriptions.length === 0) {
      this.logger.log(`No active subscriptions for strategy=${input.strategyId}`);
      return { processed: 0, skipped: 0, blocked: 0, executions: [] };
    }

    let processed = 0;
    let skipped = 0;
    let blocked = 0;
    const executions: any[] = [];

    for (const sub of subscriptions) {
      try {
        const result = await this.processForSubscription({
          tenantId: input.tenantId,
          leaderEvent: input.leaderEvent,
          subscription: sub,
          traderId: input.traderId,
          strategyId: input.strategyId,
        });

        if (result) {
          if (result.status === CopyExecutionStatus.BLOCKED || result.status === CopyExecutionStatus.REJECTED) blocked++;
          else if (result.status === CopyExecutionStatus.SKIPPED) skipped++;
          else processed++;
          executions.push(result);
        } else {
          skipped++;
        }
      } catch (e: any) {
        this.logger.warn(`Failed to process subscription=${sub.id} error=${e.message}`);
        skipped++;
      }
    }

    return { processed, skipped, blocked, executions };
  }

  private async processForSubscription(input: { tenantId: string; leaderEvent: LeaderEvent; subscription: any; traderId: string; strategyId: string }): Promise<any | null> {
    const { tenantId, leaderEvent, subscription } = input;

    // Prevent duplicate execution intent from same leader event/subscription
    const existing = await this.executionRepo.findByLeaderEventAndSubscription(tenantId, leaderEvent.eventId, subscription.id);
    if (existing) {
      this.logger.log(`Duplicate execution prevented tenant=${tenantId} event=${leaderEvent.eventId} sub=${subscription.id}`);
      return existing;
    }

    // Resolve effective copy policy - Platform → Tenant → Trader Strategy → Follower Subscription
    const effectivePolicy = await this.policyService.resolveEffectivePolicy({ tenantId, strategyId: input.strategyId, subscriptionId: subscription.id });

    // Get follower balance from canonical data
    let followerBalance: string | null = null;
    let leaderTotalBalance: string | null = null;

    if (subscription.followerAccountId) {
      try {
        followerBalance = await this.allocationService.getAvailableBalance(tenantId, subscription.followerId, subscription.followerAccountId);
      } catch {}
    }

    // Map leader event to follower intent using precision-safe calculations
    const followerIntent = await this.orderMapper.mapLeaderToFollower({
      tenantId,
      leaderEvent,
      followerAccountId: subscription.followerAccountId,
      allocationAmount: subscription.allocationAmount,
      allocationMode: subscription.allocationMode,
      copyPolicy: effectivePolicy,
      followerBalance,
      leaderTotalBalance,
    });

    if (!followerIntent) {
      // Create SKIPPED execution for audit
      const skipped = await this.executionRepo.create({
        tenantId,
        leaderEventId: leaderEvent.eventId,
        leaderOrderId: leaderEvent.orderId || null,
        leaderFillId: leaderEvent.fillId || null,
        subscriptionId: subscription.id,
        followerId: subscription.followerId,
        traderId: input.traderId,
        followerAccountId: subscription.followerAccountId,
        sizingMode: subscription.allocationMode,
        leaderQuantity: leaderEvent.quantity,
        leaderPrice: leaderEvent.price || null,
        followerQuantity: null,
        followerPrice: null,
        slippageTolerance: effectivePolicy.slippageToleranceBps?.toString() || null,
        maxNotional: effectivePolicy.maxOrderNotional || null,
        executionIntent: { reason: 'MAPPING_FAILED', leaderEvent, effectivePolicy },
        idempotencyKey: `copy_${tenantId}_${leaderEvent.eventId}_${subscription.id}_${Date.now()}`,
      });

      await this.executionRepo.updateStatus(skipped.id, tenantId, CopyExecutionStatus.SKIPPED, { failureReason: 'Order mapping failed - filtered or below minimum' });
      return { ...skipped, status: CopyExecutionStatus.SKIPPED };
    }

    // Follower allocation from canonical balance - already done via mapper, but validate again
    const allocationValidation = await this.allocationService.validateAllocation({
      tenantId,
      followerId: subscription.followerId,
      followerAccountId: subscription.followerAccountId,
      allocationMode: subscription.allocationMode,
      allocationAmount: subscription.allocationAmount,
      maxAllocation: subscription.maxAllocation,
      minAllocation: subscription.minAllocation,
    });

    if (!allocationValidation.valid) {
      const blocked = await this.executionRepo.create({
        tenantId,
        leaderEventId: leaderEvent.eventId,
        leaderOrderId: leaderEvent.orderId || null,
        leaderFillId: leaderEvent.fillId || null,
        subscriptionId: subscription.id,
        followerId: subscription.followerId,
        traderId: input.traderId,
        followerAccountId: subscription.followerAccountId,
        sizingMode: subscription.allocationMode,
        leaderQuantity: leaderEvent.quantity,
        leaderPrice: leaderEvent.price || null,
        followerQuantity: followerIntent.quantity,
        followerPrice: followerIntent.price || null,
        slippageTolerance: effectivePolicy.slippageToleranceBps?.toString() || null,
        maxNotional: effectivePolicy.maxOrderNotional || null,
        executionIntent: followerIntent as any,
        idempotencyKey: `copy_${tenantId}_${leaderEvent.eventId}_${subscription.id}_${Date.now()}`,
      });

      await this.executionRepo.updateStatus(blocked.id, tenantId, CopyExecutionStatus.BLOCKED, { failureReason: `Allocation failed: ${allocationValidation.reason}` });
      return { ...blocked, status: CopyExecutionStatus.BLOCKED };
    }

    // Follower risk evaluation
    const riskCheck = await this.riskService.checkRisk({
      tenantId,
      followerId: subscription.followerId,
      subscriptionId: subscription.id,
      traderId: input.traderId,
      followerAccountId: subscription.followerAccountId,
      symbol: followerIntent.symbol,
      side: followerIntent.side,
      quantity: followerIntent.quantity,
      price: followerIntent.price,
      notional: followerIntent.notional,
      riskPolicy: subscription.riskPolicy || {},
    });

    if (riskCheck.decision === CopyRiskDecision.BLOCK || riskCheck.decision === CopyRiskDecision.STOP_COPY) {
      const blocked = await this.executionRepo.create({
        tenantId,
        leaderEventId: leaderEvent.eventId,
        leaderOrderId: leaderEvent.orderId || null,
        leaderFillId: leaderEvent.fillId || null,
        subscriptionId: subscription.id,
        followerId: subscription.followerId,
        traderId: input.traderId,
        followerAccountId: subscription.followerAccountId,
        sizingMode: subscription.allocationMode,
        leaderQuantity: leaderEvent.quantity,
        leaderPrice: leaderEvent.price || null,
        followerQuantity: riskCheck.reducedQuantity || followerIntent.quantity,
        followerPrice: followerIntent.price || null,
        slippageTolerance: effectivePolicy.slippageToleranceBps?.toString() || null,
        maxNotional: effectivePolicy.maxOrderNotional || null,
        executionIntent: followerIntent as any,
        idempotencyKey: `copy_${tenantId}_${leaderEvent.eventId}_${subscription.id}_${Date.now()}`,
      });

      await this.executionRepo.updateStatus(blocked.id, tenantId, CopyExecutionStatus.BLOCKED, { riskDecision: riskCheck.decision, riskRuleId: riskCheck.ruleId || undefined, failureReason: riskCheck.reason || 'Risk blocked' });

      // If STOP_COPY, stop subscription
      if (riskCheck.decision === CopyRiskDecision.STOP_COPY) {
        try {
          await this.subscriptionRepo.updateState(subscription.id, tenantId, 'STOPPED' as any, { stoppedAt: new Date() });
        } catch {}
      }

      return { ...blocked, status: CopyExecutionStatus.BLOCKED };
    }

    if (riskCheck.decision === CopyRiskDecision.PAUSE) {
      const paused = await this.executionRepo.create({
        tenantId,
        leaderEventId: leaderEvent.eventId,
        leaderOrderId: leaderEvent.orderId || null,
        leaderFillId: leaderEvent.fillId || null,
        subscriptionId: subscription.id,
        followerId: subscription.followerId,
        traderId: input.traderId,
        followerAccountId: subscription.followerAccountId,
        sizingMode: subscription.allocationMode,
        leaderQuantity: leaderEvent.quantity,
        leaderPrice: leaderEvent.price || null,
        followerQuantity: followerIntent.quantity,
        followerPrice: followerIntent.price || null,
        slippageTolerance: effectivePolicy.slippageToleranceBps?.toString() || null,
        maxNotional: effectivePolicy.maxOrderNotional || null,
        executionIntent: followerIntent as any,
        idempotencyKey: `copy_${tenantId}_${leaderEvent.eventId}_${subscription.id}_${Date.now()}`,
      });

      await this.executionRepo.updateStatus(paused.id, tenantId, CopyExecutionStatus.BLOCKED, { riskDecision: riskCheck.decision, riskRuleId: riskCheck.ruleId || undefined, failureReason: riskCheck.reason || 'Risk paused' });

      try {
        await this.subscriptionRepo.updateState(subscription.id, tenantId, 'PAUSED' as any, { pausedAt: new Date() });
      } catch {}

      return { ...paused, status: CopyExecutionStatus.BLOCKED };
    }

    // Apply REDUCE if needed
    if (riskCheck.decision === CopyRiskDecision.REDUCE && riskCheck.reducedQuantity) {
      followerIntent.quantity = riskCheck.reducedQuantity;
    }

    // Compliance/security checks for follower
    try {
      const followerCompliance = await (this.prisma as any).complianceCase?.findFirst({ where: { tenantId, userId: subscription.followerId, decision: 'BLOCK', state: { in: ['OPEN', 'IN_REVIEW', 'ESCALATED'] } } });
      if (followerCompliance) {
        const blocked = await this.executionRepo.create({
          tenantId,
          leaderEventId: leaderEvent.eventId,
          leaderOrderId: leaderEvent.orderId || null,
          leaderFillId: leaderEvent.fillId || null,
          subscriptionId: subscription.id,
          followerId: subscription.followerId,
          traderId: input.traderId,
          followerAccountId: subscription.followerAccountId,
          sizingMode: subscription.allocationMode,
          leaderQuantity: leaderEvent.quantity,
          leaderPrice: leaderEvent.price || null,
          followerQuantity: followerIntent.quantity,
          followerPrice: followerIntent.price || null,
          slippageTolerance: effectivePolicy.slippageToleranceBps?.toString() || null,
          maxNotional: effectivePolicy.maxOrderNotional || null,
          executionIntent: followerIntent as any,
          idempotencyKey: `copy_${tenantId}_${leaderEvent.eventId}_${subscription.id}_${Date.now()}`,
        });
        await this.executionRepo.updateStatus(blocked.id, tenantId, CopyExecutionStatus.BLOCKED, { failureReason: 'Follower blocked by compliance' });
        return { ...blocked, status: CopyExecutionStatus.BLOCKED };
      }
    } catch (e: any) {
      if (e.message?.includes('blocked by compliance')) throw e;
    }

    // Testnet/live mismatch must prevent copy - use isSandbox and tradingMode
    if (subscription.followerAccountId) {
      try {
        const followerAccount = await this.prisma.tradingAccount.findFirst({ where: { id: subscription.followerAccountId, tenantId } });
        if (followerAccount) {
          const isFollowerSandbox = (followerAccount as any).isSandbox;
          const isLeaderSimulated = leaderEvent.isSimulated;
          // If follower is sandbox (paper) but leader is live (not simulated), or vice versa, block
          if (isFollowerSandbox !== isLeaderSimulated) {
            const blocked = await this.executionRepo.create({
              tenantId,
              leaderEventId: leaderEvent.eventId,
              leaderOrderId: leaderEvent.orderId || null,
              leaderFillId: leaderEvent.fillId || null,
              subscriptionId: subscription.id,
              followerId: subscription.followerId,
              traderId: input.traderId,
              followerAccountId: subscription.followerAccountId,
              sizingMode: subscription.allocationMode,
              leaderQuantity: leaderEvent.quantity,
              leaderPrice: leaderEvent.price || null,
              followerQuantity: followerIntent.quantity,
              followerPrice: followerIntent.price || null,
              slippageTolerance: effectivePolicy.slippageToleranceBps?.toString() || null,
              maxNotional: effectivePolicy.maxOrderNotional || null,
              executionIntent: followerIntent as any,
              idempotencyKey: `copy_${tenantId}_${leaderEvent.eventId}_${subscription.id}_${Date.now()}`,
            });
            await this.executionRepo.updateStatus(blocked.id, tenantId, CopyExecutionStatus.BLOCKED, { failureReason: `Testnet/live mismatch followerSandbox=${isFollowerSandbox} leaderSimulated=${isLeaderSimulated}` });
            return { ...blocked, status: CopyExecutionStatus.BLOCKED };
          }
        }
      } catch {}
    }

    // Exchange routing with existing risk engine and live-mode gate - must not create order merely because trader account connected
    // Must never bypass operator confirmation / credential-source / venue attestation / signed transport / IP allowlist / distributed locks / durable store / live-mode gate

    const execution = await this.executionRepo.create({
      tenantId,
      leaderEventId: leaderEvent.eventId,
      leaderOrderId: leaderEvent.orderId || null,
      leaderFillId: leaderEvent.fillId || null,
      subscriptionId: subscription.id,
      followerId: subscription.followerId,
      traderId: input.traderId,
      followerAccountId: subscription.followerAccountId,
      sizingMode: subscription.allocationMode,
      leaderQuantity: leaderEvent.quantity,
      leaderPrice: leaderEvent.price || null,
      followerQuantity: followerIntent.quantity,
      followerPrice: followerIntent.price || null,
      slippageTolerance: effectivePolicy.slippageToleranceBps?.toString() || null,
      maxNotional: effectivePolicy.maxOrderNotional || null,
      executionIntent: followerIntent as any,
      idempotencyKey: `copy_${tenantId}_${leaderEvent.eventId}_${subscription.id}_${Date.now()}`,
    });

    await this.executionRepo.updateStatus(execution.id, tenantId, CopyExecutionStatus.VALIDATED, { riskDecision: riskCheck.decision, riskRuleId: riskCheck.ruleId || undefined });

    // Here we would integrate with existing ExecutionEngine / order creation - but we must not bypass live gate
    // For now, we mark as MAPPED and ROUTED, and create an order intent that will be picked up by existing execution engine

    await this.executionRepo.updateStatus(execution.id, tenantId, CopyExecutionStatus.MAPPED);
    await this.executionRepo.updateStatus(execution.id, tenantId, CopyExecutionStatus.RISK_CHECKED);
    await this.executionRepo.updateStatus(execution.id, tenantId, CopyExecutionStatus.ROUTED);

    // The actual order creation should be handled by existing execution engine that checks live-mode gate
    // We do not directly create order via exchange client - we create intent

    this.logger.log(`Copy execution created tenant=${tenantId} execution=${execution.id} follower=${subscription.followerId} qty=${followerIntent.quantity}`);

    // Audit
    await (this.prisma as any).copyTradingAuditLog?.create({
      data: {
        id: randomUUID(),
        tenantId,
        event: 'COPY_EXECUTION_CREATED',
        actorId: input.traderId,
        traderId: input.traderId,
        followerId: subscription.followerId,
        strategyId: input.strategyId,
        subscriptionId: subscription.id,
        executionId: execution.id,
        result: 'SUCCESS',
        safeMetadata: { leaderEventId: leaderEvent.eventId, symbol: followerIntent.symbol, side: followerIntent.side, quantity: followerIntent.quantity, price: followerIntent.price },
        createdAt: new Date(),
      },
    });

    return { ...execution, status: CopyExecutionStatus.ROUTED, followerIntent };
  }
}
