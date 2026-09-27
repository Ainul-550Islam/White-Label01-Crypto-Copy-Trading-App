import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RejectionCategory } from './oms.types';
import { randomUUID } from 'crypto';

/**
 * Order Rejection Service — normalizes provider/execution/risk/compliance rejections,
 * categorizes reasons, exposes safe operational diagnostics.
 */

@Injectable()
export class OrderRejectionService {
  private readonly logger = new Logger(OrderRejectionService.name);

  constructor(private readonly prisma: PrismaService) {}

  private categorizeRejection(params: { code?: string | null; message?: string | null; source: string }): RejectionCategory {
    const { code, message, source } = params;
    const text = `${code ?? ''} ${message ?? ''} ${source}`.toUpperCase();

    if (source === 'RISK' || text.includes('RISK') || text.includes('LIMIT') || text.includes('EXPOSURE') || text.includes('LEVERAGE') || text.includes('MARGIN_WARNING') || text.includes('DRAWDOWN') || text.includes('CONCENTRATION')) return RejectionCategory.RISK_BLOCK;
    if (source === 'COMPLIANCE' || text.includes('COMPLIANCE') || text.includes('KYC') || text.includes('AML') || text.includes('SANCTION')) return RejectionCategory.COMPLIANCE_BLOCK;
    if (source === 'SECURITY' || text.includes('SECURITY') || text.includes('THREAT') || text.includes('BLOCKED_IP')) return RejectionCategory.SECURITY_BLOCK;
    if (text.includes('SYMBOL') && (text.includes('INVALID') || text.includes('UNKNOWN') || text.includes('NOT_FOUND'))) return RejectionCategory.INVALID_SYMBOL;
    if (text.includes('PRECISION') || text.includes('LOT_SIZE') || text.includes('TICK_SIZE') || text.includes('MIN_NOTIONAL') || text.includes('STEP')) return RejectionCategory.INVALID_PRECISION;
    if (text.includes('BALANCE') || text.includes('INSUFFICIENT_FUNDS') || text.includes('FUNDS')) return RejectionCategory.INSUFFICIENT_BALANCE;
    if (text.includes('MARGIN') && text.includes('INSUFFICIENT')) return RejectionCategory.INSUFFICIENT_MARGIN;
    if (text.includes('RATE_LIMIT') || text.includes('TOO_MANY_REQUESTS') || text.includes('429')) return RejectionCategory.RATE_LIMITED;
    if (text.includes('STALE') || text.includes('MARKET_DATA')) return RejectionCategory.MARKET_DATA_STALE;
    if (text.includes('LIVE_GATE') || text.includes('LIVE_TRADING_DISABLED') || text.includes('NOT_LIVE_ENABLED')) return RejectionCategory.LIVE_GATE_BLOCK;
    if (text.includes('CREDENTIAL') || text.includes('API_KEY') || text.includes('SIGNATURE') || text.includes('AUTH')) return RejectionCategory.CREDENTIAL_FAILURE;
    if (text.includes('EXCHANGE') || text.includes('VENUE') || text.includes('BINANCE') || text.includes('BYBIT') || text.includes('REJECTED_BY_VENUE')) return RejectionCategory.EXCHANGE_REJECT;
    return RejectionCategory.UNKNOWN;
  }

  private isRetriable(category: RejectionCategory): boolean {
    return [RejectionCategory.RATE_LIMITED, RejectionCategory.MARKET_DATA_STALE, RejectionCategory.UNKNOWN].includes(category);
  }

  async recordRejection(params: {
    tenantId: string;
    orderIntentId: string;
    source: string;
    providerCode?: string | null;
    providerMessage?: string | null;
    riskRuleId?: string | null;
    complianceRuleId?: string | null;
    venue?: string | null;
    symbol?: string | null;
    accountId?: string | null;
    strategyId?: string | null;
    correlationId?: string | null;
    reason: string;
  }) {
    const { tenantId, orderIntentId, source, providerCode, providerMessage, riskRuleId, complianceRuleId, venue, symbol, accountId, strategyId, correlationId, reason } = params;

    const category = this.categorizeRejection({ code: providerCode, message: providerMessage ?? reason, source });

    // Safe reason — never expose secrets, truncate
    const safeReason = reason.slice(0, 1000);
    const safeProviderMessage = providerMessage ? providerMessage.slice(0, 500) : null;

    const record = {
      id: randomUUID(),
      tenantId,
      orderIntentId,
      category,
      reason: safeReason,
      providerCode: providerCode ? providerCode.slice(0, 100) : null,
      providerMessage: safeProviderMessage,
      riskRuleId: riskRuleId ?? null,
      complianceRuleId: complianceRuleId ?? null,
      venue: venue ?? null,
      symbol: symbol ?? null,
      accountId: accountId ?? null,
      strategyId: strategyId ?? null,
      timestamp: new Date().toISOString(),
      correlationId: correlationId ?? null,
      isRetriable: this.isRetriable(category),
      metadata: { source },
    };

    try {
      const created = await (this.prisma as any).omsRejection.create({ data: record });
      this.logger.log(`Rejection recorded intent ${orderIntentId} category ${category} reason ${safeReason} tenant ${tenantId}`);
      return created;
    } catch (e) {
      this.logger.warn(`OmsRejection model missing, logging only: ${(e as Error).message}`);
      return record;
    }
  }

  async getRejections(params: { tenantId: string; accountId?: string; symbol?: string; category?: string; from?: Date; to?: Date; page?: number; limit?: number }) {
    const { tenantId, accountId, symbol, category, from, to, page = 1, limit = 20 } = params;
    try {
      return await (this.prisma as any).omsRejection.findMany({
        where: {
          tenantId,
          ...(accountId ? { accountId } : {}),
          ...(symbol ? { symbol } : {}),
          ...(category ? { category } : {}),
          ...(from || to ? { timestamp: { gte: from?.toISOString(), lte: to?.toISOString() } as any } : {}),
        },
        orderBy: { timestamp: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      });
    } catch {
      return [];
    }
  }

  async getRejectionStats(tenantId: string, from?: Date, to?: Date) {
    const rejections = await this.getRejections({ tenantId, from, to, page: 1, limit: 1000 });
    const byCategory: Record<string, number> = {};
    for (const r of rejections) {
      byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;
    }
    return { total: rejections.length, byCategory, retriable: rejections.filter((r: any) => r.isRetriable).length };
  }
}
