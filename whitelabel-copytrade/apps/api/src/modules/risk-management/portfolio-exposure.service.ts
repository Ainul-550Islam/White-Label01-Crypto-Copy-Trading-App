import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { InstitutionalRiskPolicyService } from './risk-policy.service';
import { validatedExposureCurrency } from './exposure-currency';
import {
  PortfolioExposure,
  SymbolExposure,
  VenueExposure,
  AccountExposure,
  RiskState,
} from './risk-management.types';

/**
 * Portfolio exposure aggregation from canonical sources only:
 * - Position (canonical, derived from fills, never venue snapshot)
 * - Order (open orders, canonical)
 * - AccountBalanceSnapshot (canonical, not client-provided)
 * - MarketDataRecord / TradingSymbol mark prices
 *
 * Decimal-safe arithmetic mandatory: uses scaled BigInt (1e12).
 * Never trusts client-provided balances/equity/exposure.
 * Stale/missing market data => explicit STALE/UNKNOWN, never invented.
 */

const SCALE = 1_000_000_000_000n; // 1e12
const SCALE_DIGITS = 12;

function isValidDecimalString(v: string | null | undefined): boolean {
  if (!v) return false;
  return /^-?\d+(\.\d+)?$/.test(v);
}

function parseScaled(s: string): bigint {
  const negative = s.startsWith('-');
  const clean = negative ? s.slice(1) : s;
  const [intPart = '0', fracPart = ''] = clean.split('.');
  const fracPadded = (fracPart + '0'.repeat(SCALE_DIGITS)).slice(0, SCALE_DIGITS);
  const scaled = BigInt(intPart || '0') * SCALE + BigInt(fracPadded || '0');
  return negative ? -scaled : scaled;
}

function formatScaled(b: bigint): string {
  const negative = b < 0n;
  const abs = negative ? -b : b;
  const intPart = abs / SCALE;
  const fracPart = abs % SCALE;
  const fracStr = fracPart.toString().padStart(SCALE_DIGITS, '0').replace(/0+$/, '');
  const result = fracStr ? `${intPart}.${fracStr}` : `${intPart}`;
  return negative ? `-${result}` : result;
}

function add(a: string, b: string): string {
  return formatScaled(parseScaled(a) + parseScaled(b));
}
function sub(a: string, b: string): string {
  return formatScaled(parseScaled(a) - parseScaled(b));
}
function absStr(a: string): string {
  return a.startsWith('-') ? a.slice(1) : a;
}
function mul(a: string, b: string): string {
  // (a*1e12 * b*1e12)/1e12
  const av = parseScaled(a);
  const bv = parseScaled(b);
  const product = av * bv;
  // All callers multiply non-negative quantity and price. Round a discarded
  // fraction upwards so a capped order or position is never understated.
  const rounded = product > 0n ? (product + SCALE - 1n) / SCALE : product / SCALE;
  return formatScaled(rounded);
}
function cmp(a: string, b: string): number {
  const av = parseScaled(a);
  const bv = parseScaled(b);
  if (av < bv) return -1;
  if (av > bv) return 1;
  return 0;
}

@Injectable()
export class PortfolioExposureService {
  private readonly logger = new Logger(PortfolioExposureService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policyService: InstitutionalRiskPolicyService,
  ) {}

