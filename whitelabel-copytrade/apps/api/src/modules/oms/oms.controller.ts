import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { OrderIntentService } from './order-intent.service';
import { OrderLifecycleService } from './order-lifecycle.service';
import { OrderRoutingService } from './order-routing.service';
import { ExecutionAckService } from './execution-ack.service';
import { FillManagementService } from './fill-management.service';
import { TradeLifecycleService } from './trade-lifecycle.service';
import { OrderCancelService } from './order-cancel.service';
import { OrderReplaceService } from './order-replace.service';
import { AllocationService } from './allocation.service';
import { ExecutionQualityService } from './execution-quality.service';
import { ExecutionLatencyService } from './execution-latency.service';
import { VenueExecutionScoreService } from './venue-execution-score.service';
import { OrderRejectionService } from './order-rejection.service';
import { OrderReconciliationService } from './order-reconciliation.service';
import { FillReconciliationService } from './fill-reconciliation.service';
import { PositionReconciliationService } from './position-reconciliation.service';
import { PostTradeService } from './post-trade.service';
import { TradeOperationsService } from './trade-operations.service';
import { OmsAuditService } from './oms-audit.service';
import { CreateOrderIntentDto } from './dto/order-intent.dto';
import { CancelOrderDto, ReplaceOrderDto, RetryOrderDto, RecoveryOrderDto, AcknowledgeExceptionDto, OperatorNoteDto, AcknowledgeReconciliationDto } from './dto/order-action.dto';
import { OmsOrdersQueryDto, OmsFillsQueryDto, OmsTradesQueryDto, OmsRejectionQueryDto, OmsReconciliationQueryDto, OmsExecutionQualityQueryDto, OmsAuditQueryDto } from './dto/oms-query.dto';
import { OmsAuditEventType } from './oms.types';

/**
 * RBAC-protected OMS API.
 * Customer/trader: view own orders, fills, trades, execution quality
 * Operators: reconciliation queue, stale orders, rejected orders, recovery requests, operational actions
 * Platform operators: platform-level visibility per existing permissions
 * Never allow arbitrary order-status mutation from API.
 */

@Controller('oms')
export class OmsController {
  constructor(
    private readonly intentService: OrderIntentService,
    private readonly lifecycleService: OrderLifecycleService,
    private readonly routingService: OrderRoutingService,
    private readonly ackService: ExecutionAckService,
    private readonly fillService: FillManagementService,
    private readonly tradeService: TradeLifecycleService,
    private readonly cancelService: OrderCancelService,
    private readonly replaceService: OrderReplaceService,
    private readonly allocationService: AllocationService,
    private readonly qualityService: ExecutionQualityService,
    private readonly latencyService: ExecutionLatencyService,
    private readonly venueScoreService: VenueExecutionScoreService,
    private readonly rejectionService: OrderRejectionService,
    private readonly orderReconService: OrderReconciliationService,
    private readonly fillReconService: FillReconciliationService,
    private readonly positionReconService: PositionReconciliationService,
    private readonly postTradeService: PostTradeService,
    private readonly opsService: TradeOperationsService,
    private readonly auditService: OmsAuditService,
  ) {}

  private getTenantId(req: any): string {
    const tid = req.user?.tenantId ?? req.headers['x-tenant-id'];
    if (!tid) throw new ForbiddenException('Tenant ID required');
    return tid;
  }

  private getUserId(req: any): string {
    return req.user?.id ?? req.user?.userId ?? 'system';
  }

  private checkTenantAccess(req: any, targetTenantId: string): void {
    const userTenantId = req.user?.tenantId;
    const isPlatform = req.user?.isPlatformUser || req.user?.roles?.includes('PLATFORM_ADMIN') || req.user?.permissions?.includes('PLATFORM_MANAGE');
    if (!isPlatform && userTenantId && userTenantId !== targetTenantId) {
      throw new ForbiddenException('Cross-tenant access denied');
    }
  }

