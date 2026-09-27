import { Injectable, Logger } from '@nestjs/common';
import { CopySubscriptionRepository } from './copy-subscription.repository';
import { FollowerAllocationService } from './follower-allocation.service';
import { CopyPolicyService } from './copy-policy.service';
import { TraderProfileService } from './trader-profile.service';
import { TraderStrategyService } from './trader-strategy.service';
import { CopySubscriptionState, CopySizingMode } from './copy-trading.types';
import { PlanLimitFollowersGuard } from '../billing/enforcement/plan-limit-followers.guard';
import { PlanLimitCopySubscriptionsGuard } from '../billing/enforcement/plan-limit-copy-subscriptions.guard';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { randomUUID } from 'crypto';

export interface SubscribeInput {
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
  actorId: string;
  requestId?: string;
}

/**
 * Follower lifecycle: subscribe, activate, pause, resume, stop-copy, cancel, and retrieve subscription state while enforcing existing plan limits and subscription rules.
 * Must enforce maxCopySubscriptionsPerFollower using existing Part 2 enforcement, and maxFollowersPerTrader using existing system. Do not duplicate numeric limits.
 */
@Injectable()
export class FollowerSubscriptionService {
  private readonly logger = new Logger(FollowerSubscriptionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionRepo: CopySubscriptionRepository,
    private readonly allocationService: FollowerAllocationService,
    private readonly policyService: CopyPolicyService,
    private readonly traderProfileService: TraderProfileService,
    private readonly traderStrategyService: TraderStrategyService,
    private readonly followersGuard: PlanLimitFollowersGuard,
    private readonly copySubsGuard: PlanLimitCopySubscriptionsGuard,
  ) {}

  async subscribe(input: SubscribeInput): Promise<any> {
    // Validate trader/strategy
    const trader = await this.traderProfileService.getProfile(input.tenantId, input.traderId);
    if (!trader) throw new Error(`Trader ${input.traderId} not found`);

    const strategy = await this.traderStrategyService.getStrategy(input.tenantId, input.strategyId);
    if (!strategy) throw new Error(`Strategy ${input.strategyId} not found`);
    if (strategy.traderId !== input.traderId) throw new Error('Strategy does not belong to trader');
    if (strategy.status !== 'PUBLISHED') throw new Error(`Strategy must be PUBLISHED to subscribe, current=${strategy.status}`);

    // Validate follower eligibility - check compliance BLOCK
    try {
      const complianceCase = await (this.prisma as any).complianceCase?.findFirst({ where: { tenantId: input.tenantId, userId: input.followerId, decision: 'BLOCK', state: { in: ['OPEN', 'IN_REVIEW', 'ESCALATED'] } } });
      if (complianceCase) throw new Error('Follower account is blocked by compliance');
    } catch (e: any) {
      if (e.message.includes('blocked by compliance')) throw e;
    }

    // Enforce existing plan limits - maxCopySubscriptionsPerFollower
    const actor = { tenantId: input.tenantId, userId: input.actorId } as any;
    try {
      await this.copySubsGuard.reserve(actor, input.followerId);
    } catch (e: any) {
      this.logger.warn(`Copy subscription limit exceeded follower=${input.followerId} tenant=${input.tenantId}`);
      throw e;
    }

    // Enforce maxFollowersPerTrader
    try {
      await this.followersGuard.reserve(actor, input.traderId);
    } catch (e: any) {
      // Release copy sub slot if follower limit fails
      try {
        await this.copySubsGuard.release(actor, input.followerId);
      } catch {}
      this.logger.warn(`Follower limit exceeded trader=${input.traderId} tenant=${input.tenantId}`);
      throw e;
    }

    let subscription;
    try {
      // Validate allocation uses canonical follower balance
      const allocationValidation = await this.allocationService.validateAllocation({
        tenantId: input.tenantId,
        followerId: input.followerId,
        followerAccountId: input.followerAccountId || null,
        allocationMode: input.allocationMode,
        allocationAmount: input.allocationAmount,
        maxAllocation: input.maxAllocation || null,
        minAllocation: input.minAllocation || null,
      });

      if (!allocationValidation.valid) {
        throw new Error(`Allocation validation failed: ${allocationValidation.reason} available=${allocationValidation.availableBalance}`);
      }

      // Create subscription
      subscription = await this.subscriptionRepo.create({
        tenantId: input.tenantId,
        followerId: input.followerId,
        traderId: input.traderId,
        strategyId: input.strategyId,
        allocationMode: input.allocationMode,
        allocationAmount: input.allocationAmount,
        maxAllocation: input.maxAllocation || null,
        minAllocation: input.minAllocation || null,
        copyPolicy: input.copyPolicy || {},
        riskPolicy: input.riskPolicy || {},
        followerAccountId: input.followerAccountId || null,
        idempotencyKey: input.idempotencyKey || null,
      });

      // Activate
      const activated = await this.subscriptionRepo.updateState(subscription.id, input.tenantId, CopySubscriptionState.ACTIVE, { startedAt: new Date() });

      // Increment trader follower count
      await this.traderProfileService.incrementFollowerCount(input.tenantId, input.traderId);

      // Audit
      await (this.prisma as any).copyTradingAuditLog?.create({
        data: {
          id: randomUUID(),
          tenantId: input.tenantId,
          event: 'SUBSCRIPTION_CREATED',
          actorId: input.actorId,
          traderId: input.traderId,
          followerId: input.followerId,
          strategyId: input.strategyId,
          subscriptionId: subscription.id,
          result: 'SUCCESS',
          safeMetadata: { allocationMode: input.allocationMode, allocationAmount: input.allocationAmount, followerAccountId: input.followerAccountId },
          requestId: input.requestId,
          createdAt: new Date(),
        },
      });

      this.logger.log(`Subscription created and activated id=${subscription.id} tenant=${input.tenantId} follower=${input.followerId} trader=${input.traderId}`);

      return activated || subscription;
    } catch (e: any) {
      // Release both slots on failure
      try {
        await this.copySubsGuard.release(actor, input.followerId);
      } catch {}
      try {
        await this.followersGuard.release(actor, input.traderId);
      } catch {}

      if (subscription) {
        try {
          await this.subscriptionRepo.updateState(subscription.id, input.tenantId, CopySubscriptionState.CANCELLED, { cancelledAt: new Date() });
        } catch {}
      }

      throw e;
    }
  }

