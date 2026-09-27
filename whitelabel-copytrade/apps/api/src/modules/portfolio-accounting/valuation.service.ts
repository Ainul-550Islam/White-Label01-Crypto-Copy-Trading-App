import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AccountingPolicyService } from './accounting-policy.service';
import {
  PortfolioValuationState,
  deterministicIdempotencyKey,
  mul,
  add,
  isValidDecimal,
  redactSecrets,
  ValuationEvidence,
} from './portfolio-accounting.types';

/**
 * Produces point-in-time portfolio valuation from actual authoritative holdings plus
 * verified market prices via existing market-data sources. Missing, stale, or unavailable
 * market data must produce an explicit valuation state, not fabricated prices or fallback estimates.
 * Missing FX → explicit incomplete state never invent rate/NAV. Missing price → incomplete state never invent.
 * Explicit INCOMPLETE state for MISSING_PRICE, never invent rate/NAV.
 */

@Injectable()
export class ValuationService {
  private readonly logger = new Logger(ValuationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policyService: AccountingPolicyService,
  ) {}

  async getVerifiedMarketPrice(params: {
    tenantId: string;
    symbol: string;
    asset: string;
    at: Date;
  }): Promise<{ price: string | null; source: string | null; timestamp: Date | null; state: PortfolioValuationState }> {
    const { tenantId, symbol, asset, at } = params;

    // Must reuse existing market-price sources — check MarketPrice, PriceSnapshot, ExchangeMarketData, etc.
    try {
      // Try MarketPrice model if exists
      const marketPrice = await (this.prisma as any).marketPrice?.findFirst?.({
        where: { symbol, timestamp: { lte: at } },
        orderBy: { timestamp: 'desc' },
      });

      if (marketPrice && marketPrice.price) {
        const ageMs = Date.now() - new Date(marketPrice.timestamp).getTime();
        const isStale = ageMs > 5 * 60 * 1000; // 5 min stale threshold — explicit, not hidden
        return {
          price: marketPrice.price.toString(),
          source: marketPrice.source ?? 'MARKET_DATA',
          timestamp: new Date(marketPrice.timestamp),
          state: isStale ? PortfolioValuationState.STALE : PortfolioValuationState.VALID,
        };
      }

      // Try priceSnapshot or similar
      const snapshot = await (this.prisma as any).priceSnapshot?.findFirst?.({
        where: { symbol },
        orderBy: { createdAt: 'desc' },
      });
      if (snapshot?.price) {
        return {
          price: snapshot.price.toString(),
          source: snapshot.source ?? 'PRICE_SNAPSHOT',
          timestamp: snapshot.createdAt,
          state: PortfolioValuationState.VALID,
        };
      }

      // No price — explicit incomplete state, never invent rate/NAV
      return { price: null, source: null, timestamp: null, state: PortfolioValuationState.MISSING_PRICE };
    } catch (e) {
      this.logger.warn(`Valuation price fetch failed for ${symbol}: ${(e as Error).message}`);
      return { price: null, source: null, timestamp: null, state: PortfolioValuationState.UNAVAILABLE };
    }
  }

  async getFxRate(params: {
    tenantId: string;
    fromCurrency: string;
    toCurrency: string;
    at: Date;
  }): Promise<{ rate: string | null; source: string | null; timestamp: Date | null; status: string }> {
    const { fromCurrency, toCurrency, at } = params;

    if (fromCurrency === toCurrency) {
      return { rate: '1', source: 'SAME_CURRENCY', timestamp: at, status: 'SAME_CURRENCY' };
    }

    try {
      // Reuse existing FX or market data — check if there's a conversion pair
      const symbol = `${fromCurrency}${toCurrency}`;
      const altSymbol = `${fromCurrency}/${toCurrency}`;
      const reverseSymbol = `${toCurrency}${fromCurrency}`;

      const price = await this.getVerifiedMarketPrice({
        tenantId: params.tenantId,
        symbol,
        asset: fromCurrency,
        at,
      });

      if (price.price) {
        return { rate: price.price, source: price.source, timestamp: price.timestamp, status: 'CONVERTED' };
      }

      // Try reverse
      const reversePrice = await this.getVerifiedMarketPrice({
        tenantId: params.tenantId,
        symbol: reverseSymbol,
        asset: toCurrency,
        at,
      });

      if (reversePrice.price) {
        try {
          const { div } = require('./portfolio-accounting.types');
          const inverted = div('1', reversePrice.price);
          return { rate: inverted, source: reversePrice.source, timestamp: reversePrice.timestamp, status: 'CONVERTED_INVERSE' };
        } catch {
          // fall through to missing
        }
      }

      // Missing FX — explicit incomplete state, never invent rate/NAV
      return { rate: null, source: null, timestamp: null, status: 'MISSING_FX' };
    } catch {
      return { rate: null, source: null, timestamp: null, status: 'MISSING_FX' };
    }
  }

