import { Injectable, Logger, Inject, Optional, forwardRef } from '@nestjs/common';
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
import { OrderIntentService } from '../oms/order-intent.service';
import { OrderRoutingService } from '../oms/order-routing.service';
import { MaintenanceModeService } from '../operations/maintenance-mode.service';
import { OperationalMaintenanceScope } from '../operations/operations.types';

/** One copy execution per (tenant, leader event, subscription). Deterministic
 * on purpose: the previous key appended Date.now(), so two concurrent
 * deliveries of the same leader event produced two keys - and two follower
 * orders. With a stable key the second insert collides and is dropped. */
export function copyIdempotencyKey(tenantId: string, leaderEventId: string, subscriptionId: string): string {
  return `copy_${tenantId}_${leaderEventId}_${subscriptionId}`;
}

/** The environment a follower order runs in, from the follower's own account.
 * A sandbox account is PAPER; anything else is LIVE - which the OMS live gate
 * and the simulated-only submission path then refuse explicitly. Unknown
 * (no account) is PAPER-never-LIVE: fail closed toward "no real money". */
export function copyEnvironmentFor(account: { isSandbox?: boolean | null } | null | undefined): 'PAPER' | 'LIVE' {
  if (!account) return 'PAPER';
  return account.isSandbox === false ? 'LIVE' : 'PAPER';
}

/** Copy mapper order types onto the OMS vocabulary; anything else is refused. */
export function copyOrderTypeFor(type: string | null | undefined): 'MARKET' | 'LIMIT' | null {
  const upper = (type ?? '').toUpperCase();
  if (upper === 'MARKET') return 'MARKET';
  if (upper === 'LIMIT') return 'LIMIT';
  return null;
}

/** An engaged kill-switch row as the copy path reads it. */
export interface EngagedKillSwitch {
  id?: string;
  scope: string;
  target: string | null;
  tenantId: string | null;
}

const switchToken = (value: unknown): string => String(value ?? '').trim().toUpperCase();
/** BTC-USDT, btc/usdt and BTCUSDT are one instrument for halting purposes. */
const symbolToken = (value: unknown): string => switchToken(value).replace(/[^A-Z0-9]/g, '');

/**
 * The engaged switch that halts this leader event for EVERY follower, or null.
 *
 * Same matching as the engine's ledger (``_blocking_record_for`` in
 * wlct_trading/risk/protections.py): GLOBAL always; EXCHANGE when the target is
 * the leader's venue; STRATEGY when it is this strategy; SYMBOL when it is this
 * instrument. Venue and symbol compare case- and separator-insensitively, which
 * can only halt more, never less. ACCOUNT and RISK (``account:<id>``) switches
 * halt one trading account and are applied per follower by
 * {@link accountKillSwitchBlocker}. A non-GLOBAL row without a target, or a scope
 * this code does not know, cannot be matched safely and halts the event.
 *
 * Previously ANY engaged row in the tenant blocked every event, so a SYMBOL
 * switch on one coin or an ACCOUNT switch on one follower stopped all copy
 * trading in the tenant.
 */
export function eventKillSwitchBlocker(
  switches: EngagedKillSwitch[],
  event: { venue?: string | null; strategyId: string; symbol?: string | null; exchangeSymbol?: string | null },
): EngagedKillSwitch | null {
  const eventSymbols = new Set([symbolToken(event.symbol), symbolToken(event.exchangeSymbol)].filter((token) => token.length > 0));
  for (const ks of switches) {
    const target = ks.target === null || ks.target === undefined ? '' : String(ks.target).trim();
    switch (ks.scope) {
      case 'GLOBAL':
        return ks;
      case 'EXCHANGE':
        if (!target || switchToken(target) === switchToken(event.venue)) return ks;
        break;
      case 'STRATEGY':
        if (!target || target === event.strategyId) return ks;
        break;
      case 'SYMBOL':
        if (!target || eventSymbols.has(symbolToken(target))) return ks;
        break;
      case 'ACCOUNT':
      case 'RISK':
        if (!target) return ks;
        break;
      default:
        return ks;
    }
  }
  return null;
}

/**
 * The engaged ACCOUNT / RISK switch that halts one follower's trading account,
 * or null. Targets as the engine writes them: ACCOUNT = the account id, RISK =
 * ``account:<id>``.
 */
