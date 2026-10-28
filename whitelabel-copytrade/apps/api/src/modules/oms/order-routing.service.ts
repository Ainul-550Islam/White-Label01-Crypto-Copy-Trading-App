import { Injectable, Logger, BadRequestException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma, type TradingMarketType } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OrderIntentService } from './order-intent.service';
import { OrderLifecycleService } from './order-lifecycle.service';
import { RiskDecisionService } from '../risk-management/risk-decision.service';
import { accountOrderSizeLimitCode } from '../risk-management/account-order-size-limit-errors';
import { OrderIntentState } from './oms.types';
import { ExchangeRoutingService } from '../exchanges/exchange-routing.service';
import { ExchangeAccountService } from '../exchanges/exchange-account.service';
import { ExecutionSafetyService } from '../execution/execution-safety.service';
import { QueueService } from '../queue/queue.service';
import { JOB_NAMES, QUEUE_NAMES } from '@wlct/config';
import {
  SubmitOrderRefused,
  buildSubmitOrderJob,
  buildSubmitSpecification,
  computeSubmitExposure,
  submitOrderJobId,
} from './order-submission.payload';

/**
 * Order Routing Service — coordinates approved intents with:
 * ExchangeRoutingService, ExchangeAccountService, RiskDecisionService, Compliance, Live Gate, Execution Engine
 *
 * Flow: Approved Intent → Final Risk Check → Compliance Check → Exchange Routing → Live Safety Gate → Existing Execution Engine
 * Never directly call raw exchange REST endpoint here.
 */

@Injectable()
export class OrderRoutingService {
  private readonly logger = new Logger(OrderRoutingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly intentService: OrderIntentService,
    private readonly lifecycleService: OrderLifecycleService,
    private readonly riskDecisionService: RiskDecisionService,
    private readonly routingService: ExchangeRoutingService,
    private readonly accountService: ExchangeAccountService,
    private readonly safetyService: ExecutionSafetyService,
    private readonly queueService: QueueService,
  ) {}

