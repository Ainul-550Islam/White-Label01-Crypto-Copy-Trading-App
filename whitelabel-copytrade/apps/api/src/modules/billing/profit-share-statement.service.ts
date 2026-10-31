// # Responsibility: builds follower-owned profit-share statements solely from fee accruals reconciled to posted ledger entries.
import { ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '../../common/decimal-string';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { GenerateProfitShareStatementDto } from './profit-share-statement.dto';

type StatementGenerationInput = GenerateProfitShareStatementDto & { tenantId: string };

function isReversal(metadata: Prisma.JsonValue | null): boolean {
  if (metadata === null || Array.isArray(metadata) || typeof metadata !== 'object') return false;
  return 'reversal' in metadata && metadata.reversal === true;
}

@Injectable()
export class ProfitShareStatementService {
  constructor(private readonly prisma: PrismaService) {}
  async getForFollower(tenantId: string, followerId: string) {
    const periodEnd = new Date();
    const periodStart = new Date(periodEnd.getTime() - 90 * 24 * 60 * 60 * 1000);
    try {
      const accruals = await this.prisma.feeAccrual.findMany({
        where: { tenantId, feeSourceType: 'TRADING_PERFORMANCE', feeType: 'PERFORMANCE_FEE', status: 'SETTLED', createdAt: { gte: periodStart, lte: periodEnd }, metadata: { path: ['followerId'], equals: followerId } },
        select: { id: true, sourceAmount: true, feeAmount: true, currency: true, rateBps: true, createdAt: true, settlementTimestamp: true },
        orderBy: { createdAt: 'desc' }, take: 500,
      });
      if (!accruals.length) return { periodStart: periodStart.toISOString(), periodEnd: periodEnd.toISOString(), currencyTotals: {}, rows: [], excludedWithoutPostedLedger: 0, source: 'posted billing ledger', readOnly: true };
      const ledgerRows = await this.prisma.billingLedgerEntry.findMany({
        where: { tenantId, sourceType: 'FEE', sourceId: { in: accruals.map((a) => a.id) }, status: 'POSTED', accountCategory: 'PERFORMANCE_FEE_REVENUE' },
        select: { sourceId: true, amount: true, currency: true, entryType: true, effectiveAt: true, metadata: true },
        orderBy: { effectiveAt: 'desc' }, take: 2000,
      });
      const grouped = new Map<string, { net: Prisma.Decimal; originalCredit: boolean; currency: string; last: Date | null }>();
      for (const row of ledgerRows) {
        const current = grouped.get(row.sourceId) ?? { net: new Prisma.Decimal(0), originalCredit: false, currency: row.currency.toUpperCase(), last: null };
        const value = new Prisma.Decimal(row.amount);
        if (!value.isFinite() || current.currency !== row.currency.toUpperCase()) throw new Error('Invalid or mismatched ledger amount');
        if (row.entryType === 'CREDIT' && !isReversal(row.metadata)) { current.net = current.net.plus(value); current.originalCredit = true; }
        if (row.entryType === 'DEBIT' && isReversal(row.metadata)) current.net = current.net.minus(value);
        if (!current.last || row.effectiveAt > current.last) current.last = row.effectiveAt;
        grouped.set(row.sourceId,current);
      }
      const totals = new Map<string, Prisma.Decimal>(); const rows: Array<Record<string, unknown>> = []; let excluded=0;
      for (const accrual of accruals) {
        const ledger = grouped.get(accrual.id);
        if (!ledger?.originalCredit) { excluded++; continue; }
        const amount = ledger.net;
        const currency = ledger.currency;
        totals.set(currency,(totals.get(currency)??new Prisma.Decimal(0)).plus(amount));
        rows.push({ reference: accrual.id.slice(0,8), sourcePerformanceAmount: accrual.sourceAmount, postedNetFeeAmount: amount.toFixed(), currency, rateBps: accrual.rateBps, accruedAt: accrual.createdAt.toISOString(), settledAt: accrual.settlementTimestamp?.toISOString() ?? null, ledgerAsOf: ledger.last?.toISOString() ?? null, status: amount.isNegative() ? 'REVERSED' : 'POSTED' });
      }
      return { periodStart: periodStart.toISOString(), periodEnd: periodEnd.toISOString(), currencyTotals: Object.fromEntries([...totals].map(([currency,value])=>[currency,value.toFixed()])), rows, excludedWithoutPostedLedger: excluded, source: 'posted billing ledger', readOnly: true };
    } catch {
      throw new ServiceUnavailableException('Profit-share statement is temporarily unavailable');
    }
  }

  async listForUser(tenantId: string, userId: string) {
    return this.prisma.profitShareStatement.findMany({ where: { tenantId, status: { in: ['FINALIZED', 'SUPERSEDED'] }, OR: [{ followerUserId: userId }, { traderUserId: userId }] }, include: { lines: { orderBy: { postedAt: 'asc' } } }, orderBy: [{ periodStart: 'desc' }, { version: 'desc' }], take: 100 });
  }

  async getForUser(tenantId: string, userId: string, statementId: string) {
    const statement = await this.prisma.profitShareStatement.findFirst({ where: { id: statementId, tenantId, OR: [{ followerUserId: userId }, { traderUserId: userId }] }, include: { lines: { orderBy: { postedAt: 'asc' } } } });
    if (!statement) throw new NotFoundException('Profit-share statement not found');
    return statement;
  }

  async finalize(tenantId: string, statementId: string) {
    return this.prisma.$transaction(async (tx) => {
      const draft = await tx.profitShareStatement.findFirst({ where: { id: statementId, tenantId }, select: { id: true, status: true } });
      if (!draft) throw new NotFoundException('Profit-share statement not found');
      if (draft.status !== 'DRAFT') throw new ConflictException('Only a draft statement can be finalized; finalized statements are immutable');
      const updated = await tx.profitShareStatement.updateMany({ where: { id: statementId, tenantId, status: 'DRAFT' }, data: { status: 'FINALIZED', finalizedAt: new Date() } });
      if (updated.count !== 1) throw new ConflictException('Statement was finalized by another request');
      return tx.profitShareStatement.findUniqueOrThrow({ where: { id: statementId }, include: { lines: { orderBy: { postedAt: 'asc' } } } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async generate(input: StatementGenerationInput, correction = false) {
    const periodStart = new Date(input.periodStart); const periodEnd = new Date(input.periodEnd);
    if (!Number.isFinite(periodStart.getTime()) || !Number.isFinite(periodEnd.getTime()) || periodEnd <= periodStart) throw new ConflictException('Statement period must have a valid exclusive end after its start');
    try {
      const accruals = await this.prisma.feeAccrual.findMany({ where: { tenantId: input.tenantId, feeSourceType: 'TRADING_PERFORMANCE', feeType: 'PERFORMANCE_FEE', status: 'SETTLED', createdAt: { gte: periodStart, lt: periodEnd }, AND: [{ metadata: { path: ['followerId'], equals: input.followerUserId } }, { metadata: { path: ['traderId'], equals: input.traderUserId } }] }, select: { id: true, sourceAmount: true, currency: true, createdAt: true }, orderBy: { createdAt: 'asc' }, take: 1001 });
      if (accruals.length > 1000) throw new ConflictException('Statement period exceeds the 1,000-accrual limit; use smaller periods');
      const ledgerRows = accruals.length ? await this.prisma.billingLedgerEntry.findMany({ where: { tenantId: input.tenantId, sourceType: 'FEE', sourceId: { in: accruals.map((row) => row.id) }, status: 'POSTED', accountCategory: 'PERFORMANCE_FEE_REVENUE' }, select: { id: true, sourceId: true, amount: true, currency: true, entryType: true, effectiveAt: true, metadata: true }, orderBy: { effectiveAt: 'asc' }, take: 4001 }) : [];
      if (ledgerRows.length > 4000) throw new ConflictException('Statement period exceeds the 4,000-ledger-line limit; use smaller periods');
      const bySource = new Map<string, typeof ledgerRows>();
      for (const entry of ledgerRows) bySource.set(entry.sourceId, [...(bySource.get(entry.sourceId) ?? []), entry]);
      const currencies = [...new Set(
        accruals
          .filter((row) => (bySource.get(row.id) ?? []).some((entry) => entry.entryType === 'CREDIT' && !isReversal(entry.metadata)))
          .map((row) => row.currency.toUpperCase()),
      )];
      if (currencies.length === 0) return [];
      if (currencies.length > 1) {
        const results = [];
        for (const currency of currencies) results.push(await this.generateForCurrency(input, periodStart, periodEnd, currency, accruals, bySource, correction));
        return results;
      }
      return [await this.generateForCurrency(input, periodStart, periodEnd, currencies[0] ?? 'USD', accruals, bySource, correction)];
    } catch (error) {
      if (error instanceof ConflictException || error instanceof NotFoundException) throw error;
      throw new ServiceUnavailableException('Statement generation failed; no finalized statement was created');
    }
  }

  private async generateForCurrency(input: StatementGenerationInput, periodStart: Date, periodEnd: Date, currency: string, accruals: Array<{id:string;sourceAmount:string;currency:string;createdAt:Date}>, bySource: Map<string, Array<{id:string;sourceId:string;amount:string;currency:string;entryType:string;effectiveAt:Date;metadata:Prisma.JsonValue|null}>>, correction: boolean) {
    const prior = await this.prisma.profitShareStatement.findMany({ where: { tenantId: input.tenantId, followerUserId: input.followerUserId, traderUserId: input.traderUserId, currency, periodEnd: { lte: periodStart }, status: { in: ['FINALIZED', 'SUPERSEDED'] } }, orderBy: [{ periodEnd: 'asc' }, { version: 'asc' }], select: { grossProfit: true, highWaterMark: true } });
    let cumulative = Decimal.parse('0'); let highWater = Decimal.parse('0');
    for (const statement of prior) { cumulative = cumulative.add(statement.grossProfit); const recorded = Decimal.parse(statement.highWaterMark); if (recorded.gt(highWater)) highWater = recorded; if (cumulative.gt(highWater)) highWater = cumulative; }
    const latest = await this.prisma.profitShareStatement.findFirst({ where: { tenantId: input.tenantId, followerUserId: input.followerUserId, traderUserId: input.traderUserId, currency, periodStart, periodEnd }, orderBy: { version: 'desc' } });
    if (latest && latest.status !== 'DRAFT' && !correction) return this.prisma.profitShareStatement.findUniqueOrThrow({ where: { id: latest.id }, include: { lines: { orderBy: { postedAt: 'asc' } } } });
    const version = (latest?.version ?? 0) + 1;
    const relevant = accruals.filter((row) => row.currency.toUpperCase() === currency && (bySource.get(row.id) ?? []).some((entry) => entry.entryType === 'CREDIT' && !isReversal(entry.metadata)));
    let gross = Decimal.parse('0'); let postedFees = Decimal.parse('0'); const lines: Array<{sourceLedgerId:string;sourceUserId:string;currency:string;profitAmount:string;feeAmount:string;postedAt:Date}> = [];
    for (const accrual of relevant) {
      const entries = bySource.get(accrual.id) ?? []; let sourceProfitRecorded = false;
      for (const entry of entries) {
        if (entry.currency.toUpperCase() !== currency) throw new ConflictException('Ledger/accrual currency mismatch');
        const value = Decimal.parse(entry.amount);
        const reversal = isReversal(entry.metadata);
        let feeDelta = Decimal.parse('0');
        if (entry.entryType === 'CREDIT' && !reversal) { feeDelta = value; }
        if (entry.entryType === 'DEBIT' && reversal) { feeDelta = value.neg(); }
        postedFees = postedFees.add(feeDelta);
        const profit = !sourceProfitRecorded && entry.entryType === 'CREDIT' && !reversal ? Decimal.parse(accrual.sourceAmount) : Decimal.parse('0');
        if (!sourceProfitRecorded && entry.entryType === 'CREDIT' && !reversal) { sourceProfitRecorded = true; gross = gross.add(profit); }
        lines.push({ sourceLedgerId: entry.id, sourceUserId: input.followerUserId, currency, profitAmount: profit.toString(), feeAmount: feeDelta.toString(), postedAt: entry.effectiveAt });
      }
    }
    const endingEquity = cumulative.add(gross); if (endingEquity.gt(highWater)) highWater = endingEquity;
    const statement = await this.prisma.$transaction(async (tx) => {
      const created = await tx.profitShareStatement.create({ data: { tenantId: input.tenantId, followerUserId: input.followerUserId, traderUserId: input.traderUserId, periodStart, periodEnd, currency, version, status: 'DRAFT', grossProfit: gross.toString(), profitShareAmount: postedFees.toFixed(8, 'HALF_EVEN'), highWaterMark: highWater.toString(), roundingRule: 'HALF_EVEN_8_PLACES_ONCE_AFTER_POSTED_LEDGER_SUM', supersedesId: latest?.id ?? null } });
      if (lines.length) await tx.profitShareStatementLine.createMany({ data: lines.map((line) => ({ statementId: created.id, ...line })) });
      const finalized = await tx.profitShareStatement.update({ where: { id: created.id }, data: { status: 'FINALIZED', finalizedAt: new Date() }, include: { lines: { orderBy: { postedAt: 'asc' } } } });
      if (latest && correction && latest.status === 'FINALIZED') await tx.profitShareStatement.update({ where: { id: latest.id }, data: { status: 'SUPERSEDED' } });
      return finalized;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return statement;
  }
}