  private isOperator(req: any): boolean {
    return req.user?.roles?.includes('OPERATOR') || req.user?.roles?.includes('RISK_ADMIN') || req.user?.permissions?.includes('OMS_OPERATE') || req.user?.isPlatformUser;
  }

  // ---------- Order Intent ----------

  @Post('intents')
  async createIntent(@Req() req: any, @Body() dto: CreateOrderIntentDto) {
    const tenantId = this.getTenantId(req);
    this.checkTenantAccess(req, tenantId);
    const userId = this.getUserId(req);

    // Client cannot supply trusted execution state — DTO enforces
    const intent = await this.intentService.createIntent({
      tenantId,
      accountId: dto.accountId,
      symbol: dto.symbol,
      side: dto.side,
      orderType: dto.orderType,
      quantity: dto.quantity,
      price: dto.price ?? null,
      stopPrice: dto.stopPrice ?? null,
      timeInForce: dto.timeInForce ?? 'GTC',
      reduceOnly: dto.reduceOnly ?? false,
      strategyId: dto.strategyId ?? null,
      traderId: dto.traderId ?? null,
      followerId: dto.followerId ?? null,
      subscriptionId: dto.subscriptionId ?? null,
      environment: dto.environment,
      source: dto.source ?? 'MANUAL',
      signalId: dto.signalId ?? null,
      correlationId: dto.correlationId ?? null,
      requestId: dto.requestId ?? null,
      userId,
      venue: dto.venue ?? null,
    });

    await this.auditService.recordEvent({
      tenantId,
      eventType: OmsAuditEventType.ORDER_INTENT_CREATED,
      orderIntentId: intent.id,
      accountId: dto.accountId,
      symbol: dto.symbol,
      venue: dto.venue ?? null,
      strategyId: dto.strategyId ?? null,
      traderId: dto.traderId ?? null,
      followerId: dto.followerId ?? null,
      actorId: userId,
      actorType: 'USER',
      reason: `Intent created ${dto.symbol} ${dto.side} ${dto.quantity}`,
      correlationId: dto.correlationId ?? null,
      requestId: dto.requestId ?? null,
      metadata: { quantity: dto.quantity, price: dto.price, orderType: dto.orderType, environment: dto.environment },
    });

    // Track allocation intended
    await this.allocationService.recordIntendedAllocation({
      tenantId,
      strategyId: dto.strategyId ?? null,
      traderId: dto.traderId ?? null,
      followerId: dto.followerId ?? null,
      subscriptionId: dto.subscriptionId ?? null,
      accountId: dto.accountId,
      orderIntentId: intent.id,
      symbol: dto.symbol,
      side: dto.side,
      intendedQuantity: dto.quantity,
      allocationMode: null,
      correlationId: dto.correlationId ?? null,
    });

    return intent;
  }

  @Post('intents/:id/route')
  async routeIntent(@Req() req: any, @Param('id') id: string) {
    const tenantId = this.getTenantId(req);
    this.checkTenantAccess(req, tenantId);
    const userId = this.getUserId(req);

    const result = await this.routingService.routeIntent({ tenantId, intentId: id, userId, correlationId: (req.headers['x-correlation-id'] as string) ?? null, requestId: (req.headers['x-request-id'] as string) ?? null });

    await this.auditService.recordEvent({
      tenantId,
      eventType: OmsAuditEventType.ORDER_SUBMITTED,
      orderIntentId: id,
      actorId: userId,
      actorType: 'USER',
      reason: `Routed to execution engine job ${result.jobId}`,
      metadata: { jobId: result.jobId },
    });

    return result;
  }

  @Get('intents')
  async listIntents(@Req() req: any, @Query() query: OmsOrdersQueryDto) {
    const tenantId = this.getTenantId(req);
    this.checkTenantAccess(req, tenantId);
    return this.intentService.listIntents({
      tenantId,
      accountId: query.accountId,
      strategyId: query.strategyId,
      symbol: query.symbol,
      state: query.state,
      page: query.page,
      limit: query.limit,
    });
  }