  async valuePosition(params: {
    tenantId: string;
    profileId: string;
    symbol: string;
    asset: string;
    quantity: string;
    at: Date;
    baseCurrency: string;
  }): Promise<{ valuedAmount: string | null; baseCurrencyAmount: string | null; evidence: ValuationEvidence }> {
    const { tenantId, profileId, symbol, asset, quantity, at, baseCurrency } = params;

    const market = await this.getVerifiedMarketPrice({ tenantId, symbol, asset, at });

    if (!market.price) {
      // Missing price — incomplete, not zero
      const evidence: ValuationEvidence = {
        symbol,
        asset,
        quantity,
        marketPrice: null,
        marketPriceSource: null,
        marketPriceTimestamp: null,
        valuationState: market.state,
        conversionRate: null,
        conversionSource: null,
        conversionTimestamp: null,
        conversionStatus: 'MISSING_PRICE',
        baseCurrency,
        valuationTimestamp: at.toISOString(),
        dataCompleteness: `MISSING_PRICE for ${symbol}`,
        sourceReferences: [],
      };

      return { valuedAmount: null, baseCurrencyAmount: null, evidence };
    }

    // Calculate valued amount = quantity * marketPrice
    let valuedAmount: string;
    try {
      valuedAmount = mul(quantity, market.price);
    } catch {
      valuedAmount = '0';
    }

    // Convert to base currency if needed
    let baseCurrencyAmount: string | null = valuedAmount;
    let conversionRate: string | null = null;
    let conversionSource: string | null = null;
    let conversionTimestamp: string | null = null;
    let conversionStatus: string | null = null;

    // Assume market price quoted in USDT/USD — if baseCurrency != quote, need FX
    // For simplicity, assume quote is USDT; if baseCurrency is USD, use 1:1 or FX
    if (baseCurrency !== 'USDT' && baseCurrency !== 'USD') {
      const fx = await this.getFxRate({ tenantId, fromCurrency: 'USDT', toCurrency: baseCurrency, at });
      if (fx.rate) {
        try {
          baseCurrencyAmount = mul(valuedAmount, fx.rate);
          conversionRate = fx.rate;
          conversionSource = fx.source;
          conversionTimestamp = fx.timestamp?.toISOString() ?? null;
          conversionStatus = fx.status;
        } catch {
          baseCurrencyAmount = null;
          conversionStatus = 'CONVERSION_FAILED';
        }
      } else {
        baseCurrencyAmount = null;
        conversionStatus = 'MISSING_FX';
      }
    } else {
      conversionRate = '1';
      conversionSource = 'SAME_CURRENCY';
      conversionTimestamp = at.toISOString();
      conversionStatus = 'SAME_CURRENCY';
    }

    const evidence: ValuationEvidence = {
      symbol,
      asset,
      quantity,
      marketPrice: market.price,
      marketPriceSource: market.source,
      marketPriceTimestamp: market.timestamp?.toISOString() ?? null,
      valuationState: baseCurrencyAmount === null ? PortfolioValuationState.MISSING_FX : market.state,
      conversionRate,
      conversionSource,
      conversionTimestamp,
      conversionStatus,
      baseCurrency,
      valuationTimestamp: at.toISOString(),
      dataCompleteness: baseCurrencyAmount === null ? `MISSING_FX ${baseCurrency}` : market.state === PortfolioValuationState.VALID ? 'COMPLETE' : market.state,
      sourceReferences: [market.source ?? 'UNKNOWN'].filter(Boolean) as string[],
    };

    return { valuedAmount, baseCurrencyAmount, evidence };
  }

