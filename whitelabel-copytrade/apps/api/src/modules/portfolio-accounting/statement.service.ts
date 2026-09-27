import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AccountingPolicyService } from './accounting-policy.service';
import { AccountingPeriodService } from './accounting-period.service';
import { PortfolioSnapshotService } from './portfolio-snapshot.service';
import { PnLService } from './pnl.service';
import { PerformanceService } from './performance.service';
import { CashLedgerService } from './cash-ledger.service';
import { PositionAccountingService } from './position-accounting.service';
import { PortfolioStatementState, deterministicIdempotencyKey, redactSecrets } from './portfolio-accounting.types';

/**
 * Generates statements from persisted periods and snapshots, including holdings, cash,
 * transactions, fees, PnL, returns, and methodology. Statements from persisted accounting include
 * portfolio ID, period, opening/closing NAV, deposits/withdrawals/transfers, trading activity,
 * realized/unrealized PnL, fees, net PnL, return methodology, holdings, cash, performance,
 * benchmark, reconciliation status, versions.
 */

@Injectable()
export class StatementService {
  private readonly logger = new Logger(StatementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policyService: AccountingPolicyService,
    private readonly periodService: AccountingPeriodService,
    private readonly snapshotService: PortfolioSnapshotService,
    private readonly pnlService: PnLService,
    private readonly performanceService: PerformanceService,
    private readonly cashLedger: CashLedgerService,
    private readonly positionAccounting: PositionAccountingService,
  ) {}