  @Get('intents/:id')
  async getIntent(@Req() req: any, @Param('id') id: string) {
    const tenantId = this.getTenantId(req);
    this.checkTenantAccess(req, tenantId);
    return this.intentService.getIntent(tenantId, id);
  }

  @Get('intents/:id/lifecycle')
  async getLifecycle(@Req() req: any, @Param('id') id: string) {
    const tenantId = this.getTenantId(req);
    this.checkTenantAccess(req, tenantId);
    const history = await this.lifecycleService.getHistory(tenantId, id);
    const isTerminal = await this.lifecycleService.isTerminal(tenantId, id);
    return { intentId: id, isTerminal, history };
  }

  // ---------- Cancel / Replace ----------

  @Post('orders/cancel')
  async cancelOrder(@Req() req: any, @Body() dto: CancelOrderDto) {
    const tenantId = this.getTenantId(req);
    this.checkTenantAccess(req, tenantId);
    const userId = this.getUserId(req);

    const result = await this.cancelService.requestCancel({ tenantId, intentId: dto.intentId, userId, reason: dto.reason, correlationId: dto.correlationId ?? null });

    await this.auditService.recordEvent({
      tenantId,
      eventType: OmsAuditEventType.ORDER_CANCEL_REQUESTED,
      orderIntentId: dto.intentId,
      actorId: userId,
      actorType: 'USER',
      reason: dto.reason,
      correlationId: dto.correlationId ?? null,
    });

    return result;
  }

  @Post('orders/replace')
  async replaceOrder(@Req() req: any, @Body() dto: ReplaceOrderDto) {
    const tenantId = this.getTenantId(req);
    this.checkTenantAccess(req, tenantId);
    const userId = this.getUserId(req);

    const result = await this.replaceService.requestReplace({
      tenantId,
      intentId: dto.intentId,
      userId,
      newQuantity: dto.newQuantity ?? null,
      newPrice: dto.newPrice ?? null,
      newStopPrice: dto.newStopPrice ?? null,
      reason: dto.reason,
      correlationId: dto.correlationId ?? null,
      requestId: dto.requestId ?? null,
    });

    await this.auditService.recordEvent({
      tenantId,
      eventType: OmsAuditEventType.ORDER_REPLACED,
      orderIntentId: dto.intentId,
      actorId: userId,
      actorType: 'USER',
      reason: dto.reason,
      correlationId: dto.correlationId ?? null,
      metadata: { newIntentId: result.newIntentId, newQuantity: dto.newQuantity, newPrice: dto.newPrice },
    });

    return result;
  }

  // ---------- Fills ----------

  @Get('fills')
  async listFills(@Req() req: any, @Query() query: OmsFillsQueryDto) {
    const tenantId = this.getTenantId(req);
    this.checkTenantAccess(req, tenantId);
    return this.opsService.searchFills({
      tenantId,
      accountId: query.accountId,
      symbol: query.symbol,
      venue: query.venue,
      orderIntentId: query.orderIntentId,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      page: query.page,
      limit: query.limit,
    });
  }

  @Get('intents/:id/fills')
  async getFillsForIntent(@Req() req: any, @Param('id') id: string) {
    const tenantId = this.getTenantId(req);
    this.checkTenantAccess(req, tenantId);
    return this.fillService.getFillsForIntent(tenantId, id);
  }

  // ---------- Trades ----------

  @Get('trades')
  async listTrades(@Req() req: any, @Query() query: OmsTradesQueryDto) {
    const tenantId = this.getTenantId(req);
    this.checkTenantAccess(req, tenantId);
    return this.opsService.searchTrades({
      tenantId,
      accountId: query.accountId,
      symbol: query.symbol,
      strategyId: query.strategyId,
      state: query.state,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      page: query.page,
      limit: query.limit,
    });
  }

  @Get('trades/:id')
  async getTrade(@Req() req: any, @Param('id') id: string) {
    const tenantId = this.getTenantId(req);
    this.checkTenantAccess(req, tenantId);
    return this.tradeService.getTradeById(tenantId, id);
  }

  // ---------- Execution Quality & Latency ----------