export function accountKillSwitchBlocker(switches: EngagedKillSwitch[], accountId: string | null | undefined): EngagedKillSwitch | null {
  if (!accountId) return null;
  for (const ks of switches) {
    const target = ks.target === null || ks.target === undefined ? '' : String(ks.target).trim();
    if (ks.scope === 'ACCOUNT' && target === accountId) return ks;
    if (ks.scope === 'RISK' && target === `account:${accountId}`) return ks;
  }
  return null;
}

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
    // Trading maintenance windows stop new copied orders (same rule as the
    // subscribe/resume gate and the customer web's `blocksTrading`).
    private readonly maintenance: MaintenanceModeService,
    // Phase 3: the OMS is how a copy execution becomes an order. forwardRef
    // because OmsModule already imports CopyTradingModule; @Optional so a
    // harness without the OMS still constructs this service - and then every
    // execution fails closed as OMS_NOT_WIRED instead of pretending to route.
    @Optional() @Inject(forwardRef(() => OrderIntentService)) private readonly orderIntents?: OrderIntentService,
    @Optional() @Inject(forwardRef(() => OrderRoutingService)) private readonly orderRouting?: OrderRoutingService,
  ) {}

  async processLeaderEvent(input: { tenantId: string; leaderEvent: LeaderEvent; traderId: string; strategyId: string; actorId?: string }): Promise<{ processed: number; skipped: number; blocked: number; executions: any[] }> {
    this.logger.log(`Processing leader event tenant=${input.tenantId} event=${input.leaderEvent.eventId} trader=${input.traderId} strategy=${input.strategyId} symbol=${input.leaderEvent.symbol}`);

    // The compliance subject is the trader's USER. `traderId` is a
    // TraderProfile id (TraderStrategy.traderId -> TraderProfile.id) while
    // ComplianceCase.userId is a User id, so the trader's user is resolved
    // first. Checking the profile id directly never matched, which let a
    // compliance-blocked trader keep being copied. An unknown, suspended or
    // rejected trader, or a lookup that cannot be made, blocks the copy.
    let traderUserId: string;
    try {
      const profile = await (this.prisma as any).traderProfile?.findFirst({
        where: { id: input.traderId, tenantId: input.tenantId },
        select: { userId: true, verificationState: true },
      });
      if (!profile?.userId) {
        this.logger.warn(`Leader event blocked: trader profile not found tenant=${input.tenantId} trader=${input.traderId}`);
        return { processed: 0, skipped: 0, blocked: 1, executions: [] };
      }
      if (profile.verificationState === 'SUSPENDED' || profile.verificationState === 'REJECTED') {
        this.logger.warn(`Leader event blocked: trader ${input.traderId} is ${profile.verificationState}`);
        return { processed: 0, skipped: 0, blocked: 1, executions: [] };
      }
      traderUserId = profile.userId;
    } catch (e: any) {
      this.logger.warn(`Leader event blocked: trader lookup failed trader=${input.traderId}: ${e?.message}`);
      return { processed: 0, skipped: 0, blocked: 1, executions: [] };
    }

    // Compliance BLOCK must prevent copy
    try {
      const complianceCase = await (this.prisma as any).complianceCase?.findFirst({ where: { tenantId: input.tenantId, userId: traderUserId, decision: 'BLOCK', state: { in: ['OPEN', 'IN_REVIEW', 'ESCALATED'] } } });
      if (complianceCase) {
        this.logger.warn(`Leader event blocked by compliance trader=${input.traderId} user=${traderUserId}`);
        return { processed: 0, skipped: 0, blocked: 1, executions: [] };
      }
    } catch (e: any) {
      // Fail closed: this used to continue unless the error text contained
      // 'BLOCK', so a failing compliance lookup let a blocked trader be copied.
      this.logger.warn(`Leader event blocked: compliance lookup failed trader=${input.traderId}: ${e?.message}`);
      return { processed: 0, skipped: 0, blocked: 1, executions: [] };
    }

    // An outage of the leader's venue stops the whole event. Only that venue
    // counts, and only UNAVAILABLE: this used to block on ANY account in the
    // tenant being UNAVAILABLE or AUTH_FAILED, so one follower's expired API
    // key halted copy trading for every follower. A single follower's broken
    // credentials are refused for that follower alone by the OMS routing
    // gates (the execution is recorded REJECTED/FAILED).
    try {
      const venue = String(input.leaderEvent.venue ?? '').toUpperCase();
      const healthList = await this.exchangeHealth.listHealthByTenant(input.tenantId);
      const outage = healthList.find((h: any) => String(h.venue ?? '').toUpperCase() === venue && h.state === 'UNAVAILABLE');
      if (outage) {
        this.logger.warn(`Leader event blocked: venue ${venue} unavailable tenant=${input.tenantId}`);
        return { processed: 0, skipped: 0, blocked: 1, executions: [] };
      }
    } catch (e: any) {
      this.logger.warn(`Leader event blocked: exchange health unavailable tenant=${input.tenantId}: ${e?.message}`);
      return { processed: 0, skipped: 0, blocked: 1, executions: [] };
    }

    // Kill switches, matched to THIS event (see eventKillSwitchBlocker): a
    // GLOBAL, leader-venue, strategy or symbol switch stops the event; ACCOUNT
    // and RISK switches stop only the follower account they name (below, per
    // subscription). Fails closed: a failed lookup blocks the event.
    let engagedSwitches: EngagedKillSwitch[];
    try {
      engagedSwitches = (await this.prisma.killSwitch.findMany({
        where: { isEngaged: true, OR: [{ tenantId: input.tenantId }, { tenantId: null }] },
        select: { id: true, scope: true, target: true, tenantId: true },
      })) as EngagedKillSwitch[];
      const eventBlocker = eventKillSwitchBlocker(engagedSwitches, {
        venue: input.leaderEvent.venue,
        strategyId: input.strategyId,
        symbol: input.leaderEvent.symbol,
        exchangeSymbol: input.leaderEvent.exchangeSymbol,
      });
      if (eventBlocker) {
        this.logger.warn(
          `Leader event blocked by kill switch tenant=${input.tenantId} scope=${eventBlocker.scope} target=${eventBlocker.target ?? '-'}`,
        );
        return { processed: 0, skipped: 0, blocked: 1, executions: [] };
      }
    } catch (e: any) {
      this.logger.warn(`Leader event blocked: kill switch lookup failed tenant=${input.tenantId}: ${e?.message}`);
      return { processed: 0, skipped: 0, blocked: 1, executions: [] };
    }

    // Trading maintenance (platform-wide, this tenant, or trading): no new
    // copied orders. Fails closed like the gates above.
    try {
      if (await this.maintenance.isInMaintenance({ scope: OperationalMaintenanceScope.TRADING_CAPABILITY, tenantId: input.tenantId })) {
        this.logger.warn(`Leader event blocked by trading maintenance tenant=${input.tenantId}`);
        return { processed: 0, skipped: 0, blocked: 1, executions: [] };
      }
    } catch (e: any) {
      this.logger.warn(`Leader event blocked: maintenance lookup failed tenant=${input.tenantId}: ${e?.message}`);
      return { processed: 0, skipped: 0, blocked: 1, executions: [] };
    }

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
          engagedSwitches,
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

  private async processForSubscription(input: {
    tenantId: string;
    leaderEvent: LeaderEvent;
    subscription: any;
    traderId: string;
    strategyId: string;
    engagedSwitches?: EngagedKillSwitch[];
  }): Promise<any | null> {
    const { tenantId, leaderEvent, subscription } = input;

    // Prevent duplicate execution intent from same leader event/subscription
    const existing = await this.executionRepo.findByLeaderEventAndSubscription(tenantId, leaderEvent.eventId, subscription.id);
    if (existing) {
      this.logger.log(`Duplicate execution prevented tenant=${tenantId} event=${leaderEvent.eventId} sub=${subscription.id}`);
      return existing;
    }

    // Phase 3: never copy a leader event that happened before this
    // subscription started (no history replay into a new follower).
    const eventAt = Date.parse(String(leaderEvent.timestamp ?? ''));
    if (subscription.startedAt && Number.isFinite(eventAt) && eventAt < new Date(subscription.startedAt).getTime()) {
      this.logger.log(`Leader event predates subscription tenant=${tenantId} event=${leaderEvent.eventId} sub=${subscription.id}`);
      return null;
    }

    // An ACCOUNT / RISK kill switch on this follower's trading account halts
    // this follower only; the rest of the tenant keeps copying. Recorded as a
    // BLOCKED execution so the follower's history shows why nothing was copied.
    const accountBlocker = accountKillSwitchBlocker(input.engagedSwitches ?? [], subscription.followerAccountId);
    if (accountBlocker) {
      this.logger.warn(
        `Copy blocked by kill switch tenant=${tenantId} sub=${subscription.id} scope=${accountBlocker.scope} target=${accountBlocker.target ?? '-'}`,
      );
      const halted = await this.executionRepo.create({
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
        slippageTolerance: null,
        maxNotional: null,
        executionIntent: { reason: 'KILL_SWITCH', scope: accountBlocker.scope, target: accountBlocker.target, leaderEvent } as any,
        idempotencyKey: copyIdempotencyKey(tenantId, leaderEvent.eventId, subscription.id),
      });
      await this.executionRepo.updateStatus(halted.id, tenantId, CopyExecutionStatus.BLOCKED, {
        failureReason: `${accountBlocker.scope} kill switch engaged for ${accountBlocker.target}`,
      });
      return { ...halted, status: CopyExecutionStatus.BLOCKED };
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
        idempotencyKey: copyIdempotencyKey(tenantId, leaderEvent.eventId, subscription.id),
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
        idempotencyKey: copyIdempotencyKey(tenantId, leaderEvent.eventId, subscription.id),
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
        idempotencyKey: copyIdempotencyKey(tenantId, leaderEvent.eventId, subscription.id),
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
        idempotencyKey: copyIdempotencyKey(tenantId, leaderEvent.eventId, subscription.id),
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
          idempotencyKey: copyIdempotencyKey(tenantId, leaderEvent.eventId, subscription.id),
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
              idempotencyKey: copyIdempotencyKey(tenantId, leaderEvent.eventId, subscription.id),
            });
            await this.executionRepo.updateStatus(blocked.id, tenantId, CopyExecutionStatus.BLOCKED, { failureReason: `Testnet/live mismatch followerSandbox=${isFollowerSandbox} leaderSimulated=${isLeaderSimulated}` });
            return { ...blocked, status: CopyExecutionStatus.BLOCKED };
          }
        }
      } catch (e: any) {
        // The paper/live check could not be made: do not copy (this used to
        // be swallowed and the order went on to dispatch).
        const failureReason = `FOLLOWER_ACCOUNT_UNREADABLE: ${e?.message ?? 'unknown error'}`.slice(0, 500);
        this.logger.warn(`Copy blocked for subscription ${subscription.id}: ${failureReason}`);
        return { subscriptionId: subscription.id, followerId: subscription.followerId, status: CopyExecutionStatus.BLOCKED, failureReason };
      }
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
      idempotencyKey: copyIdempotencyKey(tenantId, leaderEvent.eventId, subscription.id),
    });

    await this.executionRepo.updateStatus(execution.id, tenantId, CopyExecutionStatus.VALIDATED, { riskDecision: riskCheck.decision, riskRuleId: riskCheck.ruleId || undefined });

    await this.executionRepo.updateStatus(execution.id, tenantId, CopyExecutionStatus.MAPPED);
    await this.executionRepo.updateStatus(execution.id, tenantId, CopyExecutionStatus.RISK_CHECKED);

    // Phase 3: hand the follower order to the OMS. createIntent re-runs the
    // platform's own ownership/symbol/precision/risk/compliance/security
    // checks; routeIntent runs the final risk decision, exchange routing and
    // the live gate, creates the canonical order and enqueues SUBMIT_ORDER to
    // the worker - the only path to the execution engine. Nothing here talks
    // to a venue, and nothing here can skip a gate the OMS applies.
    const dispatch = await this.dispatchToOms({
      tenantId,
      execution,
      subscription,
      followerIntent,
      traderId: input.traderId,
      strategyId: input.strategyId,
      leaderEventId: leaderEvent.eventId,
    });
    if (dispatch.status !== CopyExecutionStatus.ROUTED) {
      return { ...execution, status: dispatch.status, failureReason: dispatch.reason, followerIntent };
    }

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

    return { ...execution, status: CopyExecutionStatus.ROUTED, followerIntent, omsIntentId: dispatch.omsIntentId, orderId: dispatch.orderId, jobId: dispatch.jobId };
  }

  /**
   * Create and route the OMS intent for one validated copy execution.
   *
   * Outcomes, each recorded on the copy execution so no path is silent:
   *   ROUTED   - intent created, routed, SUBMIT_ORDER enqueued. The final
   *              SUBMITTED/FILLED/REJECTED arrives from the engine via
   *              OrderSubmissionResultService.
   *   REJECTED - the OMS refused the order (risk, compliance, live gate,
   *              unsupported type, LIVE environment).
   *   FAILED   - the OMS is not wired, or submission failed operationally.
   */
  private async dispatchToOms(input: {
    tenantId: string;
    execution: any;
    subscription: any;
    followerIntent: any;
    traderId: string;
    strategyId: string;
    leaderEventId: string;
  }): Promise<{ status: CopyExecutionStatus; reason?: string; omsIntentId?: string; orderId?: string; jobId?: string }> {
    const { tenantId, execution, subscription, followerIntent } = input;
    if (!this.orderIntents || !this.orderRouting) {
      const reason = 'OMS_NOT_WIRED: copy execution cannot be dispatched without the order management system';
      await this.executionRepo.updateStatus(execution.id, tenantId, CopyExecutionStatus.FAILED, { failureReason: reason });
      return { status: CopyExecutionStatus.FAILED, reason };
    }
    if (!subscription.followerAccountId) {
      const reason = 'NO_FOLLOWER_ACCOUNT: subscription has no follower trading account';
      await this.executionRepo.updateStatus(execution.id, tenantId, CopyExecutionStatus.REJECTED, { failureReason: reason });
      return { status: CopyExecutionStatus.REJECTED, reason };
    }
    const orderType = copyOrderTypeFor(followerIntent.type);
    if (!orderType) {
      const reason = `ORDER_TYPE_NOT_SUPPORTED: copy of ${followerIntent.type} orders is not supported`;
      await this.executionRepo.updateStatus(execution.id, tenantId, CopyExecutionStatus.REJECTED, { failureReason: reason });
      return { status: CopyExecutionStatus.REJECTED, reason };
    }

    let environment: 'PAPER' | 'LIVE' = 'PAPER';
    try {
      const account = await this.prisma.tradingAccount.findFirst({ where: { id: subscription.followerAccountId, tenantId } });
      environment = copyEnvironmentFor(account as any);
    } catch (e: any) {
      const reason = `FOLLOWER_ACCOUNT_UNREADABLE: ${e?.message ?? 'unknown error'}`.slice(0, 500);
      await this.executionRepo.updateStatus(execution.id, tenantId, CopyExecutionStatus.FAILED, { failureReason: reason });
      return { status: CopyExecutionStatus.FAILED, reason };
    }

    let intent: any;
    try {
      intent = await this.orderIntents.createIntent({
        tenantId,
        accountId: subscription.followerAccountId,
        symbol: followerIntent.symbol,
        side: String(followerIntent.side).toUpperCase(),
        orderType,
        quantity: followerIntent.quantity,
        price: orderType === 'LIMIT' ? followerIntent.price : null,
        timeInForce: 'GTC',
        reduceOnly: followerIntent.isReduceOnly === true,
        strategyId: null,
        traderId: input.traderId,
        followerId: subscription.followerId,
        subscriptionId: subscription.id,
        environment,
        source: 'COPY_TRADING',
        signalId: null,
        correlationId: `copy-${execution.id}`,
        requestId: null,
        userId: subscription.followerId ?? null,
        venue: null,
        metadata: {
          copyExecutionId: String(execution.id),
          leaderEventId: String(input.leaderEventId).slice(0, 128),
          copyStrategyId: String(input.strategyId).slice(0, 128),
        },
      });
    } catch (e: any) {
      const reason = `OMS_INTENT_REFUSED: ${e?.message ?? 'unknown error'}`.slice(0, 500);
      this.logger.warn(`Copy execution ${execution.id} intent refused: ${reason}`);
      await this.executionRepo.updateStatus(execution.id, tenantId, CopyExecutionStatus.REJECTED, { failureReason: reason });
      return { status: CopyExecutionStatus.REJECTED, reason };
    }

    try {
      const routed = await this.orderRouting.routeIntent({
        tenantId,
        intentId: intent.id,
        userId: subscription.followerId ?? null,
        correlationId: `copy-${execution.id}`,
        requestId: null,
      });
      await this.executionRepo.updateStatus(execution.id, tenantId, CopyExecutionStatus.ROUTED, {
        followerOrderId: routed.canonicalOrderId,
      });
      return { status: CopyExecutionStatus.ROUTED, omsIntentId: intent.id, orderId: routed.canonicalOrderId, jobId: routed.jobId };
    } catch (e: any) {
      const status = e?.status === 403 || e?.status === 400 ? CopyExecutionStatus.REJECTED : CopyExecutionStatus.FAILED;
      const reason = `OMS_ROUTING_${status}: ${e?.message ?? 'unknown error'}`.slice(0, 500);
      this.logger.warn(`Copy execution ${execution.id} routing ${status}: ${reason}`);
      await this.executionRepo.updateStatus(execution.id, tenantId, status, { failureReason: reason });
      return { status, reason, omsIntentId: intent.id };
    }
  }
}