  async generateStatement(params: {
    tenantId: string;
    profileId: string;
    periodId: string;
    statementId?: string;
    operatorId?: string | null;
  }): Promise<any> {
    const { tenantId, profileId, periodId, operatorId = null } = params;

    const period = await this.periodService.getPeriod({ tenantId, periodId });
    if (!period) throw new BadRequestException('Period not found');
    if (period.profileId !== profileId) throw new BadRequestException('Period profile mismatch');

    const policy = await this.policyService.resolvePolicy({ tenantId, scope: 'TENANT' as any, scopeId: profileId });

    const statementId = params.statementId ?? `stmt_${tenantId.slice(0, 8)}_${periodId.slice(0, 8)}_${Date.now()}`;

    const idempotencyKey = deterministicIdempotencyKey({
      type: `statement:${statementId}`,
      tenantId,
      profileId,
      sourceId: periodId,
    });

    try {
      const existing = await (this.prisma as any).portfolioStatement.findFirst({ where: { idempotencyKey } });
      if (existing) return existing;
    } catch {}

    // Fetch persisted records — statements from persisted accounting
    const openingSnapshot = await (this.prisma as any).portfolioSnapshot.findFirst({
      where: { tenantId, profileId, timestamp: { lte: period.periodStart } },
      orderBy: { timestamp: 'desc' },
    });

    const closingSnapshot = await (this.prisma as any).portfolioSnapshot.findFirst({
      where: { tenantId, profileId, timestamp: { gte: period.periodEnd, lte: new Date(period.periodEnd.getTime() + 24 * 60 * 60 * 1000) } },
      orderBy: { timestamp: 'asc' },
    });

    const cashEntries = await this.cashLedger.listCashEntries({
      tenantId,
      profileId,
      from: period.periodStart,
      to: period.periodEnd,
      page: 1,
      limit: 1000,
    });

    const deposits = cashEntries.data.filter((e: any) => e.cashFlowType === 'DEPOSIT');
    const withdrawals = cashEntries.data.filter((e: any) => e.cashFlowType === 'WITHDRAWAL');
    const transfers = cashEntries.data.filter((e: any) => ['TRANSFER_IN', 'TRANSFER_OUT'].includes(e.cashFlowType));

    const holdings = await this.positionAccounting.getHoldings({ tenantId, profileId, at: period.periodEnd });

    const pnl = await this.pnlService.calculateNetPnl({
      tenantId,
      profileId,
      from: period.periodStart,
      to: period.periodEnd,
      at: period.periodEnd,
      baseCurrency: period.baseCurrency,
    });

    const twr = await this.performanceService.calculateTWR({
      tenantId,
      profileId,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      baseCurrency: period.baseCurrency,
    });

    const mwr = await this.performanceService.calculateMWR({
      tenantId,
      profileId,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      baseCurrency: period.baseCurrency,
    });

    // Reconciliation status
    let reconciliationStatus = 'UNKNOWN';
    try {
      const recon = await (this.prisma as any).portfolioAccountingReconciliation.findFirst({
        where: { tenantId, profileId, periodId },
        orderBy: { createdAt: 'desc' },
      });
      if (recon) reconciliationStatus = recon.state;
    } catch {
      reconciliationStatus = 'PENDING';
    }

    // Build statement from persisted records
    const statementData = {
      portfolioId: profileId,
      period: { id: period.id, start: period.periodStart, end: period.periodEnd, type: period.periodType },
      openingNav: openingSnapshot?.nav ?? null,
      closingNav: closingSnapshot?.nav ?? pnl.evidence?.gross?.endingNav ?? null,
      deposits: deposits.map((d: any) => ({ amount: d.baseCurrencyAmount ?? d.amount, currency: d.currency, occurredAt: d.occurredAt })),
      withdrawals: withdrawals.map((w: any) => ({ amount: w.baseCurrencyAmount ?? w.amount, currency: w.currency, occurredAt: w.occurredAt })),
      transfers: transfers.map((t: any) => ({ amount: t.baseCurrencyAmount ?? t.amount, currency: t.currency, type: t.cashFlowType, occurredAt: t.occurredAt })),
      tradingActivity: cashEntries.data.filter((e: any) => ['TRADE_SETTLEMENT_BUY', 'TRADE_SETTLEMENT_SELL'].includes(e.cashFlowType)).length,
      realizedPnl: pnl.evidence?.gross?.realized ?? null,
      unrealizedPnl: pnl.evidence?.gross?.unrealized ?? null,
      grossPnl: pnl.grossPnl,
      fees: pnl.fees,
      netPnl: pnl.netPnl,
      returnMethodology: policy.returnMethodology,
      holdings,
      cash: { balance: closingSnapshot?.cash ?? '0', currency: period.baseCurrency },
      performance: { twr: twr.returnPercent, mwr: mwr.returnPercent, twrEvidence: twr.evidence, mwrEvidence: mwr.evidence },
      benchmark: null, // Would include benchmark if configured
      reconciliationStatus,
      versions: { calculationVersion: policy.calculationVersion, policyVersion: policy.policyVersion },
    };

    const statement = await (this.prisma as any).portfolioStatement.create({
      data: {
        tenantId,
        profileId,
        periodId,
        statementId,
        state: PortfolioStatementState.FINALIZED as any,
        openingNav: statementData.openingNav,
        closingNav: statementData.closingNav,
        deposits: deposits as any,
        withdrawals: withdrawals as any,
        transfers: transfers as any,
        tradingActivity: { count: statementData.tradingActivity } as any,
        realizedPnl: statementData.realizedPnl,
        unrealizedPnl: statementData.unrealizedPnl,
        grossPnl: statementData.grossPnl,
        fees: { total: statementData.fees } as any,
        netPnl: statementData.netPnl,
        returnMethodology: policy.returnMethodology as any,
        holdings: holdings as any,
        cash: { balance: statementData.cash.balance, currency: statementData.cash.currency } as any,
        performance: statementData.performance as any,
        benchmark: null,
        reconciliationStatus,
        baseCurrency: period.baseCurrency,
        calculationVersion: policy.calculationVersion,
        policyVersion: policy.policyVersion,
        methodology: `STATEMENT_${policy.returnMethodology}`,
        dataCompleteness: closingSnapshot?.dataCompleteness ?? 'COMPLETE',
        sourceReferences: [...new Set([...(closingSnapshot?.sourceReferences ?? []), ...(openingSnapshot?.sourceReferences ?? [])])],
        evidence: redactSecrets({ statementData, period, openingSnapshotId: openingSnapshot?.id, closingSnapshotId: closingSnapshot?.id }) as any,
        idempotencyKey,
        createdBy: operatorId,
      },
    });

    this.logger.log({ event: 'portfolio.statement.generated', statementId, tenantId, periodId });

    return statement;
  }

  async getStatement(params: { tenantId: string; statementId: string }): Promise<any | null> {
    try {
      return await (this.prisma as any).portfolioStatement.findFirst({
        where: { tenantId: params.tenantId, statementId: params.statementId },
      });
    } catch {
      return null;
    }
  }

  async listStatements(params: {
    tenantId: string;
    profileId?: string;
    periodId?: string;
    from?: Date;
    to?: Date;
    page?: number;
    limit?: number;
  }): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    const { tenantId, profileId, periodId, from, to, page = 1, limit = 50 } = params;
    const where: any = { tenantId };
    if (profileId) where.profileId = profileId;
    if (periodId) where.periodId = periodId;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = from;
      if (to) where.createdAt.lte = to;
    }

    try {
      const [data, total] = await Promise.all([
        (this.prisma as any).portfolioStatement.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        (this.prisma as any).portfolioStatement.count({ where }),
      ]);
      return { data, total, page, limit };
    } catch {
      return { data: [], total: 0, page, limit };
    }
  }
}