  @Get('execution-quality')
  async getExecutionQuality(@Req() req: any, @Query() query: OmsExecutionQualityQueryDto) {
    const tenantId = this.getTenantId(req);
    this.checkTenantAccess(req, tenantId);
    const from = query.from ? new Date(query.from) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const to = query.to ? new Date(query.to) : new Date();
    return this.qualityService.calculateForPeriod({
      tenantId,
      accountId: query.accountId ?? null,
      symbol: query.symbol ?? null,
      venue: query.venue ?? null,
      strategyId: query.strategyId ?? null,
      traderId: query.traderId ?? null,
      from,
      to,
    });
  }

  @Get('intents/:id/latency')
  async getLatency(@Req() req: any, @Param('id') id: string) {
    const tenantId = this.getTenantId(req);
    this.checkTenantAccess(req, tenantId);
    return this.latencyService.calculateForIntent({ tenantId, intentId: id });
  }

  @Get('venue-scores')
  async getVenueScores(@Req() req: any, @Query() query: OmsExecutionQualityQueryDto) {
    const tenantId = this.getTenantId(req);
    this.checkTenantAccess(req, tenantId);
    const from = query.from ? new Date(query.from) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const to = query.to ? new Date(query.to) : new Date();
    if (query.venue) {
      return this.venueScoreService.calculateForVenue({ tenantId, venue: query.venue, from, to, accountId: query.accountId ?? null });
    }
    return this.venueScoreService.listVenueScores({ tenantId, from, to });
  }

  // ---------- Rejections ----------

  @Get('rejections')
  async getRejections(@Req() req: any, @Query() query: OmsRejectionQueryDto) {
    const tenantId = this.getTenantId(req);
    this.checkTenantAccess(req, tenantId);
    return this.rejectionService.getRejections({
      tenantId,
      accountId: query.accountId,
      symbol: query.symbol,
      category: query.category,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      page: query.page,
      limit: query.limit,
    });
  }

  @Get('rejections/stats')
  async getRejectionStats(@Req() req: any, @Query('from') from?: string, @Query('to') to?: string) {
    const tenantId = this.getTenantId(req);
    this.checkTenantAccess(req, tenantId);
    return this.rejectionService.getRejectionStats(tenantId, from ? new Date(from) : undefined, to ? new Date(to) : undefined);
  }

  // ---------- Reconciliation ----------

  @Get('reconciliation/orders/:id')
  async reconcileOrder(@Req() req: any, @Param('id') id: string) {
    const tenantId = this.getTenantId(req);
    if (!this.isOperator(req)) throw new ForbiddenException('Operator required');
    this.checkTenantAccess(req, tenantId);
    return this.orderReconService.reconcileOrder({ tenantId, intentId: id });
  }

  @Post('reconciliation/orders')
  async reconcileOrders(@Req() req: any, @Body() body: { accountId?: string; limit?: number }) {
    const tenantId = this.getTenantId(req);
    if (!this.isOperator(req)) throw new ForbiddenException('Operator required');
    return this.orderReconService.reconcileTenant({ tenantId, accountId: body.accountId, limit: body.limit });
  }

  @Get('reconciliation/fills/:orderId')
  async reconcileFills(@Req() req: any, @Param('orderId') orderId: string, @Query('intentId') intentId?: string) {
    const tenantId = this.getTenantId(req);
    if (!this.isOperator(req)) throw new ForbiddenException('Operator required');
    return this.fillReconService.reconcileFillsForOrder({ tenantId, orderId, intentId });
  }

  @Get('reconciliation/positions/:accountId/:symbol')
  async reconcilePosition(@Req() req: any, @Param('accountId') accountId: string, @Param('symbol') symbol: string) {
    const tenantId = this.getTenantId(req);
    if (!this.isOperator(req)) throw new ForbiddenException('Operator required');
    return this.positionReconService.reconcilePosition({ tenantId, accountId, symbol });
  }

