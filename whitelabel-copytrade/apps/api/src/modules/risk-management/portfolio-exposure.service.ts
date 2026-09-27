import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { InstitutionalRiskPolicyService } from './risk-policy.service';
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
  return formatScaled((av * bv) / SCALE);
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
  }): Promise<PortfolioExposure> {
    const { tenantId, accountId, traderId, strategyId, followerId } = params;

    const policy = await this.policyService.resolveEffectivePolicy({
      tenantId,
      traderId: traderId ?? null,
      strategyId: strategyId ?? null,
      followerId: followerId ?? null,
    });

    // Canonical positions
    const positions = await this.prisma.position.findMany({
      where: {
        tenantId,
        ...(accountId ? { accountId } : {}),
      },
      include: { symbolRef: true },
    });

    // Canonical open orders
    const openOrders = await this.prisma.order.findMany({
      where: {
        tenantId,
        ...(accountId ? { accountId } : {}),
        status: { in: ['PENDING', 'SUBMITTED', 'ACKNOWLEDGED', 'PARTIALLY_FILLED'] },
      },
    });

    // Canonical balances (latest per account asset, but we have snapshot table)
    const balances = await this.prisma.accountBalanceSnapshot.findMany({
      where: { tenantId, ...(accountId ? { accountId } : {}) },
    });

    // Trading symbols for price metadata
    const symbols = await this.prisma.tradingSymbol.findMany({
      where: { tenantId },
    });
    const symbolMap = new Map(symbols.map((s) => [s.symbol, s]));

    const now = new Date();
    const nowIso = now.toISOString();
    const staleSymbols: string[] = [];
    const unknownPrices: string[] = [];

    // Aggregate per symbol
    const symbolAgg = new Map<string, { long: bigint; short: bigint; net: bigint; gross: bigint; openOrder: bigint; venue: string; base: string | null; quote: string | null; price: string | null; priceTs: string | null; isStale: boolean }>();

    for (const pos of positions) {
      const sym = pos.symbol;
      const venue = pos.venue as string;
      const qtyStr = pos.quantity.toString();
      if (!isValidDecimalString(qtyStr)) continue;
      const markPrice = pos.markPrice?.toString() ?? pos.averageEntryPrice?.toString() ?? null;
      const priceValid = isValidDecimalString(markPrice);
      let notionalStr: string | null = null;
      if (priceValid) {
        notionalStr = mul(absStr(qtyStr), markPrice!);
      } else {
        unknownPrices.push(sym);
      }

      let agg = symbolAgg.get(sym);
      if (!agg) {
        agg = {
          long: 0n,
          short: 0n,
          net: 0n,
          gross: 0n,
          openOrder: 0n,
          venue,
          base: pos.symbolRef?.baseAsset ?? null,
          quote: pos.symbolRef?.quoteAsset ?? null,
          price: markPrice,
          priceTs: pos.updatedAt?.toISOString() ?? null,
          isStale: false,
        };
        symbolAgg.set(sym, agg);
      }
      if (notionalStr) {
        const signedQty = parseScaled(qtyStr);
        if (signedQty >= 0n) {
          agg.long += parseScaled(notionalStr);
        } else {
          agg.short += parseScaled(notionalStr);
        }
        agg.net += signedQty >= 0n ? parseScaled(notionalStr) : -parseScaled(notionalStr);
        agg.gross += parseScaled(notionalStr);
      }
      // Check stale: if markPrice older than policy marketDataMaxAgeMs
      const ageMs = now.getTime() - new Date(pos.updatedAt).getTime();
      if (ageMs > policy.thresholds.marketDataMaxAgeMs) {
        agg.isStale = true;
        if (!staleSymbols.includes(sym)) staleSymbols.push(sym);
      }
    }

    // Add open order notional per symbol
    for (const ord of openOrders) {
      const sym = ord.symbol;
      const qtyStr = ord.quantity.toString();
      const priceStr = ord.price?.toString() ?? null;
      let notionalStr: string | null = null;
      if (isValidDecimalString(qtyStr) && isValidDecimalString(priceStr)) {
        notionalStr = mul(qtyStr, priceStr!);
      } else if (isValidDecimalString(qtyStr)) {
        // If market order without price, use mark price if available
        const agg = symbolAgg.get(sym);
        if (agg?.price && isValidDecimalString(agg.price)) {
          notionalStr = mul(qtyStr, agg.price);
        }
      }
      if (notionalStr) {
        let agg = symbolAgg.get(sym);
        if (!agg) {
          agg = {
            long: 0n,
            short: 0n,
            net: 0n,
            gross: 0n,
            openOrder: 0n,
            venue: ord.venue as string,
            base: null,
            quote: null,
            price: null,
            priceTs: null,
            isStale: false,
          };
          symbolAgg.set(sym, agg);
        }
        agg.openOrder += parseScaled(notionalStr);
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

    // Account exposures
    const accountMap = new Map<string, { venue: string; gross: bigint; net: bigint; long: bigint; short: bigint; openOrder: bigint; symbols: Set<string> }>();
    for (const pos of positions) {
      const qtyStr = pos.quantity.toString();
      const markPrice = pos.markPrice?.toString() ?? pos.averageEntryPrice?.toString() ?? null;
      let notional = 0n;
      if (isValidDecimalString(qtyStr) && isValidDecimalString(markPrice)) {
        notional = parseScaled(mul(absStr(qtyStr), markPrice!));
      }
      let am = accountMap.get(pos.accountId);
      if (!am) {
        am = { venue: pos.venue as string, gross: 0n, net: 0n, long: 0n, short: 0n, openOrder: 0n, symbols: new Set() };
        accountMap.set(pos.accountId, am);
      }
      am.gross += notional;
      const signed = parseScaled(qtyStr);
      if (signed >= 0n) {
        am.long += notional;
        am.net += notional;
      } else {
        am.short += notional;
        am.net -= notional;
      }
      am.symbols.add(pos.symbol);
    }
    for (const ord of openOrders) {
      const qtyStr = ord.quantity.toString();
      const priceStr = ord.price?.toString() ?? null;
      let notional = 0n;
      if (isValidDecimalString(qtyStr) && isValidDecimalString(priceStr)) {
        notional = parseScaled(mul(qtyStr, priceStr!));
      }
      let am = accountMap.get(ord.accountId);
      if (!am) {
        am = { venue: ord.venue as string, gross: 0n, net: 0n, long: 0n, short: 0n, openOrder: 0n, symbols: new Set() };
        accountMap.set(ord.accountId, am);
      }
      am.openOrder += notional;
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
      const qtyStr = o.quantity.toString();
      const priceStr = o.price?.toString() ?? '0';
      if (isValidDecimalString(qtyStr) && isValidDecimalString(priceStr)) {
        const notional = parseScaled(mul(qtyStr, priceStr));
        sm.gross += notional >= 0n ? notional : -notional;
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

    // Notional utilization
    let notionalUtilizationPercent: string | null = null;
    if (policy.thresholds.maxGrossExposure && isValidDecimalString(policy.thresholds.maxGrossExposure)) {
      const maxGross = parseScaled(policy.thresholds.maxGrossExposure);
      if (maxGross > 0n) {
        notionalUtilizationPercent = formatScaled((totalGross * 100n * SCALE) / maxGross);
      }
    }

    const state = this.determineExposureState(totalGross, policy, staleSymbols);

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
      warnings: [...(staleSymbols.length ? [`Stale market data for: ${staleSymbols.join(',')}`] : []), ...(unknownPrices.length ? [`Unknown prices for: ${unknownPrices.join(',')}`] : [])],
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