  async calculateExposure(params: {
    tenantId: string;
    accountId?: string;
    traderId?: string;
    strategyId?: string;
    followerId?: string;
    userId?: string;
    candidateSymbol?: string;
    /** Account providing the candidate market, without narrowing a tenant-wide aggregate. */
    candidateAccountId?: string;
    /** Existing intent being rechecked for routing; its candidate notional is projected separately. */
    excludePendingIntentId?: string;
  }): Promise<PortfolioExposure> {
    const { tenantId, accountId, traderId, strategyId, followerId, candidateSymbol, candidateAccountId, excludePendingIntentId } = params;
    if (accountId && candidateAccountId && accountId !== candidateAccountId) {
      throw new Error('Candidate account does not match the exposure scope');
    }

    const policy = await this.policyService.resolveEffectivePolicy({
      tenantId,
      traderId: traderId ?? null,
      strategyId: strategyId ?? null,
      followerId: followerId ?? null,
    });

    // Every read uses the same tenant-scoped transaction. An empty result from
    // a forced-RLS connection without its tenant GUC is not evidence of zero
    // positions or orders.
    const now = new Date();
    const [positions, openOrders, balances, candles, candidateMarkets, pendingIntents] = await this.prisma.withTenantRls(tenantId, async (tx) => {
      // Read reservations first. If an intent transitions while this query is
      // in flight, the later canonical-order read still sees the order it
      // produced. An unmatched reservation cannot be priced as zero.
      const pendingIntents = await tx.omsOrderIntent.findMany({
        where: {
          tenantId, ...(accountId ? { accountId } : {}),
          ...(excludePendingIntentId ? { id: { not: excludePendingIntentId } } : {}),
          state: { in: ['CREATED', 'VALIDATING', 'APPROVED', 'SUBMITTED', 'ACKNOWLEDGED', 'PARTIALLY_FILLED',
            'CANCEL_REQUESTED', 'FAILED', 'RECONCILIATION_REQUIRED', 'REPLACED'] },
        },
        select: { clientOrderId: true, symbol: true },
      });
      const [positions, openOrders, balances] = await Promise.all([
        tx.position.findMany({
          where: { tenantId, ...(accountId ? { accountId } : {}) },
          include: { symbolRef: true },
        }),
        tx.order.findMany({
          where: {
            tenantId,
            ...(accountId ? { accountId } : {}),
            // A requested cancellation is still open. Terminal-looking orders
            // with reconciliation problems remain exposure too.
            OR: [
              { status: { in: ['PENDING', 'SUBMITTED', 'ACKNOWLEDGED', 'PARTIALLY_FILLED', 'CANCEL_REQUESTED', 'FAILED'] } },
              { reconciliationState: { not: 'IN_SYNC' } },
            ],
          },
          include: { symbolRef: true },
        }),
        tx.accountBalanceSnapshot.findMany({ where: { tenantId, ...(accountId ? { accountId } : {}) } }),
      ]);
      const symbolIds = [...new Set(positions.map((position) => position.symbolId))];
      const maxAge = policy.thresholds.marketDataMaxAgeMs;
      const candles = symbolIds.length && Number.isFinite(maxAge) && maxAge > 0
        ? await tx.marketDataRecord.findMany({
          where: {
            symbolId: { in: symbolIds }, interval: '1m', tradeCount: { gt: 0 },
            closeTime: { lte: now, gte: new Date(now.getTime() - maxAge) },
          },
          orderBy: [{ symbolId: 'asc' }, { closeTime: 'desc' }],
          distinct: ['symbolId'],
          select: { symbolId: true, close: true, closeTime: true },
        })
        : [];
      const candidateAccount = candidateAccountId ?? accountId;
      const account = candidateSymbol && candidateAccount ? await tx.tradingAccount.findFirst({
        where: { tenantId, id: candidateAccount, deletedAt: null }, select: { exchangeId: true, marketType: true },
      }) : null;
      const candidateMarkets = account && candidateSymbol ? await tx.tradingSymbol.findMany({
        where: { tenantId, exchangeId: account.exchangeId, marketType: account.marketType, symbol: candidateSymbol },
        select: { quoteAsset: true, marketType: true }, take: 2,
      }) : [];
      return [positions, openOrders, balances, candles, candidateMarkets, pendingIntents] as const;
    });
    const candleBySymbolId = new Map(candles.map((candle) => [candle.symbolId, candle]));
    const nowIso = now.toISOString();
    const staleSymbols: string[] = [];
    const unknownPrices: string[] = [];

    // Aggregate per symbol
    const symbolAgg = new Map<string, { long: bigint; short: bigint; net: bigint; gross: bigint; openOrder: bigint; venue: string; base: string | null; quote: string | null; price: string | null; priceTs: string | null; isStale: boolean }>();

    const unknown = (symbol: string) => {
      if (!unknownPrices.includes(symbol)) unknownPrices.push(symbol);
    };
    const canonicalOrderIds = new Set(openOrders.map((order) => order.clientOrderId));
    for (const intent of pendingIntents) {
      if (!canonicalOrderIds.has(intent.clientOrderId)) unknown(intent.symbol);
    }
    const quotes = new Set<string>();
    if (candidateSymbol) {
      if (candidateMarkets.length !== 1 || candidateMarkets[0].marketType !== 'SPOT' || !candidateMarkets[0].quoteAsset) {
        unknown(candidateSymbol);
      } else {
        quotes.add(candidateMarkets[0].quoteAsset);
      }
    }
    for (const pos of positions) {
      const sym = pos.symbol;
      const venue = pos.venue as string;
      const qtyStr = pos.quantity.toString();
      if (!isValidDecimalString(qtyStr)) { unknown(sym); continue; }
      if (parseScaled(qtyStr) === 0n) continue;
      const candle = candleBySymbolId.get(pos.symbolId);
      const markPrice = candle?.close.toString() ?? null;
      // Position.updatedAt is not a mark timestamp: fills or reconciliation
      // can update it while retaining an old mark. Entry price is cost basis,
      // not a valuation. Use only a recent, closed, traded market-data candle.
      const priceValid = isValidDecimalString(markPrice) && parseScaled(markPrice!) > 0n;
      const spot = pos.symbolRef?.marketType === 'SPOT';
      const quote = pos.symbolRef?.quoteAsset ?? null;
      if (!priceValid || !spot || !quote) unknown(sym);
      if (quote) quotes.add(quote);
      const notionalStr = priceValid && spot && quote ? mul(absStr(qtyStr), markPrice!) : null;

      let agg = symbolAgg.get(sym);
      if (!agg) {
        agg = {
          long: 0n, short: 0n, net: 0n, gross: 0n, openOrder: 0n,
          venue, base: pos.symbolRef?.baseAsset ?? null, quote,
          price: priceValid ? markPrice : null,
          priceTs: priceValid ? (candle?.closeTime.toISOString() ?? null) : null,
          isStale: false,
        };
        symbolAgg.set(sym, agg);
      } else if (agg.venue !== venue || agg.quote !== quote) {
        // The public aggregate is symbol-keyed and cannot safely attribute
        // different venues or quote units to a single symbol row.
        unknown(sym);
      }
      if (notionalStr) {
        const signedQty = parseScaled(qtyStr);
        const notional = parseScaled(notionalStr);
        if (signedQty >= 0n) agg.long += notional;
        else agg.short += notional;
        agg.net += signedQty >= 0n ? notional : -notional;
        agg.gross += notional;
      }
    }

    // An execution-price cap exists for a priced BUY LIMIT, not for a
    // market order or a SELL limit (whose price is a floor). Count the full
    // order size, even when partially filled, so a concurrent fill cannot be
    // silently subtracted before its position is visible.
    const boundedOrderNotional = (ord: (typeof openOrders)[number]): string | null => {
      const qty = ord.quantity.toString();
      const price = ord.price?.toString() ?? null;
      if (ord.reconciliationState !== 'IN_SYNC' || ord.orderType !== 'LIMIT' || ord.side !== 'BUY' ||
          ord.symbolRef?.marketType !== 'SPOT' || !ord.symbolRef?.quoteAsset ||
          !isValidDecimalString(qty) || !isValidDecimalString(price) ||
          parseScaled(qty) <= 0n || parseScaled(price!) <= 0n) return null;
      return mul(qty, price!);
    };
    for (const ord of openOrders) {
      const sym = ord.symbol;
      const quote = ord.symbolRef?.quoteAsset ?? null;
      if (quote) quotes.add(quote);
      const notionalStr = boundedOrderNotional(ord);
      if (notionalStr === null) { unknown(sym); continue; }
      let agg = symbolAgg.get(sym);
      if (!agg) {
        agg = {
          long: 0n, short: 0n, net: 0n, gross: 0n, openOrder: 0n,
          venue: ord.venue as string, base: ord.symbolRef?.baseAsset ?? null, quote,
          price: null, priceTs: null, isStale: false,
        };
        symbolAgg.set(sym, agg);
      } else if (agg.venue !== ord.venue || agg.quote !== quote) {
        unknown(sym);
      }
      agg.openOrder += parseScaled(notionalStr);
    }
    if (quotes.size > 1) {
      // No FX conversion source or base currency is carried by this
      // aggregate. A sum of unlike quote units is diagnostic only.
      for (const symbol of symbolAgg.keys()) unknown(symbol);
      for (const ord of openOrders) unknown(ord.symbol);
      if (candidateSymbol) unknown(candidateSymbol);
    }
    if (traderId || strategyId || followerId || policy.thresholds.maxStrategyExposure != null ||
        policy.thresholds.maxTraderExposure != null || policy.thresholds.maxFollowerExposure != null) {
      // Positions have no reliable strategy/trader/follower attribution in
      // this ledger. Their account-level amounts cannot prove scope totals.
      for (const pos of positions) {
        const qty = pos.quantity.toString();
        if (!isValidDecimalString(qty) || parseScaled(qty) !== 0n) unknown(pos.symbol);
      }
    }

    // Compute totals
    let totalGross = 0n;
    let totalNet = 0n;
    let totalLong = 0n;
    let totalShort = 0n;
    let totalOpenOrder = 0n;

    for (const agg of symbolAgg.values()) {
      totalGross += agg.gross;
      totalNet += agg.net;
      totalLong += agg.long;
      totalShort += agg.short;
      totalOpenOrder += agg.openOrder;
    }

    const grossExposure = formatScaled(totalGross);
    const netExposure = formatScaled(totalNet);
    const longExposure = formatScaled(totalLong);
    const shortExposure = formatScaled(totalShort);
    const openOrderExposure = formatScaled(totalOpenOrder);
    const totalExposure = formatScaled(totalGross + totalOpenOrder);

    // Symbol exposures
    const symbolExposures: SymbolExposure[] = [];
    for (const [symbol, agg] of symbolAgg.entries()) {
      const grossStr = formatScaled(agg.gross);
      const conc = totalGross > 0n ? formatScaled((agg.gross * 100n * SCALE) / totalGross / SCALE) : null;
      // Actually percent = gross / totalGross *100
      const concPercent = totalGross > 0n ? formatScaled((agg.gross * 100n * SCALE) / totalGross) : null; // wait we already divided?
      // Let's compute properly: (agg.gross / totalGross)*100
      let concentrationPercent: string | null = null;
      if (totalGross > 0n) {
        const pctScaled = (agg.gross * 100n * SCALE) / totalGross;
        concentrationPercent = formatScaled(pctScaled);
      }
      symbolExposures.push({
        symbol,
        venue: agg.venue,
        baseAsset: agg.base,
        quoteAsset: agg.quote,
        longNotional: formatScaled(agg.long),
        shortNotional: formatScaled(agg.short),
        netNotional: formatScaled(agg.net),
        grossNotional: grossStr,
        openOrderNotional: formatScaled(agg.openOrder),
        totalExposure: formatScaled(agg.gross + agg.openOrder),
        concentrationPercent,
        price: agg.price,
        priceTimestamp: agg.priceTs,
        isStale: agg.isStale,
      });
    }

    // Venue exposures
    const venueMap = new Map<string, { gross: bigint; net: bigint; accounts: Set<string>; symbols: Set<string> }>();
    for (const [sym, agg] of symbolAgg.entries()) {
      const v = agg.venue;
      let vm = venueMap.get(v);
      if (!vm) {
        vm = { gross: 0n, net: 0n, accounts: new Set(), symbols: new Set() };
        venueMap.set(v, vm);
      }
      vm.gross += agg.gross;
      vm.net += agg.net;
      vm.symbols.add(sym);
    }
    // Add account info for venue
    for (const pos of positions) {
      const vm = venueMap.get(pos.venue as string);
      if (vm) vm.accounts.add(pos.accountId);
    }
    const venueExposures: VenueExposure[] = [];
    for (const [venue, vm] of venueMap.entries()) {
      const conc = totalGross > 0n ? formatScaled((vm.gross * 100n * SCALE) / totalGross) : null;
      venueExposures.push({
        venue,
        grossNotional: formatScaled(vm.gross),
        netNotional: formatScaled(vm.net),
        concentrationPercent: conc,
        accountCount: vm.accounts.size,
        symbolCount: vm.symbols.size,
      });
    }

    // Account exposures use the same bounded orders and fresh candle marks as
    // the portfolio aggregate. Unknown components are reflected in state.
    const accountMap = new Map<string, { venue: string; gross: bigint; net: bigint; long: bigint; short: bigint; openOrder: bigint; symbols: Set<string> }>();
    for (const pos of positions) {
      const qtyStr = pos.quantity.toString();
      if (!isValidDecimalString(qtyStr) || parseScaled(qtyStr) === 0n) continue;
      const markPrice = candleBySymbolId.get(pos.symbolId)?.close.toString() ?? null;
      const priced = pos.symbolRef?.marketType === 'SPOT' && !!pos.symbolRef?.quoteAsset &&
        isValidDecimalString(markPrice) && parseScaled(markPrice!) > 0n;
      const notional = priced ? parseScaled(mul(absStr(qtyStr), markPrice!)) : 0n;
      let am = accountMap.get(pos.accountId);
      if (!am) {
        am = { venue: pos.venue as string, gross: 0n, net: 0n, long: 0n, short: 0n, openOrder: 0n, symbols: new Set() };
        accountMap.set(pos.accountId, am);
      }
      am.gross += notional;
      if (parseScaled(qtyStr) >= 0n) { am.long += notional; am.net += notional; }
      else { am.short += notional; am.net -= notional; }
      am.symbols.add(pos.symbol);
    }
    for (const ord of openOrders) {
      const notionalStr = boundedOrderNotional(ord);
      let am = accountMap.get(ord.accountId);
      if (!am) {
        am = { venue: ord.venue as string, gross: 0n, net: 0n, long: 0n, short: 0n, openOrder: 0n, symbols: new Set() };
        accountMap.set(ord.accountId, am);
      }
      if (notionalStr !== null) am.openOrder += parseScaled(notionalStr);
      am.symbols.add(ord.symbol);
    }
    const accountExposures: AccountExposure[] = [];
    for (const [accountId, am] of accountMap.entries()) {
      accountExposures.push({
        accountId,
        venue: am.venue,
        grossNotional: formatScaled(am.gross),
        netNotional: formatScaled(am.net),
        longNotional: formatScaled(am.long),
        shortNotional: formatScaled(am.short),
        openOrderNotional: formatScaled(am.openOrder),
        totalExposure: formatScaled(am.gross + am.openOrder),
        symbolCount: am.symbols.size,
      });
    }

    // Strategy exposures: need to map positions via orders? For now aggregate via strategyId in orders
    // If strategyId present in positions? Position doesn't have strategyId, so we use orders.
    const strategyMap = new Map<string, { gross: bigint; net: bigint; traderId: string | null }>();
    // Use copyTrading? For simplicity, use orders grouped by strategyId
    const ordersByStrategy = openOrders.filter((o) => o.strategyId);
    for (const o of ordersByStrategy) {
      const sid = o.strategyId!;
      let sm = strategyMap.get(sid);
      if (!sm) {
        sm = { gross: 0n, net: 0n, traderId: null };
        strategyMap.set(sid, sm);
      }
      const bound = boundedOrderNotional(o);
      if (bound !== null) {
        const notional = parseScaled(bound);
        sm.gross += notional;
        sm.net += notional;
      }
    }
    const strategyExposures = Array.from(strategyMap.entries()).map(([strategyId, v]) => ({
      strategyId,
      grossNotional: formatScaled(v.gross),
      netNotional: formatScaled(v.net),
      traderId: v.traderId,
    }));

    // Trader exposures via TraderStrategy relation
    const traderExposures: PortfolioExposure['traderExposures'] = [];
    const followerExposures: PortfolioExposure['followerExposures'] = [];

    // A single quote asset is evidence only for the values actually valued in
    // that asset, not for the currency of an unrelated policy number. Every
    // contributing policy scope must explicitly bind the same unit.
    const onlyQuote = quotes.size === 1 ? [...quotes][0] : null;
    const valuationCurrency = onlyQuote && /^[A-Z0-9]{2,16}$/.test(onlyQuote) ? onlyQuote : null;
    if (policy.thresholds.maxGrossExposure != null) {
      const limitCurrency = validatedExposureCurrency(policy);
      if (!limitCurrency || (quotes.size > 0 && valuationCurrency !== limitCurrency)) unknown('POLICY_CURRENCY');
    }

    // Notional utilization
    let notionalUtilizationPercent: string | null = null;
    if (policy.thresholds.maxGrossExposure && isValidDecimalString(policy.thresholds.maxGrossExposure)) {
      const maxGross = parseScaled(policy.thresholds.maxGrossExposure);
      if (maxGross > 0n) {
        notionalUtilizationPercent = unknownPrices.length ? null : formatScaled(((totalGross + totalOpenOrder) * 100n * SCALE) / maxGross);
      }
    }

    const state = unknownPrices.length ? RiskState.UNKNOWN : this.determineExposureState(totalGross + totalOpenOrder, policy, staleSymbols);

    const sourceTimestamps: Record<string, string> = {
      positions: positions.length ? (positions[0].updatedAt?.toISOString() ?? nowIso) : nowIso,
      orders: openOrders.length ? (openOrders[0].updatedAt?.toISOString() ?? nowIso) : nowIso,
      balances: balances.length ? (balances[0].updatedAt?.toISOString() ?? nowIso) : nowIso,
      calculatedAt: nowIso,
    };

    return {
      tenantId,
      asOf: nowIso,
      policyVersion: policy.effectiveVersion,
      grossExposure,
      netExposure,
      longExposure,
      shortExposure,
      openOrderExposure,
      totalExposure,
      valuationCurrency,
      notionalUtilizationPercent,
      symbolExposures,
      venueExposures,
      accountExposures,
      strategyExposures,
      traderExposures,
      followerExposures,
      staleSymbols,
      unknownPrices,
      sourceTimestamps,
      state,
      warnings: [...(staleSymbols.length ? [`Stale market data for: ${staleSymbols.join(',')}`] : []), ...(unknownPrices.length ? [`Exposure valuation or attribution unavailable for: ${unknownPrices.join(',')}`] : [])],
    };
  }

  private determineExposureState(totalGross: bigint, policy: any, staleSymbols: string[]): RiskState {
    if (staleSymbols.length > 0) return RiskState.STALE;
    if (totalGross === 0n) return RiskState.NORMAL;
    const thresholds = policy.thresholds;
    if (thresholds.maxGrossExposure && isValidDecimalString(thresholds.maxGrossExposure)) {
      const max = parseScaled(thresholds.maxGrossExposure);
      if (totalGross > max) return RiskState.BLOCKED;
      if (totalGross > (max * 80n) / 100n) return RiskState.HIGH;
      if (totalGross > (max * 60n) / 100n) return RiskState.ELEVATED;
    }
    return RiskState.NORMAL;
  }
}