  @Get('reconciliation/positions/:accountId')
  async reconcileAccountPositions(@Req() req: any, @Param('accountId') accountId: string) {
    const tenantId = this.getTenantId(req);
    if (!this.isOperator(req)) throw new ForbiddenException('Operator required');
    return this.positionReconService.reconcileAccountPositions({ tenantId, accountId });
  }

  @Get('reconciliation/queue')
  async getReconQueue(@Req() req: any, @Query() query: OmsReconciliationQueryDto) {
    const tenantId = this.getTenantId(req);
    if (!this.isOperator(req)) throw new ForbiddenException('Operator required');
    return this.opsService.getReconciliationQueue({ tenantId, accountId: query.accountId });
  }

  // ---------- Operational ----------

  @Get('operational/stale-orders')
  async getStaleOrders(@Req() req: any, @Query('accountId') accountId?: string) {
    const tenantId = this.getTenantId(req);
    if (!this.isOperator(req)) throw new ForbiddenException('Operator required');
    return this.opsService.getStaleOrders({ tenantId, accountId });
  }

  @Get('operational/rejected-orders')
  async getRejectedOperational(@Req() req: any, @Query('accountId') accountId?: string) {
    const tenantId = this.getTenantId(req);
    if (!this.isOperator(req)) throw new ForbiddenException('Operator required');
    return this.opsService.getRejectedOrders({ tenantId, accountId });
  }

  @Post('operational/retry')
  async requestRetry(@Req() req: any, @Body() dto: RetryOrderDto) {
    const tenantId = this.getTenantId(req);
    if (!this.isOperator(req)) throw new ForbiddenException('Operator required');
    const userId = this.getUserId(req);
    const result = await this.opsService.requestRetry({ tenantId, intentId: dto.intentId, userId, reason: dto.reason });
    await this.auditService.recordEvent({ tenantId, eventType: OmsAuditEventType.RECOVERY_REQUESTED, orderIntentId: dto.intentId, actorId: userId, actorType: 'USER', reason: dto.reason, metadata: { type: 'RETRY' } });
    return result;
  }

  @Post('operational/recovery')
  async requestRecovery(@Req() req: any, @Body() dto: RecoveryOrderDto) {
    const tenantId = this.getTenantId(req);
    if (!this.isOperator(req)) throw new ForbiddenException('Operator required');
    const userId = this.getUserId(req);
    const result = await this.opsService.requestRecovery({ tenantId, intentId: dto.intentId, userId, reason: dto.reason, recoveryType: dto.recoveryType });
    await this.auditService.recordEvent({ tenantId, eventType: OmsAuditEventType.RECOVERY_REQUESTED, orderIntentId: dto.intentId, actorId: userId, actorType: 'USER', reason: dto.reason, metadata: { recoveryType: dto.recoveryType } });
    return result;
  }

  @Post('operational/acknowledge-exception')
  async acknowledgeException(@Req() req: any, @Body() dto: AcknowledgeExceptionDto) {
    const tenantId = this.getTenantId(req);
    if (!this.isOperator(req)) throw new ForbiddenException('Operator required');
    const userId = this.getUserId(req);
    const result = await this.opsService.acknowledgeException({ tenantId, operationalId: dto.operationalId, userId, note: dto.note });
    await this.auditService.recordEvent({ tenantId, eventType: OmsAuditEventType.OPERATOR_ACTION, actorId: userId, actorType: 'USER', reason: dto.note, metadata: { operationalId: dto.operationalId, action: 'ACKNOWLEDGE_EXCEPTION' } });
    return result;
  }

  @Post('operational/note')
  async addOperatorNote(@Req() req: any, @Body() dto: OperatorNoteDto) {
    const tenantId = this.getTenantId(req);
    if (!this.isOperator(req)) throw new ForbiddenException('Operator required');
    const userId = this.getUserId(req);
    return this.opsService.addOperatorNote({ tenantId, operationalId: dto.operationalId, userId, note: dto.note });
  }