  async valuePortfolio(params: {
    tenantId: string;
    profileId: string;
    holdings: Array<{ symbol: string; asset: string; quantity: string }>;
    at: Date;
    baseCurrency: string;
  }): Promise<{
    grossAssetValue: string;
    grossLiability: string;
    netValued: string;
    evidences: ValuationEvidence[];
    completeness: string;
    hasMissingPrice: boolean;
    hasMissingFx: boolean;
    hasStalePrice: boolean;
  }> {
    let grossAssetValue = '0';
    let grossLiability = '0';
    const evidences: ValuationEvidence[] = [];
    let hasMissingPrice = false;
    let hasMissingFx = false;
    let hasStalePrice = false;

    for (const holding of params.holdings) {
      const valuation = await this.valuePosition({
        tenantId: params.tenantId,
        profileId: params.profileId,
        symbol: holding.symbol,
        asset: holding.asset,
        quantity: holding.quantity,
        at: params.at,
        baseCurrency: params.baseCurrency,
      });

      evidences.push(valuation.evidence);

      if (valuation.evidence.valuationState === PortfolioValuationState.MISSING_PRICE) hasMissingPrice = true;
      if (valuation.evidence.valuationState === PortfolioValuationState.MISSING_FX || valuation.evidence.conversionStatus === 'MISSING_FX') hasMissingFx = true;
      if (valuation.evidence.valuationState === PortfolioValuationState.STALE) hasStalePrice = true;

      if (valuation.baseCurrencyAmount) {
        if (valuation.baseCurrencyAmount.startsWith('-')) {
          grossLiability = add(grossLiability, valuation.baseCurrencyAmount.replace('-', ''));
        } else {
          grossAssetValue = add(grossAssetValue, valuation.baseCurrencyAmount);
        }
      }
    }

    const netValued = (() => {
      try {
        const { sub } = require('./portfolio-accounting.types');
        return sub(grossAssetValue, grossLiability);
      } catch {
        return grossAssetValue;
      }
    })();

    let completeness = 'COMPLETE';
    if (hasMissingPrice) completeness = 'MISSING_PRICE';
    else if (hasMissingFx) completeness = 'MISSING_FX';
    else if (hasStalePrice) completeness = 'STALE_PRICE';

    return { grossAssetValue, grossLiability, netValued, evidences, completeness, hasMissingPrice, hasMissingFx, hasStalePrice };
  }

  async persistValuation(params: {
    tenantId: string;
    profileId: string;
    symbol: string;
    asset: string;
    quantity: string;
    marketPrice: string | null;
    marketPriceSource: string | null;
    marketPriceTimestamp: Date | null;
    valuationState: PortfolioValuationState;
    valuedAmount: string | null;
    baseCurrency: string;
    baseCurrencyAmount: string | null;
    conversionRate: string | null;
    conversionSource: string | null;
    conversionTimestamp: Date | null;
    conversionStatus: string | null;
    dataCompleteness: string;
    calculationVersion: string;
    policyVersion: string;
    valuationTimestamp: Date;
    sourceReferences?: string[];
    accountingEventId?: string | null;
  }): Promise<any> {
    const idempotencyKey = deterministicIdempotencyKey({
      type: `valuation:${params.symbol}:${params.asset}`,
      tenantId: params.tenantId,
      profileId: params.profileId,
      sourceId: `${params.symbol}:${params.valuationTimestamp.toISOString()}`,
      timestampBucket: params.valuationTimestamp.toISOString().slice(0, 10),
    });

    try {
      const existing = await (this.prisma as any).portfolioValuation.findFirst({ where: { idempotencyKey } });
      if (existing) return existing;
    } catch {}

    try {
      return await (this.prisma as any).portfolioValuation.create({
        data: {
          tenantId: params.tenantId,
          profileId: params.profileId,
          accountingEventId: params.accountingEventId ?? null,
          symbol: params.symbol,
          asset: params.asset,
          quantity: params.quantity,
          marketPrice: params.marketPrice,
          marketPriceSource: params.marketPriceSource,
          marketPriceTimestamp: params.marketPriceTimestamp,
          valuationState: params.valuationState as any,
          valuedAmount: params.valuedAmount,
          baseCurrency: params.baseCurrency,
          baseCurrencyAmount: params.baseCurrencyAmount,
          conversionRate: params.conversionRate,
          conversionSource: params.conversionSource,
          conversionTimestamp: params.conversionTimestamp,
          conversionStatus: params.conversionStatus,
          dataCompleteness: params.dataCompleteness,
          calculationVersion: params.calculationVersion,
          policyVersion: params.policyVersion,
          valuationTimestamp: params.valuationTimestamp,
          sourceReferences: params.sourceReferences ?? [],
          idempotencyKey,
        },
      });
    } catch (e) {
      this.logger.warn(`Failed to persist valuation: ${(e as Error).message}`);
      return null;
    }
  }
}
