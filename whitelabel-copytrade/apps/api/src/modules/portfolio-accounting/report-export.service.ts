import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { StatementService } from './statement.service';
import { AccountingPolicyService } from './accounting-policy.service';
import { redactSecrets } from './portfolio-accounting.types';

/**
 * Produces CSV/JSON/report payloads from persisted records, tenant-safe, deterministic,
 * reproducible, free of secrets.
 */

@Injectable()
export class ReportExportService {
  private readonly logger = new Logger(ReportExportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly statementService: StatementService,
    private readonly policyService: AccountingPolicyService,
  ) {}

  async exportStatementCsv(params: { tenantId: string; statementId: string }): Promise<{ csv: string; filename: string }> {
    const statement = await this.statementService.getStatement({ tenantId: params.tenantId, statementId: params.statementId });
    if (!statement) throw new BadRequestException('Statement not found');

    // Tenant isolation — statement already filtered by tenantId
    // Deterministic CSV from persisted records
    const headers = [
      'portfolioId',
      'periodStart',
      'periodEnd',
      'openingNav',
      'closingNav',
      'realizedPnl',
      'unrealizedPnl',
      'grossPnl',
      'fees',
      'netPnl',
      'baseCurrency',
      'returnMethodology',
      'calculationVersion',
      'policyVersion',
      'dataCompleteness',
    ];

    const row = [
      statement.profileId,
      statement.periodId,
      statement.openingNav ?? '',
      statement.closingNav ?? '',
      statement.realizedPnl ?? '',
      statement.unrealizedPnl ?? '',
      statement.grossPnl ?? '',
      (statement.fees as any)?.total ?? '',
      statement.netPnl ?? '',
      statement.baseCurrency,
      statement.returnMethodology,
      statement.calculationVersion,
      statement.policyVersion,
      statement.dataCompleteness,
    ];

    const csv = [headers.join(','), row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')].join('\n');

    return { csv, filename: `statement_${statement.statementId}.csv` };
  }

  async exportStatementJson(params: { tenantId: string; statementId: string }): Promise<{ json: any; filename: string }> {
    const statement = await this.statementService.getStatement({ tenantId: params.tenantId, statementId: params.statementId });
    if (!statement) throw new BadRequestException('Statement not found');

    // Export deterministic from persisted records, secrets redacted
    const json = redactSecrets({
      statementId: statement.statementId,
      portfolioId: statement.profileId,
      periodId: statement.periodId,
      openingNav: statement.openingNav,
      closingNav: statement.closingNav,
      deposits: statement.deposits,
      withdrawals: statement.withdrawals,
      transfers: statement.transfers,
      tradingActivity: statement.tradingActivity,
      realizedPnl: statement.realizedPnl,
      unrealizedPnl: statement.unrealizedPnl,
      grossPnl: statement.grossPnl,
      fees: statement.fees,
      netPnl: statement.netPnl,
      returnMethodology: statement.returnMethodology,
      holdings: statement.holdings,
      cash: statement.cash,
      performance: statement.performance,
      benchmark: statement.benchmark,
      reconciliationStatus: statement.reconciliationStatus,
      baseCurrency: statement.baseCurrency,
      calculationVersion: statement.calculationVersion,
      policyVersion: statement.policyVersion,
      methodology: statement.methodology,
      dataCompleteness: statement.dataCompleteness,
      sourceReferences: statement.sourceReferences,
    });

    return { json, filename: `statement_${statement.statementId}.json` };
  }

  async exportHoldingsCsv(params: {
    tenantId: string;
    profileId: string;
    at: Date;
  }): Promise<{ csv: string; filename: string }> {
    let holdings: any[] = [];
    try {
      holdings = await (this.prisma as any).portfolioPositionLot.findMany({
        where: { tenantId: params.tenantId, profileId: params.profileId, isClosed: false, openedAt: { lte: params.at } },
        orderBy: { symbol: 'asc' },
      });
    } catch {
      holdings = [];
    }

    const headers = ['symbol', 'asset', 'quantity', 'remainingQuantity', 'costBasisPerUnit', 'totalCostBasis', 'currency', 'openedAt'];
    const rows = holdings.map((h: any) => [
      h.symbol,
      h.asset,
      h.quantity,
      h.remainingQuantity,
      h.costBasisPerUnit ?? '',
      h.totalCostBasis ?? '',
      h.currency,
      h.openedAt.toISOString(),
    ]);

    const csv = [headers.join(','), ...rows.map((r: any) => r.map((v: any) => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n');

    return { csv, filename: `holdings_${params.profileId}_${params.at.toISOString().slice(0, 10)}.csv` };
  }

  async exportCashLedgerCsv(params: {
    tenantId: string;
    profileId: string;
    from?: Date;
    to?: Date;
  }): Promise<{ csv: string; filename: string }> {
    const where: any = { tenantId: params.tenantId, profileId: params.profileId };
    if (params.from || params.to) {
      where.occurredAt = {};
      if (params.from) where.occurredAt.gte = params.from;
      if (params.to) where.occurredAt.lte = params.to;
    }

    let entries: any[] = [];
    try {
      entries = await (this.prisma as any).portfolioCashLedgerEntry.findMany({
        where,
        orderBy: { occurredAt: 'asc' },
      });
    } catch {
      entries = [];
    }

    const headers = ['occurredAt', 'cashFlowType', 'asset', 'amount', 'currency', 'baseCurrency', 'baseCurrencyAmount', 'sourceType', 'sourceId'];
    const rows = entries.map((e: any) => [
      e.occurredAt.toISOString(),
      e.cashFlowType,
      e.asset,
      e.amount,
      e.currency,
      e.baseCurrency,
      e.baseCurrencyAmount ?? '',
      e.sourceType ?? '',
      e.sourceId ?? '',
    ]);

    const csv = [headers.join(','), ...rows.map((r: any) => r.map((v: any) => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n');

    return { csv, filename: `cash_ledger_${params.profileId}_${Date.now()}.csv` };
  }
}
