import { Injectable, Logger, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OrderIntentService } from './order-intent.service';
import { OrderLifecycleService } from './order-lifecycle.service';
import { RiskDecisionService } from '../risk-management/risk-decision.service';
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
      intent = await (this.prisma as any).omsOrderIntent.findFirst({ where: { id: intentId, tenantId } });
    } catch {
      intent = await this.prisma.order.findFirst({ where: { id: intentId, tenantId } });
    }
    if (!intent) throw new BadRequestException(`Intent ${intentId} not found`);

    const currentState = intent.state ?? intent.status;
    if (currentState !== OrderIntentState.APPROVED && currentState !== OrderIntentState.CREATED && currentState !== OrderIntentState.VALIDATING) {
      throw new BadRequestException(`Intent ${intentId} not in routable state, current ${currentState}`);
    }

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

    // Step 2: Final Risk Check — must not trust client-supplied risk approval
    const riskResult = await this.riskDecisionService.evaluateUnifiedRisk({
      tenantId,
      userId: userId ?? null,
      accountId: intent.accountId,
      symbol: intent.symbol,
      traderId: intent.traderId as any,
      followerId: intent.followerId as any,
      strategyId: intent.strategyId as any,
      orderIntent: { side: intent.side, quantity: intent.quantity?.toString() ?? intent.quantity, price: intent.price?.toString() ?? intent.price ?? null, orderType: intent.orderType } as any,
      environment: intent.environment ?? 'PAPER',
      requestId: requestId as any,
    } as any);

    if (riskResult.decision === 'BLOCK' || riskResult.decision === 'KILL_SWITCH_REQUIRED') {
      await this.lifecycleService.transition({
        tenantId,
        intentId,
        toState: OrderIntentState.REJECTED,
        source: 'RISK',
        reason: `Risk blocked: ${riskResult.blockingReasons.join(', ')}`,
        correlationId,
        policyVersion: riskResult.policyVersion,
      });
      throw new ForbiddenException(`Risk blocked routing for intent ${intentId}: ${riskResult.blockingReasons.join(', ')}`);
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

    // Step 3: Compliance Check
    const complianceBlocked = await this.prisma.complianceScreeningRequest.findFirst({
      where: { tenantId, userId: userId ?? undefined, status: { in: ['BLOCKED', 'REVIEW_REQUIRED'] as any } },
      orderBy: { createdAt: 'desc' },
    });
    if (complianceBlocked && complianceBlocked.decision === 'BLOCK') {
      await this.lifecycleService.transition({
        tenantId,
        intentId,
        toState: OrderIntentState.REJECTED,
        source: 'COMPLIANCE',
        reason: `Compliance BLOCK: ${complianceBlocked.id}`,
        correlationId,
      });
      throw new ForbiddenException(`Compliance BLOCK prevents routing for intent ${intentId}`);
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
    try {
      // Resolve the symbol WITH its trading rules: the engine validates the
      // order against exactly these before any gate runs.
      const symbolRecord = await this.prisma.tradingSymbol.findFirst({ where: { tenantId, symbol: intent.symbol } });
      if (!symbolRecord) throw new BadRequestException(`Symbol ${intent.symbol} not found for canonical order creation`);

      const intentMetadata = (intent.metadata ?? {}) as Record<string, unknown>;
      const copyExecutionId = typeof intentMetadata.copyExecutionId === 'string' ? intentMetadata.copyExecutionId : null;

      // Create canonical Order if not exists — existing execution engine remains authoritative
      let canonicalOrder = await this.prisma.order.findFirst({ where: { tenantId, clientOrderId: intent.clientOrderId } });
      if (!canonicalOrder) {
        canonicalOrder = await this.prisma.order.create({
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
            isSimulated: intent.environment === 'PAPER',
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
      }
      canonicalOrderId = canonicalOrder.id;

      // Exposure from the canonical ledger; incomplete marks make the engine refuse.
      const positions = await this.prisma.position.findMany({
        where: { tenantId, accountId: intent.accountId },
        select: { symbolId: true, quantity: true, markPrice: true },
      });

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

      // Enqueue to trade-execution under the job name the worker actually
      // consumes (JOB_NAMES.SUBMIT_ORDER). A failed enqueue is a FAILED
      // submission, not a silent success: nothing else would ever pick the
      // order up, so swallowing the error here would strand it in SUBMITTED.
      const deterministicJobId = submitOrderJobId(intent.clientOrderId);
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
      this.logger.warn(`Execution engine submission failed for intent ${intentId}: ${(e as Error).message}`);
      if (canonicalOrderId) {
        await this.prisma.order
          .update({
            where: { id: canonicalOrderId },
            data: {
              status: (refusal ? 'REJECTED' : 'FAILED') as any,
              rejectionCode: refusal ? refusal.code : 'SUBMISSION_ENQUEUE_FAILED',
              rejectionReason: (e as Error).message.slice(0, 500),
              terminalAt: new Date(),
            },
          })
          .catch((updateErr: Error) => this.logger.warn(`Could not mark order ${canonicalOrderId} failed: ${updateErr.message}`));
      }
      await this.lifecycleService.transition({
        tenantId,
        intentId,
        toState: refusal ? OrderIntentState.REJECTED : OrderIntentState.FAILED,
        source: 'EXECUTION_ENGINE',
        reason: `Execution submission ${refusal ? 'refused' : 'failed'}: ${(e as Error).message}`,
        correlationId,
      });
      if (refusal) throw new ForbiddenException(`${refusal.code}: ${refusal.message}`);
      throw e;
    }
  }
}
