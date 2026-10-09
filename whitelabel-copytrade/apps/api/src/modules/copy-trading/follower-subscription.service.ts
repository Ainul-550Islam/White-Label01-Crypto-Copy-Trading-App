import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
  ConflictException,
} from '@nestjs/common';
import { CopySubscriptionRepository } from './copy-subscription.repository';
import { FollowerAllocationService } from './follower-allocation.service';
import { CopyPolicyService } from './copy-policy.service';
import { TraderProfileService } from './trader-profile.service';
import { TraderStrategyService } from './trader-strategy.service';
import { CopySubscriptionState, CopySizingMode } from './copy-trading.types';
import { PlanLimitFollowersGuard } from '../billing/enforcement/plan-limit-followers.guard';
import { PlanLimitCopySubscriptionsGuard } from '../billing/enforcement/plan-limit-copy-subscriptions.guard';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OutboxService } from '../../infrastructure/outbox/outbox.service';
import { MaintenanceModeService } from '../operations/maintenance-mode.service';
import { OperationalMaintenanceScope } from '../operations/operations.types';
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
    private readonly maintenance: MaintenanceModeService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Starting or resuming copying is a new trading action, so it is refused
   * (503) while a PLATFORM, tenant or TRADING_CAPABILITY maintenance window is
   * active - the same rule the customer web uses to disable the copy button
   * (`blocksTrading` on GET /operations/maintenance/current). Pause and stop
   * stay available: reducing exposure must always work.
   */
  private assertTradingOpen(tenantId: string, operation: string): Promise<void> {
    return this.maintenance.enforceMaintenanceGate({
      tenantId,
      scope: OperationalMaintenanceScope.TRADING_CAPABILITY,
      operation,
    });
  }

  private async transitionWithOutbox(input: {
    tenantId: string;
    subscription: Record<string, any>;
    expectedState: CopySubscriptionState;
    nextState: CopySubscriptionState;
    eventType: string;
    timestamps?: { startedAt?: Date; pausedAt?: Date; stoppedAt?: Date; cancelledAt?: Date };
  }): Promise<any> {
    const subscriptionId =
      typeof input.subscription.id === 'string' ? input.subscription.id : input.subscription.subscriptionId;
    if (typeof subscriptionId !== 'string' || subscriptionId.length === 0) {
      throw new ConflictException('Copy subscription id is unavailable; refusing to record a lifecycle event');
    }

    const transitionEventId = randomUUID();
    return this.prisma.withTenantRls(input.tenantId, async (tx) => {
      const updated = await this.subscriptionRepo.updateState(
        subscriptionId,
        input.tenantId,
        input.nextState,
        input.timestamps,
        { tx, expectedState: input.expectedState },
      );
      if (!updated) {
        throw new ConflictException('Copy subscription state changed concurrently; reload and retry');
      }

      const updatedId = typeof updated.id === 'string' ? updated.id : subscriptionId;
      await this.outbox.append(tx, {
        tenantId: input.tenantId,
        aggregateType: 'copy.subscription',
        aggregateId: updatedId,
        eventType: input.eventType,
        idempotencyKey: `copy-subscription:${updatedId}:${input.eventType}:${transitionEventId}`,
        payload: {
          subscriptionId: updatedId,
          followerId: updated.followerId ?? input.subscription.followerId ?? null,
          traderId: updated.traderId ?? input.subscription.traderId ?? null,
          strategyId: updated.strategyId ?? input.subscription.strategyId ?? null,
          state: input.nextState,
        },
      });
      return updated;
    });
  }

  async subscribe(input: SubscribeInput): Promise<any> {
    await this.assertTradingOpen(input.tenantId, 'copy_trading.subscribe');

    // Validate trader/strategy
    const trader = await this.traderProfileService.getProfile(input.tenantId, input.traderId);
    // Business-rule failures are HTTP exceptions: plain Errors surfaced to the
    // follower as a generic 500 instead of the actual reason.
    if (!trader) throw new NotFoundException(`Trader ${input.traderId} not found`);

    const strategy = await this.traderStrategyService.getStrategy(input.tenantId, input.strategyId);
    if (!strategy) throw new NotFoundException(`Strategy ${input.strategyId} not found`);
    if (strategy.traderId !== input.traderId) throw new UnprocessableEntityException('Strategy does not belong to trader');
    if (strategy.status !== 'PUBLISHED') {
      throw new UnprocessableEntityException(`Strategy must be PUBLISHED to subscribe, current=${strategy.status}`);
    }

    // Validate follower eligibility - check compliance BLOCK
    // Fail closed: this used an untyped query inside a catch that swallowed
    // every error except its own, so any database failure skipped the block.
    const complianceCase = await this.prisma.complianceCase.findFirst({
      where: {
        tenantId: input.tenantId,
        userId: input.followerId,
        decision: 'BLOCK',
        state: { in: ['OPEN', 'IN_REVIEW', 'ESCALATED'] },
      },
      select: { id: true },
    });
    if (complianceCase) throw new ForbiddenException('Follower account is blocked by compliance');

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
        throw new UnprocessableEntityException(
          `Allocation validation failed: ${allocationValidation.reason} available=${allocationValidation.availableBalance}`,
        );
      }

      // Creation, activation and the durable domain event share one tenant-RLS
      // transaction. A commit cannot expose ACTIVE without its outbox row.
      subscription = await this.prisma.withTenantRls(input.tenantId, async (tx) => {
        const created = await this.subscriptionRepo.create(
          {
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
          },
          tx,
        );
        const activatedAt = new Date();
        const expectedState = (created.state as CopySubscriptionState | undefined) ?? CopySubscriptionState.PENDING;
        const activated = await this.subscriptionRepo.updateState(
          created.id,
          input.tenantId,
          CopySubscriptionState.ACTIVE,
          { startedAt: activatedAt },
          { tx, expectedState },
        );
        if (!activated) {
          throw new ConflictException('Copy subscription could not be activated from its current state');
        }

        await this.outbox.append(tx, {
          tenantId: input.tenantId,
          aggregateType: 'copy.subscription',
          aggregateId: activated.id,
          eventType: 'copy.subscription.created',
          idempotencyKey: `copy-subscription:${activated.id}:copy.subscription.created`,
          payload: {
            subscriptionId: activated.id,
            followerId: activated.followerId,
            traderId: activated.traderId,
            strategyId: activated.strategyId,
            state: CopySubscriptionState.ACTIVE,
          },
        });
        return activated;
      });

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

      return subscription;
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
          await this.transitionWithOutbox({
            tenantId: input.tenantId,
            subscription,
            expectedState: subscription.state as CopySubscriptionState,
            nextState: CopySubscriptionState.CANCELLED,
            eventType: 'copy.subscription.cancelled',
            timestamps: { cancelledAt: new Date() },
          });
        } catch {
          // Preserve the original subscribe failure. The failed transaction
          // remains visible through its own error and is never marked cancelled
          // unless the state transition and event committed together.
        }
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
    if (followerId && sub.followerId !== followerId) throw new ForbiddenException('Not authorized to pause this subscription');

    if (sub.state !== CopySubscriptionState.ACTIVE) throw new ConflictException(`Only ACTIVE subscription can be paused, current=${sub.state}`);

    const updated = await this.transitionWithOutbox({
      tenantId,
      subscription: sub,
      expectedState: CopySubscriptionState.ACTIVE,
      nextState: CopySubscriptionState.PAUSED,
      eventType: 'copy.subscription.paused',
      timestamps: { pausedAt: new Date() },
    });

    await (this.prisma as any).copyTradingAuditLog?.create({
      data: { id: randomUUID(), tenantId, event: 'SUBSCRIPTION_PAUSED', actorId, traderId: sub.traderId, followerId: sub.followerId, strategyId: sub.strategyId, subscriptionId, result: 'SUCCESS', safeMetadata: {}, requestId, createdAt: new Date() },
    });

    this.logger.log(`Subscription paused id=${subscriptionId} tenant=${tenantId}`);

    return updated;
  }

  async resumeSubscription(tenantId: string, subscriptionId: string, actorId: string, followerId?: string | null, requestId?: string): Promise<any | null> {
    const sub = await this.subscriptionRepo.findById(subscriptionId, tenantId);
    if (!sub) return null;
    if (followerId && sub.followerId !== followerId) throw new ForbiddenException('Not authorized');

    if (sub.state !== CopySubscriptionState.PAUSED) throw new ConflictException(`Only PAUSED subscription can be resumed, current=${sub.state}`);
    await this.assertTradingOpen(tenantId, 'copy_trading.resume');

    const updated = await this.transitionWithOutbox({
      tenantId,
      subscription: sub,
      expectedState: CopySubscriptionState.PAUSED,
      nextState: CopySubscriptionState.ACTIVE,
      eventType: 'copy.subscription.resumed',
      timestamps: { startedAt: new Date() },
    });

    await (this.prisma as any).copyTradingAuditLog?.create({
      data: { id: randomUUID(), tenantId, event: 'SUBSCRIPTION_RESUMED', actorId, traderId: sub.traderId, followerId: sub.followerId, strategyId: sub.strategyId, subscriptionId, result: 'SUCCESS', safeMetadata: {}, requestId, createdAt: new Date() },
    });

    return updated;
  }

  async stopCopy(tenantId: string, subscriptionId: string, actorId: string, followerId?: string | null, requestId?: string): Promise<any | null> {
    const sub = await this.subscriptionRepo.findById(subscriptionId, tenantId);
    if (!sub) return null;
    if (followerId && sub.followerId !== followerId) throw new ForbiddenException('Not authorized');

    // Pausing/stopping copy must prevent future copy actions without corrupting already-executed orders
    if (sub.state === CopySubscriptionState.STOPPED || sub.state === CopySubscriptionState.CANCELLED) throw new ConflictException(`Subscription already ${sub.state}`);

    const updated = await this.transitionWithOutbox({
      tenantId,
      subscription: sub,
      expectedState: sub.state as CopySubscriptionState,
      nextState: CopySubscriptionState.STOPPED,
      eventType: 'copy.subscription.stopped',
      timestamps: { stoppedAt: new Date() },
    });

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
    if (followerId && sub.followerId !== followerId) throw new ForbiddenException('Not authorized');

    const updated = await this.transitionWithOutbox({
      tenantId,
      subscription: sub,
      expectedState: sub.state as CopySubscriptionState,
      nextState: CopySubscriptionState.CANCELLED,
      eventType: 'copy.subscription.cancelled',
      timestamps: { cancelledAt: new Date() },
    });

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

  async updateSubscriptionSettings(
    tenantId: string,
    subscriptionId: string,
    dto: {
      allocationAmount?: string;
      maxAllocation?: string | null;
      minAllocation?: string | null;
      allocationMode?: CopySizingMode;
      copyPolicy?: Record<string, any>;
      riskPolicy?: Record<string, any>;
      followerAccountId?: string | null;
    },
    actorId: string,
    followerId?: string | null,
    requestId?: string,
  ): Promise<any | null> {
    const sub = await this.subscriptionRepo.findById(subscriptionId, tenantId);
    if (!sub) return null;
    if (followerId && sub.followerId !== followerId) {
      throw new ForbiddenException('Not authorized to update this subscription');
    }

    const nextCopyPolicy = dto.copyPolicy
      ? { ...(sub.copyPolicy || {}), ...dto.copyPolicy }
      : (sub.copyPolicy || {});
    const nextRiskPolicy = dto.riskPolicy
      ? { ...(sub.riskPolicy || {}), ...dto.riskPolicy }
      : (sub.riskPolicy || {});

    const policyValidation = this.policyService.validatePolicy(nextCopyPolicy as any);
    if (!policyValidation.valid) {
      throw new UnprocessableEntityException(`Invalid copy policy: ${policyValidation.errors.join(', ')}`);
    }

    if (dto.allocationAmount !== undefined || dto.maxAllocation !== undefined || dto.minAllocation !== undefined || dto.allocationMode !== undefined) {
      await this.subscriptionRepo.updateAllocation(subscriptionId, tenantId, {
        ...(dto.allocationAmount !== undefined ? { allocationAmount: dto.allocationAmount } : {}),
        ...(dto.maxAllocation !== undefined ? { maxAllocation: dto.maxAllocation } : {}),
        ...(dto.minAllocation !== undefined ? { minAllocation: dto.minAllocation } : {}),
        ...(dto.allocationMode !== undefined ? { allocationMode: dto.allocationMode } : {}),
      });
    }

    const updated = await this.subscriptionRepo.updatePolicy(subscriptionId, tenantId, {
      copyPolicy: nextCopyPolicy,
      riskPolicy: nextRiskPolicy,
    });

    await (this.prisma as any).copyTradingAuditLog?.create({
      data: {
        id: randomUUID(),
        tenantId,
        event: 'SUBSCRIPTION_SETTINGS_UPDATED',
        actorId,
        traderId: sub.traderId,
        followerId: sub.followerId,
        strategyId: sub.strategyId,
        subscriptionId,
        result: 'SUCCESS',
        safeMetadata: {
          allocationMode: dto.allocationMode ?? sub.allocationMode,
          allocationAmount: dto.allocationAmount ?? sub.allocationAmount,
        },
        requestId,
        createdAt: new Date(),
      },
    });

    return updated || (await this.subscriptionRepo.findById(subscriptionId, tenantId));
  }
}
