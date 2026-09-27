import { Injectable, Logger } from '@nestjs/common';
import { PaperTradingRepository } from './paper-trading-repository';
import { ResearchRepository } from './research-repository';
import { BacktestExecutionModelService } from './backtest-execution-model.service';
import { randomUUID } from 'crypto';

/**
 * Creates and advances paper orders/fills with deterministic simulation state and isolated paper-trading persistence.
 * Never write paper orders into live order records.
 */
@Injectable()
export class PaperOrderService {
  private readonly logger = new Logger(PaperOrderService.name);

  constructor(
    private readonly paperRepo: PaperTradingRepository,
    private readonly researchRepo: ResearchRepository,
    private readonly executionModel: BacktestExecutionModelService,
  ) {}

  async createPaperOrder(input: {
    tenantId: string;
    sessionId: string;
    symbol: string;
    side: 'BUY' | 'SELL';
    type: 'MARKET' | 'LIMIT' | 'STOP' | 'STOP_LIMIT';
    quantity: string;
    price?: string | null;
    stopPrice?: string | null;
    createdBy?: string | null;
    idempotencyKey?: string | null;
  }): Promise<any> {
    const session = await this.paperRepo.findSessionById(input.sessionId, input.tenantId);
    if (!session) throw new Error(`Paper session ${input.sessionId} not found`);
    if (session.status !== 'RUNNING') throw new Error(`Paper session must be RUNNING to create orders, current=${session.status}`);

    if (!/^-?\d+(\.\d+)?$/.test(input.quantity)) throw new Error('quantity must be valid decimal string');
    if (parseFloat(input.quantity) <= 0) throw new Error('quantity must be positive');

    if (input.type !== 'MARKET' && input.price && !/^-?\d+(\.\d+)?$/.test(input.price)) throw new Error('price must be valid decimal string');

    const orderId = `paper_order_${randomUUID().substring(0,12)}_${Date.now()}`;
    const clientOrderId = `paper_client_${randomUUID().substring(0,12)}_${Date.now()}`;

    const order = await this.paperRepo.createPaperOrder({
      tenantId: input.tenantId,
      sessionId: input.sessionId,
      orderId,
      clientOrderId,
      symbol: input.symbol,
      side: input.side,
      type: input.type,
      quantity: input.quantity,
      price: input.price || null,
      stopPrice: input.stopPrice || null,
      status: 'PENDING',
      idempotencyKey: input.idempotencyKey || null,
    });

    this.logger.log(`Paper order created tenant=${input.tenantId} session=${input.sessionId} orderId=${orderId} PAPER_SIMULATION`);

    return order;
  }

  async simulateFill(input: {
    tenantId: string;
    sessionId: string;
    orderId: string;
    marketPrice: string;
    timestamp?: Date;
  }): Promise<any | null> {
    const order = await this.paperRepo.findPaperOrderById(input.orderId, input.tenantId);
    if (!order) throw new Error(`Paper order ${input.orderId} not found`);
    if (order.sessionId !== input.sessionId) throw new Error('Order does not belong to session');

    if (['FILLED','CANCELLED','REJECTED','EXPIRED'].includes(order.status)) throw new Error(`Order already ${order.status}`);

    const symbolMeta = await this.executionModel.getSymbolMetadata(input.tenantId, order.symbol);

    // Use execution model to simulate fill
    const executionResult = await this.executionModel.simulateOrderExecution({
      tenantId: input.tenantId,
      order: {
        orderId: order.orderId,
        clientOrderId: order.clientOrderId,
        symbol: order.symbol,
        side: order.side,
        type: order.type,
        quantity: order.quantity,
        price: order.price,
        stopPrice: order.stopPrice,
        timestamp: new Date().toISOString(),
        status: 'PENDING',
      },
      candle: {
        open: input.marketPrice,
        high: input.marketPrice,
        low: input.marketPrice,
        close: input.marketPrice,
        openTime: new Date().toISOString(),
        closeTime: new Date().toISOString(),
      },
      assumptions: {
        fee: { makerFeeRate: '0.001', takerFeeRate: '0.001' },
        slippage: { slippageBps: 5, slippageModel: 'FIXED' },
        latency: { latencyMs: 100 },
        execution: { type: 'MARKET', partialFills: true, minQuantity: null, tickSize: null, quantityStep: null, minNotional: null },
      },
      symbolMetadata: symbolMeta,
    });

    if (executionResult.rejected) {
      await this.paperRepo.updatePaperOrderStatus(order.orderId, input.tenantId, 'REJECTED');
      return null;
    }

    if (!executionResult.fill) return null;

    // Create fill in paper fill table - never live order/fill records
    const fill = await this.paperRepo.createPaperFill({
      tenantId: input.tenantId,
      sessionId: input.sessionId,
      orderId: order.orderId,
      fillId: executionResult.fill.fillId,
      tradeId: `trade_${randomUUID().substring(0,8)}`,
      symbol: order.symbol,
      side: order.side,
      quantity: executionResult.fill.quantity,
      price: executionResult.fill.price,
      fee: executionResult.fill.fee,
      isMaker: executionResult.fill.isMaker,
      timestamp: input.timestamp || new Date(),
    });

    // Update order as filled
    await this.paperRepo.updatePaperOrderStatus(order.orderId, input.tenantId, 'FILLED', {
      filledQuantity: executionResult.fill.quantity,
      averageFillPrice: executionResult.fill.price,
      fee: executionResult.fill.fee,
    });

    // Update session equity - simplified
    try {
      const session = await this.paperRepo.findSessionById(input.sessionId, input.tenantId);
      if (session) {
        const currentEquity = parseFloat(session.currentEquity || session.initialCapital);
        const fee = parseFloat(executionResult.fill.fee);
        // Simplified: just subtract fee for now
        const newEquity = (currentEquity - fee).toString();
        await this.paperRepo.updateSessionStatus(session.id, input.tenantId, session.status, { currentEquity: newEquity, feesPaid: (parseFloat(session.feesPaid) + fee).toString() });
      }
    } catch {}

    this.logger.log(`Paper order filled tenant=${input.tenantId} orderId=${order.orderId} fillId=${fill.fillId} price=${executionResult.fill.price} PAPER_SIMULATION`);

    return fill;
  }

  async cancelOrder(tenantId: string, sessionId: string, orderId: string): Promise<any | null> {
    const order = await this.paperRepo.findPaperOrderById(orderId, tenantId);
    if (!order) return null;
    if (order.sessionId !== sessionId) throw new Error('Order does not belong to session');
    if (['FILLED','CANCELLED','REJECTED'].includes(order.status)) throw new Error(`Order already ${order.status}`);

    return this.paperRepo.updatePaperOrderStatus(orderId, tenantId, 'CANCELLED');
  }

  async listOrders(tenantId: string, sessionId: string, filters?: { status?: string; page?: number; limit?: number }): Promise<{ data: any[]; total: number }> {
    return this.paperRepo.listPaperOrders(tenantId, sessionId, filters);
  }
}
