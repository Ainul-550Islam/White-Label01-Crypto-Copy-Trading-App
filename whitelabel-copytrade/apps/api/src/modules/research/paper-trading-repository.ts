import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { randomUUID } from 'crypto';

/**
 * Persistence abstraction for paper sessions, paper orders, paper fills, portfolio snapshots, and session lifecycle.
 * Keep paper data separated from live trading data.
 */
@Injectable()
export class PaperTradingRepository {
  private readonly logger = new Logger(PaperTradingRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async createSession(input: {
    tenantId: string;
    strategyVersionId: string;
    sessionIdentifier: string;
    config?: Record<string, any>;
    initialCapital: string;
    symbols?: string[];
    timeframe?: string;
    expiresAt?: Date | null;
    createdBy?: string | null;
    idempotencyKey?: string | null;
  }): Promise<any> {
    if (input.idempotencyKey) {
      const existing = await (this.prisma as any).researchPaperSession.findFirst({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) return existing;
    }

    const existingByIdentifier = await (this.prisma as any).researchPaperSession.findFirst({ where: { tenantId: input.tenantId, sessionIdentifier: input.sessionIdentifier } });
    if (existingByIdentifier) return existingByIdentifier;

    const id = randomUUID();
    const data = {
      id,
      tenantId: input.tenantId,
      strategyVersionId: input.strategyVersionId,
      status: 'CREATED',
      sessionIdentifier: input.sessionIdentifier,
      config: input.config || {},
      initialCapital: input.initialCapital,
      currentEquity: input.initialCapital,
      symbols: input.symbols || [],
      timeframe: input.timeframe || '1m',
      realizedPnl: '0',
      unrealizedPnl: null,
      maxDrawdown: null,
      feesPaid: '0',
      isSimulated: true,
      expiresAt: input.expiresAt || null,
      idempotencyKey: input.idempotencyKey || null,
      createdBy: input.createdBy || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    try {
      const created = await (this.prisma as any).researchPaperSession.create({ data });
      this.logger.log(`Paper session created id=${created.id} tenant=${input.tenantId} identifier=${input.sessionIdentifier}`);
      return created;
    } catch (e: any) {
      if (e.code === 'P2002') {
        const existing = await (this.prisma as any).researchPaperSession.findFirst({ where: { tenantId: input.tenantId, sessionIdentifier: input.sessionIdentifier } });
        if (existing) return existing;
      }
      throw e;
    }
  }

  async findSessionById(id: string, tenantId: string): Promise<any | null> {
    return (this.prisma as any).researchPaperSession.findFirst({ where: { id, tenantId } }) || null;
  }

  async findSessionByIdentifier(tenantId: string, sessionIdentifier: string): Promise<any | null> {
    return (this.prisma as any).researchPaperSession.findFirst({ where: { tenantId, sessionIdentifier } }) || null;
  }

  async listSessions(tenantId: string, filters?: { strategyVersionId?: string; status?: string; page?: number; limit?: number }): Promise<{ data: any[]; total: number }> {
    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    const skip = (page - 1) * limit;
    const where: any = { tenantId, ...(filters?.strategyVersionId ? { strategyVersionId: filters.strategyVersionId } : {}), ...(filters?.status ? { status: filters.status } : {}) };
    const [data, total] = await Promise.all([
      (this.prisma as any).researchPaperSession.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
      (this.prisma as any).researchPaperSession.count({ where }),
    ]);
    return { data, total };
  }

  async updateSessionStatus(id: string, tenantId: string, status: string, extra?: { startedAt?: Date; stoppedAt?: Date; currentEquity?: string; realizedPnl?: string; unrealizedPnl?: string | null; maxDrawdown?: string | null; feesPaid?: string }): Promise<any | null> {
    try {
      return await (this.prisma as any).researchPaperSession.update({ where: { id }, data: { status, ...extra, updatedAt: new Date() } });
    } catch { return null; }
  }

  // Paper Orders - Never write paper orders into live order records
  async createPaperOrder(input: {
    tenantId: string;
    sessionId: string;
    orderId: string;
    clientOrderId: string;
    symbol: string;
    side: string;
    type: string;
    quantity: string;
    price?: string | null;
    stopPrice?: string | null;
    status?: string;
    idempotencyKey?: string | null;
  }): Promise<any> {
    const id = randomUUID();
    const data = {
      id,
      tenantId: input.tenantId,
      sessionId: input.sessionId,
      orderId: input.orderId,
      clientOrderId: input.clientOrderId,
      symbol: input.symbol,
      side: input.side,
      type: input.type,
      status: input.status || 'PENDING',
      quantity: input.quantity,
      price: input.price || null,
      stopPrice: input.stopPrice || null,
      filledQuantity: '0',
      averageFillPrice: null,
      fee: '0',
      isSimulated: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    try {
      const created = await (this.prisma as any).researchPaperOrder.create({ data });
      this.logger.log(`Paper order created id=${created.id} tenant=${input.tenantId} orderId=${input.orderId} PAPER_SIMULATION`);
      return created;
    } catch (e: any) {
      if (e.code === 'P2002') {
        const existing = await (this.prisma as any).researchPaperOrder.findFirst({ where: { tenantId: input.tenantId, orderId: input.orderId } });
        if (existing) return existing;
      }
      throw e;
    }
  }

  async findPaperOrderById(orderId: string, tenantId: string): Promise<any | null> {
    return (this.prisma as any).researchPaperOrder.findFirst({ where: { orderId, tenantId } }) || null;
  }

  async listPaperOrders(tenantId: string, sessionId: string, filters?: { status?: string; page?: number; limit?: number }): Promise<{ data: any[]; total: number }> {
    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    const skip = (page - 1) * limit;
    const where: any = { tenantId, sessionId, ...(filters?.status ? { status: filters.status } : {}) };
    const [data, total] = await Promise.all([
      (this.prisma as any).researchPaperOrder.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
      (this.prisma as any).researchPaperOrder.count({ where }),
    ]);
    return { data, total };
  }

  async updatePaperOrderStatus(orderId: string, tenantId: string, status: string, extra?: { filledQuantity?: string; averageFillPrice?: string | null; fee?: string }): Promise<any | null> {
    try {
      const existing = await (this.prisma as any).researchPaperOrder.findFirst({ where: { orderId, tenantId } });
      if (!existing) return null;
      return await (this.prisma as any).researchPaperOrder.update({ where: { id: existing.id }, data: { status, ...extra, updatedAt: new Date() } });
    } catch { return null; }
  }

  // Paper Fills
  async createPaperFill(input: {
    tenantId: string;
    sessionId: string;
    orderId: string;
    fillId: string;
    tradeId?: string | null;
    symbol: string;
    side: string;
    quantity: string;
    price: string;
    fee?: string;
    isMaker?: boolean;
    timestamp: Date;
  }): Promise<any> {
    const id = randomUUID();
    const data = {
      id,
      tenantId: input.tenantId,
      sessionId: input.sessionId,
      orderId: input.orderId,
      fillId: input.fillId,
      tradeId: input.tradeId || null,
      symbol: input.symbol,
      side: input.side,
      quantity: input.quantity,
      price: input.price,
      fee: input.fee || '0',
      isMaker: input.isMaker || false,
      isSimulated: true,
      timestamp: input.timestamp,
      createdAt: new Date(),
    };

    try {
      const created = await (this.prisma as any).researchPaperFill.create({ data });
      this.logger.log(`Paper fill created tenant=${input.tenantId} fillId=${input.fillId} PAPER_SIMULATION`);
      return created;
    } catch (e: any) {
      if (e.code === 'P2002') {
        const existing = await (this.prisma as any).researchPaperFill.findFirst({ where: { tenantId: input.tenantId, fillId: input.fillId } });
        if (existing) return existing;
      }
      throw e;
    }
  }

  async listPaperFills(tenantId: string, sessionId: string, filters?: { page?: number; limit?: number }): Promise<{ data: any[]; total: number }> {
    const page = filters?.page || 1;
    const limit = filters?.limit || 100;
    const skip = (page - 1) * limit;
    const where: any = { tenantId, sessionId };
    const [data, total] = await Promise.all([
      (this.prisma as any).researchPaperFill.findMany({ where, orderBy: { timestamp: 'asc' }, skip, take: limit }),
      (this.prisma as any).researchPaperFill.count({ where }),
    ]);
    return { data, total };
  }

  // Snapshots
  async createSnapshot(input: { tenantId: string; sessionId: string; sequence: number; timestamp: Date; cash: string; equity: string; realizedPnl?: string; unrealizedPnl?: string | null; drawdown?: string | null }): Promise<any> {
    const id = randomUUID();
    const data = {
      id,
      tenantId: input.tenantId,
      sessionId: input.sessionId,
      sequence: input.sequence,
      timestamp: input.timestamp,
      cash: input.cash,
      equity: input.equity,
      realizedPnl: input.realizedPnl || '0',
      unrealizedPnl: input.unrealizedPnl || null,
      drawdown: input.drawdown || null,
      isSimulated: true,
      createdAt: new Date(),
    };
    try {
      return await (this.prisma as any).researchPaperSnapshot.create({ data });
    } catch (e: any) {
      if (e.code === 'P2002') {
        const existing = await (this.prisma as any).researchPaperSnapshot.findFirst({ where: { sessionId: input.sessionId, sequence: input.sequence } });
        if (existing) return existing;
      }
      throw e;
    }
  }

  async listSnapshots(tenantId: string, sessionId: string): Promise<any[]> {
    return (this.prisma as any).researchPaperSnapshot.findMany({ where: { tenantId, sessionId }, orderBy: { sequence: 'asc' } }) || [];
  }
}
