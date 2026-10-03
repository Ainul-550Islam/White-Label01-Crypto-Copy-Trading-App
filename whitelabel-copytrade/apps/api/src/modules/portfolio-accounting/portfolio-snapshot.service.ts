import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NavService } from './nav.service';
import { PnLService } from './pnl.service';
import { PerformanceService } from './performance.service';
import { PositionAccountingService } from './position-accounting.service';
import { CashLedgerService } from './cash-ledger.service';
import { AccountingPolicyService } from './accounting-policy.service';
import {
  deterministicIdempotencyKey,
  redactSecrets,
} from './portfolio-accounting.types';
import { createHash } from 'crypto';

/** API view of a PortfolioSnapshot row: performance/methodology/fingerprint/correlationId from performanceMetrics. */
export function toSnapshotView(row: any): any {
  if (!row) return row;
  const metrics = row.performanceMetrics && typeof row.performanceMetrics === 'object' ? row.performanceMetrics : {};
  return {
    ...row,
    performance: metrics.twr ?? null,
    methodology: metrics.methodology ?? null,
    fingerprint: metrics.fingerprint ?? null,
    correlationId: metrics.correlationId ?? null,
  };
}

/**
 * Provides immutable point-in-time snapshots containing NAV, cash, positions, exposure refs,
 * PnL, fees, valuation evidence, source refs, calculationVersion, policyVersion, data completeness.
 * Must be idempotent and prevent duplicate snapshot creation.
 */

@Injectable()
export class PortfolioSnapshotService {
  private readonly logger = new Logger(PortfolioSnapshotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly navService: NavService,
    private readonly pnlService: PnLService,
    private readonly performanceService: PerformanceService,
    private readonly positionAccounting: PositionAccountingService,
    private readonly cashLedger: CashLedgerService,
    private readonly policyService: AccountingPolicyService,
  ) {}

