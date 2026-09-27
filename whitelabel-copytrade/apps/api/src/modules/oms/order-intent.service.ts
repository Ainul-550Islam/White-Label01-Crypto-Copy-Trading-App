import { Injectable, Logger, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RiskDecisionService } from '../risk-management/risk-decision.service';
import { OrderIntentState, isValidDecimal, parseScaled } from './oms.types';
import { randomUUID } from 'crypto';

/**
 * Order Intent Service — creates/validates normalized order intents from strategy/copy/risk-approved requests
 * without placing orders directly.
 *
 * Before creating an intent verify:
 * - strategy state, account state, symbol, quantity/price precision, risk decision, compliance, security, exchange capability, env, live gate
 * MUST NOT place order.
 */

@Injectable()
export class OrderIntentService {
  private readonly logger = new Logger(OrderIntentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly riskDecisionService: RiskDecisionService,
  ) {}

  private async validateAccountOwnership(params: { tenantId: string; accountId: string; userId?: string | null }) {
    const account = await this.prisma.tradingAccount.findFirst({
      where: { id: params.accountId, tenantId: params.tenantId },
    });
    if (!account) throw new ForbiddenException(`Account ${params.accountId} not found for tenant ${params.tenantId}`);
    if (account.status === 'DISABLED') throw new BadRequestException(`Account ${params.accountId} is DISABLED`);
    if (account.status === 'CREDENTIALS_INVALID') throw new BadRequestException(`Account credentials invalid`);
    return account;
  }

  private async validateSymbol(params: { tenantId: string; symbol: string; venue?: string | null }) {
    // Check trading symbol exists and is tradeable
    const symbolRecord = await this.prisma.tradingSymbol.findFirst({
      where: {
        tenantId: params.tenantId,
        symbol: params.symbol,
        isTradeable: true,
        ...(params.venue ? { exchange: { venue: params.venue as any } } : {}),
      },
      include: { exchange: true },
    });
    if (!symbolRecord) throw new BadRequestException(`Symbol ${params.symbol} not tradeable for tenant ${params.tenantId}`);
    return symbolRecord;
  }

  private validatePrecision(params: { quantity: string; price?: string | null; symbol: any }) {
    if (!isValidDecimal(params.quantity)) throw new BadRequestException(`Invalid quantity decimal: ${params.quantity}`);
    const qty = parseScaled(params.quantity);
    if (qty <= 0n) throw new BadRequestException('Quantity must be > 0');

    const minQty = params.symbol.minQuantity ? parseScaled(params.symbol.minQuantity.toString()) : 0n;
    if (qty < minQty) throw new BadRequestException(`Quantity ${params.quantity} below min ${params.symbol.minQuantity}`);

    if (params.symbol.maxQuantity) {
      const maxQty = parseScaled(params.symbol.maxQuantity.toString());
      if (qty > maxQty) throw new BadRequestException(`Quantity ${params.quantity} above max ${params.symbol.maxQuantity}`);
    }

    if (params.price) {
      if (!isValidDecimal(params.price)) throw new BadRequestException(`Invalid price decimal: ${params.price}`);
      const price = parseScaled(params.price);
      if (price <= 0n) throw new BadRequestException('Price must be > 0');
    }
  }

  private async checkStrategyState(params: { tenantId: string; strategyId?: string | null }) {
    if (!params.strategyId) return null;
    const strategy = await this.prisma.strategy.findFirst({
      where: { id: params.strategyId, tenantId: params.tenantId },
    });
    if (!strategy) throw new BadRequestException(`Strategy ${params.strategyId} not found`);
    if (strategy.status === 'DISABLED') throw new BadRequestException(`Strategy ${params.strategyId} DISABLED`);
    if (strategy.status === 'ERROR') throw new BadRequestException(`Strategy ${params.strategyId} in ERROR state`);
    return strategy;
  }