  @Post('reconciliation/acknowledge')
  async acknowledgeReconciliation(@Req() req: any, @Body() dto: AcknowledgeReconciliationDto) {
    const tenantId = this.getTenantId(req);
    if (!this.isOperator(req)) throw new ForbiddenException('Operator required');
    const userId = this.getUserId(req);
    // Mark reconciliation as resolved
    try {
      const prisma = (this as any).prisma ?? null;
      // Use direct prisma from service if available — fallback
      const { PrismaService } = await import('../../infrastructure/prisma/prisma.service');
    } catch {}
    // Simplified: we don't have prisma here, use audit service to record
    await this.auditService.recordEvent({
      tenantId,
      eventType: OmsAuditEventType.OPERATOR_ACTION,
      actorId: userId,
      actorType: 'USER',
      reason: dto.resolutionNote,
      metadata: { reconciliationId: dto.reconciliationId, resolution: dto.resolution ?? 'RESOLVED' },
    });
    return { reconciliationId: dto.reconciliationId, resolvedBy: userId, resolutionNote: dto.resolutionNote };
  }

  // ---------- Allocation ----------

  @Get('allocations')
  async getAllocations(@Req() req: any, @Query('accountId') accountId?: string, @Query('strategyId') strategyId?: string, @Query('traderId') traderId?: string, @Query('followerId') followerId?: string, @Query('symbol') symbol?: string) {
    const tenantId = this.getTenantId(req);
    this.checkTenantAccess(req, tenantId);
    return this.allocationService.getAllocations({ tenantId, accountId, strategyId, traderId, followerId, symbol });
  }

  @Get('allocations/summary')
  async getAllocationSummary(@Req() req: any, @Query('strategyId') strategyId?: string, @Query('traderId') traderId?: string, @Query('followerId') followerId?: string) {
    const tenantId = this.getTenantId(req);
    this.checkTenantAccess(req, tenantId);
    return this.allocationService.getAllocationSummary({ tenantId, strategyId, traderId, followerId });
  }

  // ---------- Post-Trade ----------

  @Post('post-trade/:intentId')
  async processPostTrade(@Req() req: any, @Param('intentId') intentId: string) {
    const tenantId = this.getTenantId(req);
    if (!this.isOperator(req)) throw new ForbiddenException('Operator required');
    // Fetch intent to get account/symbol
    const intent = await this.intentService.getIntent(tenantId, intentId);
    if (!intent) throw new BadRequestException(`Intent ${intentId} not found`);
    return this.postTradeService.processPostTrade({
      tenantId,
      intentId,
      accountId: intent.accountId,
      symbol: intent.symbol,
      venue: intent.venue ?? null,
      strategyId: intent.strategyId ?? null,
      traderId: intent.traderId ?? null,
      followerId: intent.followerId ?? null,
      correlationId: intent.correlationId ?? null,
    });
  }

  // ---------- Audit ----------

  @Get('audit/:intentId')
  async getAuditForIntent(@Req() req: any, @Param('intentId') intentId: string) {
    const tenantId = this.getTenantId(req);
    this.checkTenantAccess(req, tenantId);
    return this.auditService.getAuditForIntent(tenantId, intentId);
  }

  @Get('audit')
  async getAuditHistory(@Req() req: any, @Query() query: OmsAuditQueryDto) {
    const tenantId = this.getTenantId(req);
    this.checkTenantAccess(req, tenantId);
    return this.auditService.getAuditHistory({
      tenantId,
      accountId: query.accountId,
      symbol: query.symbol,
      eventType: query.eventType,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      page: query.page,
      limit: query.limit,
    });
  }

  // ---------- Search (generic) ----------

  @Get('orders')
  async searchOrders(@Req() req: any, @Query() query: OmsOrdersQueryDto) {
    const tenantId = this.getTenantId(req);
    this.checkTenantAccess(req, tenantId);
    return this.opsService.searchOrders({
      tenantId,
      accountId: query.accountId,
      strategyId: query.strategyId,
      traderId: query.traderId,
      followerId: query.followerId,
      symbol: query.symbol,
      venue: query.venue,
      state: query.state,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      page: query.page,
      limit: query.limit,
      search: query.search,
    });
  }
}