  async getSubscription(tenantId: string, subscriptionId: string, followerId?: string | null): Promise<any | null> {
    const sub = await this.subscriptionRepo.findById(subscriptionId, tenantId);
    if (!sub) return null;
    if (followerId && sub.followerId !== followerId) {
      // Check if privileged? For now, enforce follower ownership
      const isTrader = sub.traderId === followerId; // trader can view own followers? Simplified
      if (!isTrader) return null;
    }
    return sub;
  }

  async listByFollower(tenantId: string, followerId: string, filters?: { state?: CopySubscriptionState; page?: number; limit?: number }): Promise<{ data: any[]; total: number }> {
    return this.subscriptionRepo.listByFollower(tenantId, followerId, filters);
  }

  async listByTrader(tenantId: string, traderId: string, filters?: { state?: CopySubscriptionState; page?: number; limit?: number }): Promise<{ data: any[]; total: number }> {
    return this.subscriptionRepo.listByTrader(tenantId, traderId, filters);
  }

  async pauseSubscription(tenantId: string, subscriptionId: string, actorId: string, followerId?: string | null, requestId?: string): Promise<any | null> {
    const sub = await this.subscriptionRepo.findById(subscriptionId, tenantId);
    if (!sub) return null;
    if (followerId && sub.followerId !== followerId) throw new Error('Not authorized to pause this subscription');

    if (sub.state !== CopySubscriptionState.ACTIVE) throw new Error(`Only ACTIVE subscription can be paused, current=${sub.state}`);

    const updated = await this.subscriptionRepo.updateState(subscriptionId, tenantId, CopySubscriptionState.PAUSED, { pausedAt: new Date() });

    await (this.prisma as any).copyTradingAuditLog?.create({
      data: { id: randomUUID(), tenantId, event: 'SUBSCRIPTION_PAUSED', actorId, traderId: sub.traderId, followerId: sub.followerId, strategyId: sub.strategyId, subscriptionId, result: 'SUCCESS', safeMetadata: {}, requestId, createdAt: new Date() },
    });

    this.logger.log(`Subscription paused id=${subscriptionId} tenant=${tenantId}`);

    return updated;
  }