  async routeIntent(params: {
    tenantId: string;
    intentId: string;
    userId?: string | null;
    correlationId?: string | null;
    requestId?: string | null;
  }) {
    const { tenantId, intentId, userId, correlationId, requestId } = params;

    let intent: any;
    try {
      intent = await this.prisma.withTenantRls(tenantId, async (tx) => {
        const store = tx as any;
        // A read failure is not evidence that this is a legacy Order. Only use
        // the fallback when the delegate itself is absent, never on a failed
        // tenant-scoped query.
        return typeof store.omsOrderIntent?.findFirst === 'function'
          ? store.omsOrderIntent.findFirst({ where: { id: intentId, tenantId } })
          : store.order.findFirst({ where: { id: intentId, tenantId } });
      });
    } catch {
      throw new ServiceUnavailableException('Order intent is unavailable; the order was not routed.');
    }
    if (!intent) throw new BadRequestException(`Intent ${intentId} not found`);

    const currentState = intent.state ?? intent.status;
    if (currentState !== OrderIntentState.APPROVED && currentState !== OrderIntentState.CREATED && currentState !== OrderIntentState.VALIDATING) {
      throw new BadRequestException(`Intent ${intentId} not in routable state, current ${currentState}`);
    }

    // Resolve the owner independently of the actor. The database ownership
    // guard prevents a transfer while this unresolved intent is in flight.
    let account: { userId: string | null; exchangeId: string; marketType: TradingMarketType } | null;
    try {
      account = await this.prisma.withTenantRls(tenantId, (tx) => tx.tradingAccount.findFirst({
        where: { id: intent.accountId, tenantId, deletedAt: null }, select: { userId: true, exchangeId: true, marketType: true },
      }));
    } catch {
      throw new ServiceUnavailableException('Trading account ownership is unavailable; the order was not routed.');
    }
    if (!account) throw new ServiceUnavailableException('Trading account ownership is unavailable; the order was not routed.');

    // Step 1: VALIDATING
    if (currentState === OrderIntentState.CREATED) {
      await this.lifecycleService.transition({
        tenantId,
        intentId,
        toState: OrderIntentState.VALIDATING,
        source: 'OMS_ROUTING',
        reason: 'Starting final validation before routing',
        correlationId,
      });
    }

    // Step 2: Final Risk Check — must not trust client-supplied risk approval.
    // A review, pause, stop or reduction request is not permission to send the
    // unchanged order. There is no reduced quantity or manual override here.
    let riskResult: Awaited<ReturnType<RiskDecisionService['evaluateUnifiedRisk']>>;
    try {
      riskResult = await this.riskDecisionService.evaluateUnifiedRisk({
        tenantId,
        userId: userId ?? null,
        accountId: intent.accountId,
        expectedAccountOwnerId: account.userId,
        symbol: intent.symbol,
        traderId: intent.traderId as any,
        followerId: intent.followerId as any,
        strategyId: intent.strategyId as any,
        orderIntent: { side: intent.side, quantity: intent.quantity?.toString() ?? intent.quantity, price: intent.price?.toString() ?? intent.price ?? null, orderType: intent.orderType } as any,
        excludePendingIntentId: intent.id,
        environment: intent.environment ?? 'PAPER',
        requestId: requestId as any,
      } as any);
    } catch {
      this.logger.warn(`Risk evaluation unavailable for routing tenant ${tenantId}`);
      // Keep VALIDATING/APPROVED so the caller may retry; nothing was sent.
      throw new ServiceUnavailableException('Risk evaluation is unavailable; the order was not routed.');
    }

    if (riskResult?.decision !== 'ALLOW') {
      await this.lifecycleService.transition({
        tenantId,
        intentId,
        toState: OrderIntentState.REJECTED,
        source: 'RISK',
        reason: 'Risk evaluation did not authorize the unchanged order.',
        correlationId,
        policyVersion: riskResult?.policyVersion ?? null,
      });
      throw new ForbiddenException('Risk evaluation did not authorize this order.');
    }

    // APPROVED
    await this.lifecycleService.transition({
      tenantId,
      intentId,
      toState: OrderIntentState.APPROVED,
      source: 'RISK',
      reason: `Risk approved: ${riskResult.decision} rules ${riskResult.ruleIds.join(',')}`,
      correlationId,
      policyVersion: riskResult.policyVersion,
    });

    // Step 3: An independent final screening for both operator and owner.
    // Do not query an unrelated tenant user when a house account has no actor.
    const subjects = Array.from(new Set([userId, account.userId].filter((id): id is string => !!id)));
    const complianceBlocked = subjects.length ? await this.prisma.withTenantRls(tenantId, (tx) => tx.complianceScreeningRequest.findFirst({
      where: { tenantId, userId: { in: subjects }, OR: [
        { status: { in: ['BLOCKED', 'REVIEW_REQUIRED'] } },
        { decision: { in: ['BLOCK', 'RESTRICT', 'REVIEW_REQUIRED'] } },
      ] },
      orderBy: { createdAt: 'desc' },
    })) : null;
    if (complianceBlocked) {
      await this.lifecycleService.transition({
        tenantId,
        intentId,
        toState: OrderIntentState.REJECTED,
        source: 'COMPLIANCE',
        reason: 'Compliance screening does not authorize routing.',
        correlationId,
      });
      throw new ForbiddenException('Compliance screening does not authorize routing.');
    }

    // Step 4: Exchange Routing — use existing ExchangeRoutingService
    let routingResult: any;
    try {
      routingResult = await this.routingService.route({
        tenantId,
        accountId: intent.accountId,
        symbol: intent.symbol,
        side: intent.side,
        orderType: intent.orderType,
        environment: intent.environment ?? 'PAPER',
      } as any);
    } catch (e) {
      this.logger.warn(`Routing failed for intent ${intentId}: ${(e as Error).message}`);
      await this.lifecycleService.transition({
        tenantId,
        intentId,
        toState: OrderIntentState.FAILED,
        source: 'EXCHANGE_ROUTING',
        reason: `Routing failed: ${(e as Error).message}`,
        correlationId,
      });
      throw new BadRequestException(`Exchange routing failed for intent ${intentId}`);
    }

    // Step 5: Live Safety Gate — existing ExecutionSafetyService
    if (intent.environment === 'LIVE') {
      const safety = await this.safetyService.safetySummary(tenantId);
      if (!safety.wouldTransmitLiveOrder) {
        await this.lifecycleService.transition({
          tenantId,
          intentId,
          toState: OrderIntentState.REJECTED,
          source: 'LIVE_GATE',
          reason: `Live gate BLOCK: ${safety.blockingReasons.join(', ')}`,
          correlationId,
        });
        throw new ForbiddenException(`Live gate BLOCK: ${safety.blockingReasons.join(', ')}`);
      }
    }

    // Step 6: Existing Execution Engine — create canonical Order and hand to worker via queue
    // Never directly call raw exchange REST endpoint here
    await this.lifecycleService.transition({
      tenantId,
      intentId,
      toState: OrderIntentState.SUBMITTED,
      source: 'OMS_ROUTING',
      reason: `Routed to execution engine via ${routingResult?.venue ?? intent.venue ?? 'unknown'} venue`,
      correlationId,
      metadata: { routing: routingResult },
    });

    let canonicalOrderId: string | null = null;
    let enqueueAttempted = false;
    try {
      // Resolve the symbol WITH its trading rules: the engine validates the
      // order against exactly these before any gate runs.
      const symbolRecord = await this.prisma.withTenantRls(tenantId, (tx) => tx.tradingSymbol.findFirst({
        where: { tenantId, symbol: intent.symbol, exchangeId: account!.exchangeId, marketType: account!.marketType },
      }));
      if (!symbolRecord) throw new BadRequestException(`Symbol ${intent.symbol} not found for canonical order creation`);

      const intentMetadata = (intent.metadata ?? {}) as Record<string, unknown>;
      const copyExecutionId = typeof intentMetadata.copyExecutionId === 'string' ? intentMetadata.copyExecutionId : null;

      // Create canonical Order if not exists — existing execution engine remains authoritative
      const canonicalOrder = await this.prisma.withTenantRls(tenantId, async (tx) => {
        const existing = await tx.order.findFirst({ where: { tenantId, clientOrderId: intent.clientOrderId } });
        if (existing) {
          // A client order id is not itself proof that a prior canonical order
          // belongs to this intent and this risk verdict. Never re-enqueue an
          // unrelated, altered, terminal or differently approved order.
          const sameQuantity = new Prisma.Decimal(existing.quantity).equals(new Prisma.Decimal(intent.quantity));
          const samePrice = existing.price === null ? intent.price == null :
            intent.price != null && new Prisma.Decimal(existing.price).equals(new Prisma.Decimal(intent.price));
          if (existing.accountId !== intent.accountId || existing.symbolId !== symbolRecord.id || existing.symbol !== intent.symbol ||
              existing.side !== intent.side || existing.orderType !== intent.orderType || existing.timeInForce !== (intent.timeInForce ?? 'GTC') ||
              existing.strategyId !== (intent.strategyId ?? null) || existing.reduceOnly !== Boolean(intent.reduceOnly) ||
              existing.isSimulated !== ((intent.environment ?? 'PAPER') === 'PAPER') || existing.riskDecisionId !== riskResult.id ||
              existing.status !== 'SUBMITTED' || existing.reconciliationState !== 'IN_SYNC' || !sameQuantity || !samePrice) {
            throw new SubmitOrderRefused('CANONICAL_ORDER_CONFLICT', 'The existing order does not match this approved submission.');
          }
          return existing;
        }
        return tx.order.create({
          data: {
            tenantId,
            accountId: intent.accountId,
            strategyId: intent.strategyId ?? undefined,
            symbolId: symbolRecord.id,
            clientOrderId: intent.clientOrderId,
            venue: (routingResult?.venue ?? intent.venue ?? symbolRecord.exchangeId) as any,
            symbol: intent.symbol,
            side: intent.side as any,
            orderType: intent.orderType as any,
            timeInForce: (intent.timeInForce as any) ?? 'GTC',
            status: 'SUBMITTED' as any,
            quantity: intent.quantity as any,
            price: intent.price as any,
            stopPrice: intent.stopPrice as any,
            reduceOnly: intent.reduceOnly ?? false,
            isSimulated: (intent.environment ?? 'PAPER') === 'PAPER',
            riskDecisionId: riskResult.id ?? undefined,
            submittedAt: new Date(),
            metadata: {
              omsIntentId: intentId,
              correlationId,
              riskDecisionId: riskResult.id,
              source: intent.source,
              ...(copyExecutionId ? { copyExecutionId } : {}),
            } as any,
          },
        });
      });
      canonicalOrderId = canonicalOrder.id;

      // Exposure is read under the same tenant isolation as the intent; a
      // forced-RLS deployment must not mistake hidden positions for zero.
      const positions = await this.prisma.withTenantRls(tenantId, (tx) => tx.position.findMany({
        where: { tenantId, accountId: intent.accountId },
        select: { symbolId: true, quantity: true, markPrice: true },
      }));

      const jobData = buildSubmitOrderJob({
        tenantId,
        accountId: intent.accountId,
        orderId: canonicalOrder.id,
        clientOrderId: intent.clientOrderId,
        symbol: intent.symbol,
        side: intent.side,
        orderType: intent.orderType,
        quantity: intent.quantity,
        price: intent.price,
        timeInForce: intent.timeInForce,
        reduceOnly: intent.reduceOnly,
        strategyId: intent.strategyId,
        riskDecisionId: riskResult.id,
        environment: intent.environment ?? 'PAPER',
        specification: buildSubmitSpecification(symbolRecord as any),
        exposure: computeSubmitExposure(positions as any, symbolRecord.id),
        omsIntentId: intentId,
        metadata: {
          ...(copyExecutionId ? { copyExecutionId } : {}),
          ...(correlationId ? { correlationId: String(correlationId).slice(0, 128) } : {}),
          source: String(intent.source ?? 'OMS'),
        },
        requestedByUserId: userId ?? null,
      });

      // A queue error is ambiguous: the broker may have accepted the job
      // before the connection failed. From this point onward the order must
      // remain unresolved until its client-order ID is reconciled.
      const deterministicJobId = submitOrderJobId(intent.clientOrderId);
      enqueueAttempted = true;
      const enqueued = await this.queueService.enqueueOrThrow(
        QUEUE_NAMES.TRADE_EXECUTION,
        JOB_NAMES.SUBMIT_ORDER,
        jobData,
        { jobId: deterministicJobId, attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
      );
      const jobId = enqueued || deterministicJobId;

      this.logger.log(`Intent ${intentId} submitted to execution engine job ${jobId} tenant ${tenantId} canonicalOrder ${canonicalOrder.id}`);
      return { intentId, jobId, routing: routingResult, riskDecisionId: riskResult.id, canonicalOrderId: canonicalOrder.id };
    } catch (e) {
      const refusal = e instanceof SubmitOrderRefused ? e : null;
      const limitCode = accountOrderSizeLimitCode(e);
      const safeCode = refusal?.code ?? limitCode;
      const safeReason = refusal?.message ?? (limitCode ? 'The account order-size limit does not authorize this order.' : 'Execution submission could not be confirmed.');
      this.logger.warn(`Execution engine submission failed for intent ${intentId}; code ${safeCode ?? 'UNAVAILABLE'}`);
      if (enqueueAttempted && canonicalOrderId) {
        // Do not manufacture a terminal failure or release its exposure: an
        // accepted job may already be executing. A concurrent worker may also
        // have acknowledged or filled the order, so update only an unchanged
        // submitted record and never overwrite a newer observation.
        await this.prisma.withTenantRls(tenantId, (tx) => tx.order.updateMany({
          where: { id: canonicalOrderId!, tenantId, status: 'SUBMITTED', reconciliationState: 'IN_SYNC' },
          data: { reconciliationState: 'UNKNOWN',
            reconciliationDetail: 'Queue acceptance was not confirmed; reconcile the client order before retrying.' },
        })).catch(() => this.logger.warn(`Could not mark order ${canonicalOrderId} for reconciliation`));
        // SUBMITTED remains an unresolved OMS state. Do not race a worker's
        // acknowledgement or fill by attempting a FAILED transition here.
        throw new ServiceUnavailableException('Execution submission could not be confirmed. Check the order before retrying.');
      }
      if (canonicalOrderId) {
        await this.prisma.withTenantRls(tenantId, (tx) => tx.order.update({
          where: { id: canonicalOrderId!, tenantId },
          data: {
            status: (safeCode ? 'REJECTED' : 'FAILED') as any,
            rejectionCode: safeCode ?? 'SUBMISSION_ENQUEUE_FAILED',
            rejectionReason: safeReason.slice(0, 500),
            terminalAt: new Date(),
          },
        })).catch(() => this.logger.warn(`Could not mark order ${canonicalOrderId} failed`));
      }
      await this.lifecycleService.transition({
        tenantId,
        intentId,
        // A conflicting canonical order may already be in flight. FAILED is
        // unresolved; it is the permitted intermediate state before review.
        toState: safeCode && safeCode !== 'CANONICAL_ORDER_CONFLICT' ? OrderIntentState.REJECTED : OrderIntentState.FAILED,
        source: 'EXECUTION_ENGINE',
        reason: `Execution submission ${safeCode ? 'refused' : 'failed'}: ${safeReason}`,
        correlationId,
      });
      if (safeCode === 'CANONICAL_ORDER_CONFLICT') {
        await this.lifecycleService.transition({ tenantId, intentId, toState: OrderIntentState.RECONCILIATION_REQUIRED,
          source: 'EXECUTION_ENGINE', reason: 'Existing canonical order requires reconciliation before retry.', correlationId });
      }
      if (safeCode) throw new ForbiddenException({ code: safeCode, message: safeReason });
      throw new ServiceUnavailableException('Execution submission could not be confirmed. Check the order before retrying.');
    }
  }
}