  async createSnapshot(params: {
    tenantId: string;
    profileId: string;
    snapshotId?: string;
    timestamp: Date;
    baseCurrency?: string;
    scope: string;
    scopeId: string;
    correlationId?: string | null;
  }): Promise<any> {
    const { tenantId, profileId, timestamp, scope, scopeId, correlationId = null } = params;

    const policy = await this.policyService.resolvePolicy({ tenantId, scope: scope as any, scopeId });
    const baseCurrency = params.baseCurrency ?? policy.baseCurrency;

    const snapshotId = params.snapshotId ?? `snap_${tenantId.slice(0, 8)}_${profileId.slice(0, 8)}_${timestamp.toISOString().replace(/[:.]/g, '-')}`;

    const idempotencyKey = deterministicIdempotencyKey({
      type: `snapshot:${snapshotId}`,
      tenantId,
      profileId,
      sourceId: snapshotId,
      timestampBucket: timestamp.toISOString().slice(0, 10),
    });

    // Duplicate snapshot prevention — immutable idempotent with snapshotId tenantId scope timestamp
    try {
      const existing = await (this.prisma as any).portfolioSnapshot.findFirst({
        where: { tenantId, OR: [{ idempotencyKey }, { snapshotId }] },
      });
      if (existing) {
        this.logger.log({ event: 'portfolio.snapshot.idempotent_hit', snapshotId, tenantId });
        return toSnapshotView(existing);
      }
    } catch {}

    // Calculate NAV
    const navResult = await this.navService.calculateNav({ tenantId, profileId, at: timestamp, baseCurrency });

    // Calculate PnL
    const pnlResult = await this.pnlService.calculateNetPnl({
      tenantId,
      profileId,
      at: timestamp,
      baseCurrency,
      from: new Date(timestamp.getTime() - 24 * 60 * 60 * 1000), // last 24h for daily
      to: timestamp,
    });

    // Get holdings
    const holdings = await this.positionAccounting.getHoldings({ tenantId, profileId, at: timestamp });

    // Get cash
    const cash = await this.cashLedger.getCashBalance({ tenantId, profileId, at: timestamp });

    // Get performance (since inception)
    const inception = new Date('2020-01-01'); // would be profile creation date in real
    const twr = await this.performanceService.calculateTWR({ tenantId, profileId, periodStart: inception, periodEnd: timestamp, baseCurrency });

    // Fees from cash ledger
    let fees: any[] = [];
    try {
      const feeEntries = await (this.prisma as any).portfolioCashLedgerEntry.findMany({
        where: {
          tenantId,
          profileId,
          cashFlowType: { in: ['FEE', 'PLATFORM_FEE', 'PERFORMANCE_FEE'] },
          occurredAt: { lte: timestamp },
        },
        orderBy: { occurredAt: 'desc' },
        take: 100,
      });
      fees = feeEntries;
    } catch {
      fees = [];
    }

    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ tenantId, profileId, snapshotId, timestamp: timestamp.toISOString(), nav: navResult.nav, holdings }))
      .digest('hex');

    const snapshot = await (this.prisma as any).portfolioSnapshot.create({
      data: {
        tenantId,
        profileId,
        snapshotId,
        timestamp,
        baseCurrency,
        cash: cash.balance,
        positions: holdings as any,
        nav: navResult.nav,
        grossAssetValue: navResult.grossAssetValue,
        grossLiability: navResult.grossLiability,
        realizedPnl: pnlResult.grossPnl ? (await this.pnlService.calculateRealizedPnl({ tenantId, profileId })).realizedPnl : null,
        unrealizedPnl: pnlResult.evidence?.gross?.unrealized ?? null,
        grossPnl: pnlResult.grossPnl,
        netPnl: pnlResult.netPnl,
        // fees is a decimal-string column: the fee total of the same window as gross/net PnL
        // (netPnl = grossPnl - fees). The fee ledger rows are kept as cash-breakdown evidence.
        fees: pnlResult.fees ?? null,
        cashBreakdown: {
          balance: cash.balance,
          currency: cash.currency,
          baseCurrencyBalance: cash.baseCurrencyBalance ?? null,
          recentFeeEntries: fees.map((entry: any) => ({
            id: entry.id,
            cashFlowType: entry.cashFlowType,
            amount: entry.amount,
            currency: entry.currency,
            baseCurrencyAmount: entry.baseCurrencyAmount ?? null,
            occurredAt: entry.occurredAt,
          })),
        } as any,
        // No performance/methodology/fingerprint/correlationId columns: kept in performanceMetrics.
        performanceMetrics: {
          twr: twr.evidence ?? null,
          methodology: navResult.methodology ?? null,
          fingerprint,
          correlationId: correlationId ?? null,
        } as any,
        valuationEvidence: navResult.evidences as any,
        sourceReferences: navResult.sourceReferences,
        calculationVersion: policy.calculationVersion,
        policyVersion: policy.policyVersion,
        dataCompleteness: navResult.dataCompleteness,
        idempotencyKey,
      },
    });

    this.logger.log({ event: 'portfolio.snapshot.created', snapshotId, tenantId, nav: navResult.nav });

    return toSnapshotView(snapshot);
  }

  async getSnapshot(params: { tenantId: string; snapshotId: string }): Promise<any | null> {
    const snapshot = await (this.prisma as any).portfolioSnapshot.findFirst({
      where: { tenantId: params.tenantId, snapshotId: params.snapshotId },
    });
    return snapshot ? toSnapshotView(snapshot) : null;
  }

  async listSnapshots(params: {
    tenantId: string;
    profileId?: string;
    from?: Date;
    to?: Date;
    page?: number;
    limit?: number;
  }): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    const { tenantId, profileId, from, to, page = 1, limit = 50 } = params;
    const where: any = { tenantId };
    if (profileId) where.profileId = profileId;
    if (from || to) {
      where.timestamp = {};
      if (from) where.timestamp.gte = from;
      if (to) where.timestamp.lte = to;
    }

    const [data, total] = await Promise.all([
      (this.prisma as any).portfolioSnapshot.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      (this.prisma as any).portfolioSnapshot.count({ where }),
    ]);
    return { data: data.map(toSnapshotView), total, page, limit };
  }

  async verifySnapshotImmutability(snapshotId: string, currentHash: string): Promise<boolean> {
    const snapshot = await (this.prisma as any).portfolioSnapshot.findFirst({ where: { snapshotId } });
    if (!snapshot) return false;
    return toSnapshotView(snapshot).fingerprint === currentHash;
  }
}