  async resumeSubscription(tenantId: string, subscriptionId: string, actorId: string, followerId?: string | null, requestId?: string): Promise<any | null> {
    const sub = await this.subscriptionRepo.findById(subscriptionId, tenantId);
    if (!sub) return null;
    if (followerId && sub.followerId !== followerId) throw new Error('Not authorized');

    if (sub.state !== CopySubscriptionState.PAUSED) throw new Error(`Only PAUSED subscription can be resumed, current=${sub.state}`);

    const updated = await this.subscriptionRepo.updateState(subscriptionId, tenantId, CopySubscriptionState.ACTIVE, { startedAt: new Date() });

    await (this.prisma as any).copyTradingAuditLog?.create({
      data: { id: randomUUID(), tenantId, event: 'SUBSCRIPTION_RESUMED', actorId, traderId: sub.traderId, followerId: sub.followerId, strategyId: sub.strategyId, subscriptionId, result: 'SUCCESS', safeMetadata: {}, requestId, createdAt: new Date() },
    });

    return updated;
  }

  async stopCopy(tenantId: string, subscriptionId: string, actorId: string, followerId?: string | null, requestId?: string): Promise<any | null> {
    const sub = await this.subscriptionRepo.findById(subscriptionId, tenantId);
    if (!sub) return null;
    if (followerId && sub.followerId !== followerId) throw new Error('Not authorized');

    // Pausing/stopping copy must prevent future copy actions without corrupting already-executed orders
    if (sub.state === CopySubscriptionState.STOPPED || sub.state === CopySubscriptionState.CANCELLED) throw new Error(`Subscription already ${sub.state}`);

    const updated = await this.subscriptionRepo.updateState(subscriptionId, tenantId, CopySubscriptionState.STOPPED, { stoppedAt: new Date() });

    // Release plan limits
    try {
      const actor = { tenantId, userId: actorId } as any;
      await this.copySubsGuard.release(actor, sub.followerId);
      await this.followersGuard.release(actor, sub.traderId);
      await this.traderProfileService.decrementFollowerCount(tenantId, sub.traderId);
    } catch {}

    await (this.prisma as any).copyTradingAuditLog?.create({
      data: { id: randomUUID(), tenantId, event: 'SUBSCRIPTION_STOPPED', actorId, traderId: sub.traderId, followerId: sub.followerId, strategyId: sub.strategyId, subscriptionId, result: 'SUCCESS', safeMetadata: {}, requestId, createdAt: new Date() },
    });

    this.logger.log(`Subscription stopped id=${subscriptionId} tenant=${tenantId}`);

    return updated;
  }

  async cancelSubscription(tenantId: string, subscriptionId: string, actorId: string, followerId?: string | null, requestId?: string): Promise<any | null> {
    const sub = await this.subscriptionRepo.findById(subscriptionId, tenantId);
    if (!sub) return null;
    if (followerId && sub.followerId !== followerId) throw new Error('Not authorized');

    const updated = await this.subscriptionRepo.updateState(subscriptionId, tenantId, CopySubscriptionState.CANCELLED, { cancelledAt: new Date() });

    try {
      const actor = { tenantId, userId: actorId } as any;
      await this.copySubsGuard.release(actor, sub.followerId);
      await this.followersGuard.release(actor, sub.traderId);
      await this.traderProfileService.decrementFollowerCount(tenantId, sub.traderId);
    } catch {}

    await (this.prisma as any).copyTradingAuditLog?.create({
      data: { id: randomUUID(), tenantId, event: 'SUBSCRIPTION_CANCELLED', actorId, traderId: sub.traderId, followerId: sub.followerId, strategyId: sub.strategyId, subscriptionId, result: 'SUCCESS', safeMetadata: {}, requestId, createdAt: new Date() },
    });

    return updated;
  }
}