  async createIntent(params: {
    tenantId: string;
    accountId: string;
    symbol: string;
    side: string;
    orderType: string;
    quantity: string;
    price?: string | null;
    stopPrice?: string | null;
    timeInForce?: string;
    reduceOnly?: boolean;
    strategyId?: string | null;
    traderId?: string | null;
    followerId?: string | null;
    subscriptionId?: string | null;
    environment: string;
    source: string;
    signalId?: string | null;
    correlationId?: string | null;
    requestId?: string | null;
    userId?: string | null;
    venue?: string | null;
  }) {
    const {
      tenantId,
      accountId,
      symbol,
      side,
      orderType,
      quantity,
      price,
      stopPrice,
      timeInForce,
      reduceOnly,
      strategyId,
      traderId,
      followerId,
      subscriptionId,
      environment,
      source,
      signalId,
      correlationId,
      requestId,
      userId,
      venue,
    } = params;

    // Tenant ownership validation
    await this.validateAccountOwnership({ tenantId, accountId, userId });
    const symbolRecord = await this.validateSymbol({ tenantId, symbol, venue });
    this.validatePrecision({ quantity, price, symbol: symbolRecord });
    await this.checkStrategyState({ tenantId, strategyId });

    if (!['BUY', 'SELL'].includes(side)) throw new BadRequestException(`Invalid side ${side}`);
    if (!['MARKET', 'LIMIT', 'STOP', 'STOP_LIMIT'].includes(orderType)) throw new BadRequestException(`Invalid orderType ${orderType}`);
    if (orderType === 'LIMIT' && !price) throw new BadRequestException('LIMIT order requires price');
    if (['STOP', 'STOP_LIMIT'].includes(orderType) && !stopPrice) throw new BadRequestException(`${orderType} requires stopPrice`);
    if (!['PAPER', 'LIVE'].includes(environment)) throw new BadRequestException(`Invalid environment ${environment}`);
    if (!['STRATEGY', 'COPY_TRADING', 'MANUAL', 'RESEARCH_PROMOTION'].includes(source)) throw new BadRequestException(`Invalid source ${source}`);

    // Risk decision — must be APPROVED before intent creation if policy requires
    // We do a pre-check via RiskDecisionService but do not trust client-supplied risk approval
    let riskDecisionId: string | null = null;
    let riskPolicyVersion: string | null = null;
    try {
      const riskResult = await this.riskDecisionService.evaluateUnifiedRisk({
        tenantId,
        userId: (userId ?? undefined) as any,
        accountId,
        symbol,
        traderId: traderId as any,
        followerId: followerId as any,
        strategyId: strategyId as any,
        orderIntent: { side: side as any, quantity, price: price ?? null, orderType: orderType as any } as any,
        environment: environment as any,
        requestId: requestId as any,
      } as any);
      riskDecisionId = riskResult.id;
      riskPolicyVersion = riskResult.policyVersion;
      if (riskResult.decision === 'BLOCK' || riskResult.decision === 'KILL_SWITCH_REQUIRED') {
        throw new BadRequestException(`Risk blocked: ${riskResult.blockingReasons.join(', ')}`);
      }
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      this.logger.warn(`Risk check failed for intent creation tenant ${tenantId} symbol ${symbol}: ${(e as Error).message}`);
      // Fail closed if risk unavailable for LIVE
      if (environment === 'LIVE') throw new BadRequestException(`Risk check unavailable for LIVE order: ${(e as Error).message}`);
    }

    // Compliance check — reuse compliance screening
    const complianceScreen = await this.prisma.complianceScreeningRequest.findFirst({
      where: { tenantId, status: 'BLOCKED' as any },
      orderBy: { createdAt: 'desc' },
    });
    if (complianceScreen) {
      // If tenant has active compliance block, prevent
      const isBlocked = complianceScreen.decision === 'BLOCK';
      if (isBlocked) throw new ForbiddenException(`Compliance BLOCK prevents order intent`);
    }

    // Security state — check threat signals
    const threat = await this.prisma.securityThreatSignal.findFirst({
      where: { tenantId, resolved: false, riskLevel: { in: ['HIGH', 'CRITICAL'] as any } },
      orderBy: { createdAt: 'desc' },
    });
    if (threat && threat.decision === 'DENY') {
      throw new ForbiddenException(`Security BLOCK prevents order intent: ${threat.safeSummary}`);
    }

    // Exchange capability check
    const exchange = symbolRecord.exchange;
    if (!exchange.isEnabled) throw new BadRequestException(`Exchange ${exchange.venue} not enabled`);
    if (environment === 'LIVE' && !exchange.tradingEnabled) throw new BadRequestException(`Exchange ${exchange.venue} trading not enabled for LIVE`);

    // Live gate requirements — check account liveTradingEnabled for LIVE
    const account = await this.prisma.tradingAccount.findUnique({ where: { id: accountId } });
    if (environment === 'LIVE' && !account?.liveTradingEnabled) {
      throw new ForbiddenException(`Live trading not enabled for account ${accountId}`);
    }

    const clientOrderId = `oms-${randomUUID()}`;
    const now = new Date();
    const nowIso = now.toISOString();
    const micros = (BigInt(now.getTime()) * 1000n).toString();

    const transition = {
      eventId: randomUUID(),
      fromState: null,
      toState: OrderIntentState.CREATED,
      timestamp: nowIso,
      timestampMicros: micros,
      source: 'OMS',
      reason: `Order intent created from ${source} symbol ${symbol} side ${side} qty ${quantity}`,
      correlationId: correlationId ?? null,
      policyVersion: riskPolicyVersion,
      riskRuleId: null,
      actorId: userId ?? null,
      actorType: userId ? 'USER' : 'SYSTEM',
      metadata: { strategyId, traderId, followerId, subscriptionId, environment, signalId },
    };

    // Persist as OmsOrderIntent if model exists, else fallback to Order with metadata
    try {
      const created = await (this.prisma as any).omsOrderIntent.create({
        data: {
          tenantId,
          accountId,
          strategyId: strategyId ?? undefined,
          traderId: traderId ?? undefined,
          followerId: followerId ?? undefined,
          subscriptionId: subscriptionId ?? undefined,
          symbol,
          venue: exchange.venue,
          side,
          orderType,
          timeInForce: timeInForce ?? 'GTC',
          quantity,
          price: price ?? undefined,
          stopPrice: stopPrice ?? undefined,
          reduceOnly: reduceOnly ?? false,
          environment,
          state: OrderIntentState.CREATED,
          clientOrderId,
          signalId: signalId ?? undefined,
          riskDecisionId,
          riskPolicyVersion: riskPolicyVersion ?? undefined,
          correlationId: correlationId ?? undefined,
          requestId: requestId ?? undefined,
          source,
          metadata: { transitions: [transition], symbolId: symbolRecord.id },
          filledQuantity: '0',
          cumulativeFee: '0',
          isSimulated: environment === 'PAPER',
          wasDryRun: false,
        },
      });
      this.logger.log(`OMS intent ${created.id} CREATED tenant ${tenantId} symbol ${symbol} qty ${quantity}`);
      return created;
    } catch (e) {
      // Fallback if OmsOrderIntent model not yet migrated — use Order table as intent holder with special metadata
      this.logger.warn(`OmsOrderIntent model missing, falling back to Order table: ${(e as Error).message}`);
      const created = await this.prisma.order.create({
        data: {
          tenantId,
          accountId,
          strategyId: strategyId ?? undefined,
          symbolId: symbolRecord.id,
          clientOrderId,
          venue: exchange.venue,
          symbol,
          side: side as any,
          orderType: orderType as any,
          timeInForce: (timeInForce as any) ?? 'GTC',
          status: 'PENDING' as any,
          quantity: quantity as any,
          price: price as any,
          stopPrice: stopPrice as any,
          reduceOnly: reduceOnly ?? false,
          isSimulated: environment === 'PAPER',
          wasDryRun: false,
          metadata: { omsIntent: true, transitions: [transition], source, correlationId, riskDecisionId, environment, signalId } as any,
        },
      });
      return created;
    }
  }

  async getIntent(tenantId: string, intentId: string) {
    try {
      const intent = await (this.prisma as any).omsOrderIntent.findFirst({ where: { id: intentId, tenantId } });
      if (intent) return intent;
    } catch {}
    return this.prisma.order.findFirst({ where: { id: intentId, tenantId } });
  }

  async listIntents(params: { tenantId: string; accountId?: string; strategyId?: string; symbol?: string; state?: string; page?: number; limit?: number }) {
    const { tenantId, accountId, strategyId, symbol, state, page = 1, limit = 20 } = params;
    try {
      return await (this.prisma as any).omsOrderIntent.findMany({
        where: { tenantId, ...(accountId ? { accountId } : {}), ...(strategyId ? { strategyId } : {}), ...(symbol ? { symbol } : {}), ...(state ? { state } : {}) },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      });
    } catch {
      return this.prisma.order.findMany({
        where: { tenantId, ...(accountId ? { accountId } : {}), ...(strategyId ? { strategyId } : {}), ...(symbol ? { symbol } : {}), ...(state ? { status: state as any } : {}) },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      });
    }
  }
}
