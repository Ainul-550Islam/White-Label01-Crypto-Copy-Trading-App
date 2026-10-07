// # Responsibility: computes caller- or profile-owner-scoped exposure from live non-simulated accounts using fresh instrument-linked candle evidence.

import { Injectable, Logger } from '@nestjs/common';
import type { TradingVenue } from '@prisma/client';
import { DECIMAL_SCALE, formatDecimalString, isDecimalString, multiplyDecimalStrings, parseDecimalString } from '../../common/decimal-string';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { InstitutionalRiskPolicyService } from './risk-policy.service';
import {
  CustomerExposureLine,
  CustomerExposureQuoteTotal,
  CustomerExposureScope,
  CustomerExposureState,
  CustomerExposureValueState,
  CustomerExposureView,
} from './customer-exposure.types';

type InstrumentReference = {
  symbolId: string;
  symbol: string;
  venue: TradingVenue;
  marketType: string | null;
  baseAsset: string | null;
  quoteAsset: string | null;
};

type MarketPriceReference = {
  state: CustomerExposureValueState;
  price: string | null;
  timestamp: string | null;
};

type CommitmentBasis = 'ORDER_PRICE' | 'MARKET_DATA_1M_CANDLE_CLOSE';

type MutableExposure = InstrumentReference & {
  hasPosition: boolean;
  invalidPositionQuantity: boolean;
  incompletePositionValuation: boolean;
  longQuantity: bigint;
  shortQuantity: bigint;
  netQuantity: bigint;
  longNotional: bigint;
  shortNotional: bigint;
  positionState: CustomerExposureValueState | null;
  price: string | null;
  priceTimestamp: string | null;
  hasOpenOrders: boolean;
  openOrderCount: number;
  invalidOpenOrder: boolean;
  openOrderCommitmentIncomplete: boolean;
  openOrderCommitment: bigint;
  openOrderState: CustomerExposureValueState | null;
  commitmentBases: Set<CommitmentBasis>;
};

function decimalText(value: unknown): string | null {
  if (typeof value === 'string') return isDecimalString(value) ? value.trim() : null;
  if (value && typeof value === 'object' && typeof (value as { toString?: unknown }).toString === 'function') {
    const text = (value as { toString(): string }).toString();
    return isDecimalString(text) ? text.trim() : null;
  }
  return null;
}

function positiveDecimal(value: string | null): boolean {
  return value !== null && parseDecimalString(value) > 0n;
}

function quantityUsesBaseAssetUnits(marketType: string | null): boolean {
  // The persisted model does not carry a contract multiplier. Spot and margin
  // quantities are base-asset units; derivative contract quantities therefore
  // remain UNKNOWN rather than being multiplied by price as if they were coins.
  return marketType === 'SPOT' || marketType === 'MARGIN';
}

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function decimalFromScaled(value: bigint): string {
  return formatDecimalString(value, DECIMAL_SCALE);
}

function identityKey(reference: Pick<InstrumentReference, 'symbolId' | 'venue'>): string {
  return `${reference.venue}:${reference.symbolId}`;
}

function combineState(
  left: CustomerExposureValueState | null,
  right: CustomerExposureValueState,
): CustomerExposureValueState {
  if (left === 'UNKNOWN' || right === 'UNKNOWN') return 'UNKNOWN';
  if (left === 'STALE' || right === 'STALE') return 'STALE';
  return 'CURRENT';
}

function combinedValueState(states: readonly CustomerExposureValueState[]): CustomerExposureValueState {
  if (states.includes('UNKNOWN')) return 'UNKNOWN';
  if (states.includes('STALE')) return 'STALE';
  return 'CURRENT';
}

function overallState(states: readonly CustomerExposureValueState[]): CustomerExposureState {
  if (states.length === 0) return 'EMPTY';
  return combinedValueState(states);
}

function referenceFrom(row: {
  symbolId: string;
  symbol: string;
  venue: TradingVenue;
  symbolRef?: { marketType?: string | null; baseAsset?: string | null; quoteAsset?: string | null } | null;
}): InstrumentReference {
  return {
    symbolId: row.symbolId,
    symbol: row.symbol,
    venue: row.venue,
    marketType: row.symbolRef?.marketType ?? null,
    baseAsset: row.symbolRef?.baseAsset ?? null,
    quoteAsset: row.symbolRef?.quoteAsset ?? null,
  };
}

function createMutableExposure(reference: InstrumentReference): MutableExposure {
  return {
    ...reference,
    hasPosition: false,
    invalidPositionQuantity: false,
    incompletePositionValuation: false,
    longQuantity: 0n,
    shortQuantity: 0n,
    netQuantity: 0n,
    longNotional: 0n,
    shortNotional: 0n,
    positionState: null,
    price: null,
    priceTimestamp: null,
    hasOpenOrders: false,
    openOrderCount: 0,
    invalidOpenOrder: false,
    openOrderCommitmentIncomplete: false,
    openOrderCommitment: 0n,
    openOrderState: null,
    commitmentBases: new Set<CommitmentBasis>(),
  };
}

@Injectable()
export class CustomerExposureService {
  private readonly logger = new Logger(CustomerExposureService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policyService: InstitutionalRiskPolicyService,
  ) {}

  async calculateMyExposure(params: { tenantId: string; userId: string }): Promise<CustomerExposureView> {
    return this.calculateForOwner({
      tenantId: params.tenantId,
      userId: params.userId,
      traderId: null,
      dataScope: 'SIGNED_IN_USER_NON_SANDBOX_NON_SIMULATED_ACCOUNTS',
    });
  }

  async calculateTraderExposure(params: {
    tenantId: string;
    traderId: string;
    userId: string;
  }): Promise<CustomerExposureView | null> {
    const profile = await this.prisma.traderProfile.findFirst({
      where: {
        id: params.traderId,
        tenantId: params.tenantId,
        userId: params.userId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!profile) return null;

    return this.calculateForOwner({
      tenantId: params.tenantId,
      userId: params.userId,
      traderId: params.traderId,
      dataScope: 'TRADER_PROFILE_OWNER_NON_SANDBOX_NON_SIMULATED_ACCOUNTS',
    });
  }

  private async calculateForOwner(params: {
    tenantId: string;
    userId: string;
    traderId: string | null;
    dataScope: CustomerExposureScope;
  }): Promise<CustomerExposureView> {
    const { tenantId, userId, traderId, dataScope } = params;

    const accounts = await this.prisma.tradingAccount.findMany({
      where: {
        tenantId,
        userId,
        deletedAt: null,
        isSandbox: false,
      },
      select: { id: true },
    });
    const accountIds = accounts.map((account: { id: string }) => account.id);

    if (accountIds.length === 0) {
      return this.emptyView(tenantId, 0, traderId, dataScope);
    }

    const [positions, openOrders, policy] = await Promise.all([
      this.prisma.position.findMany({
        where: {
          tenantId,
          accountId: { in: accountIds },
          containsSimulatedFills: false,
        },
        select: {
          symbolId: true,
          symbol: true,
          venue: true,
          quantity: true,
          symbolRef: { select: { marketType: true, baseAsset: true, quoteAsset: true } },
        },
      }),
      this.prisma.order.findMany({
        where: {
          tenantId,
          accountId: { in: accountIds },
          isSimulated: false,
          status: { in: ['PENDING', 'SUBMITTED', 'ACKNOWLEDGED', 'PARTIALLY_FILLED', 'CANCEL_REQUESTED'] },
        },
        select: {
          symbolId: true,
          symbol: true,
          venue: true,
          side: true,
          orderType: true,
          quantity: true,
          filledQuantity: true,
          price: true,
          symbolRef: { select: { marketType: true, baseAsset: true, quoteAsset: true } },
        },
      }),
      this.policyService.resolveEffectivePolicy({
        tenantId,
        traderId: null,
        strategyId: null,
        followerId: null,
      }),
    ]);

    const now = new Date();
    const asOf = now.toISOString();
    const maxAgeMs = policy.thresholds.marketDataMaxAgeMs;
    const mutable = new Map<string, MutableExposure>();
    const marketLookups = new Map<string, InstrumentReference>();

    const getMutable = (reference: InstrumentReference): MutableExposure => {
      const key = identityKey(reference);
      let exposure = mutable.get(key);
      if (!exposure) {
        exposure = createMutableExposure(reference);
        mutable.set(key, exposure);
      }
      return exposure;
    };

    for (const position of positions) {
      const reference = referenceFrom(position);
      const key = identityKey(reference);
      marketLookups.set(key, reference);
    }

    for (const order of openOrders) {
      const reference = referenceFrom(order);
      const key = identityKey(reference);
      const orderPrice = decimalText(order.price);
      if (orderPrice === null) marketLookups.set(key, reference);
    }

    const priceReferences = await this.loadFreshMarketPrices({
      instruments: Array.from(marketLookups.entries()),
      tenantId,
      asOf: now,
      maxAgeMs,
    });

    for (const position of positions) {
      const reference = referenceFrom(position);
      const exposure = getMutable(reference);
      const quantity = decimalText(position.quantity);
      if (quantity === null) {
        exposure.hasPosition = true;
        exposure.invalidPositionQuantity = true;
        exposure.incompletePositionValuation = true;
        exposure.positionState = combineState(exposure.positionState, 'UNKNOWN');
        continue;
      }

      const signedQuantity = parseDecimalString(quantity);
      if (signedQuantity === 0n) continue;
      exposure.hasPosition = true;
      exposure.netQuantity += signedQuantity;
      if (signedQuantity > 0n) exposure.longQuantity += signedQuantity;
      else exposure.shortQuantity += absolute(signedQuantity);
      if (!quantityUsesBaseAssetUnits(reference.marketType)) {
        exposure.positionState = combineState(exposure.positionState, 'UNKNOWN');
        exposure.incompletePositionValuation = true;
        continue;
      }

      const referenceKey = identityKey(reference);
      const market = priceReferences.get(referenceKey) ?? { state: 'UNKNOWN', price: null, timestamp: null };
      const quoteAssetValid = typeof reference.quoteAsset === 'string' && reference.quoteAsset.trim().length > 0;
      if (market.state !== 'CURRENT' || market.price === null || !quoteAssetValid) {
        const state = quoteAssetValid ? market.state : 'UNKNOWN';
        exposure.positionState = combineState(exposure.positionState, state);
        exposure.incompletePositionValuation = true;
        if (market.timestamp && (!exposure.priceTimestamp || market.timestamp > exposure.priceTimestamp)) {
          exposure.priceTimestamp = market.timestamp;
        }
        continue;
      }

      const notional = multiplyDecimalStrings(absolute(signedQuantity), parseDecimalString(market.price));
      if (signedQuantity > 0n) exposure.longNotional += notional;
      else exposure.shortNotional += notional;
      exposure.positionState = combineState(exposure.positionState, 'CURRENT');
      exposure.price = market.price;
      if (market.timestamp && (!exposure.priceTimestamp || market.timestamp > exposure.priceTimestamp)) {
        exposure.priceTimestamp = market.timestamp;
      }
    }

    for (const order of openOrders) {
      const reference = referenceFrom(order);
      const exposure = getMutable(reference);
      exposure.hasOpenOrders = true;
      exposure.openOrderCount += 1;

      const quantity = decimalText(order.quantity);
      const filledQuantity = decimalText(order.filledQuantity);
      if (quantity === null || filledQuantity === null) {
        exposure.invalidOpenOrder = true;
        exposure.openOrderCommitmentIncomplete = true;
        exposure.openOrderState = combineState(exposure.openOrderState, 'UNKNOWN');
        continue;
      }

      const quantityScaled = parseDecimalString(quantity);
      const filledScaled = parseDecimalString(filledQuantity);
      if (quantityScaled <= 0n || filledScaled < 0n || filledScaled > quantityScaled) {
        exposure.invalidOpenOrder = true;
        exposure.openOrderCommitmentIncomplete = true;
        exposure.openOrderState = combineState(exposure.openOrderState, 'UNKNOWN');
        continue;
      }
      const remainingQuantity = quantityScaled - filledScaled;
      if (remainingQuantity === 0n) {
        exposure.openOrderCount -= 1;
        if (exposure.openOrderCount === 0) exposure.hasOpenOrders = false;
        continue;
      }

      if (!reference.quoteAsset || !quantityUsesBaseAssetUnits(reference.marketType)) {
        exposure.invalidOpenOrder = true;
        exposure.openOrderCommitmentIncomplete = true;
        exposure.openOrderState = combineState(exposure.openOrderState, 'UNKNOWN');
        continue;
      }

      const orderPrice = decimalText(order.price);
      let commitmentPrice: string | null = null;
      let basis: CommitmentBasis | null = null;
      if (orderPrice !== null && positiveDecimal(orderPrice)) {
        commitmentPrice = orderPrice;
        basis = 'ORDER_PRICE';
      } else if (order.price === null && ['MARKET', 'STOP'].includes(String(order.orderType))) {
        const market = priceReferences.get(identityKey(reference)) ?? { state: 'UNKNOWN', price: null, timestamp: null };
        if (market.state !== 'CURRENT' || market.price === null) {
          exposure.openOrderState = combineState(exposure.openOrderState, market.state);
          exposure.openOrderCommitmentIncomplete = true;
          if (market.timestamp && (!exposure.priceTimestamp || market.timestamp > exposure.priceTimestamp)) {
            exposure.priceTimestamp = market.timestamp;
          }
          continue;
        }
        commitmentPrice = market.price;
        basis = 'MARKET_DATA_1M_CANDLE_CLOSE';
        exposure.price = market.price;
        if (market.timestamp && (!exposure.priceTimestamp || market.timestamp > exposure.priceTimestamp)) {
          exposure.priceTimestamp = market.timestamp;
        }
      } else {
        exposure.invalidOpenOrder = true;
        exposure.openOrderCommitmentIncomplete = true;
        exposure.openOrderState = combineState(exposure.openOrderState, 'UNKNOWN');
        continue;
      }

      const commitment = multiplyDecimalStrings(remainingQuantity, parseDecimalString(commitmentPrice));
      exposure.openOrderCommitment += commitment;
      exposure.openOrderState = combineState(exposure.openOrderState, 'CURRENT');
      if (basis) exposure.commitmentBases.add(basis);
    }

    const lines = Array.from(mutable.values())
      .filter((exposure) => exposure.hasPosition || exposure.hasOpenOrders)
      .map((exposure) => this.toLine(exposure))
      .sort((left, right) => {
        const venueOrder = left.venue.localeCompare(right.venue);
        if (venueOrder !== 0) return venueOrder;
        const symbolOrder = left.symbol.localeCompare(right.symbol);
        if (symbolOrder !== 0) return symbolOrder;
        return (left.marketType ?? '').localeCompare(right.marketType ?? '');
      });

    const totalsByQuoteAsset = this.calculateQuoteTotals(lines);
    const state = overallState(lines.map((line) => line.state));
    const staleSymbols = Array.from(new Set(
      lines.filter((line) => line.positionState === 'STALE' || line.openOrderState === 'STALE')
        .map((line) => `${line.venue}:${line.symbol}`),
    )).sort();
    const unknownSymbols = Array.from(new Set(
      lines.filter((line) => line.positionState === 'UNKNOWN' || line.openOrderState === 'UNKNOWN')
        .map((line) => `${line.venue}:${line.symbol}`),
    )).sort();

    return {
      tenantId,
      traderId,
      asOf,
      state,
      eligibleAccountCount: accountIds.length,
      lines,
      totalsByQuoteAsset,
      staleSymbols,
      unknownSymbols,
      dataScope,
      simulatedRecordsIncluded: false,
      cashBalancesIncluded: false,
      currencyTreatment: 'SEPARATE_QUOTE_ASSETS_NO_FX_CONVERSION',
      priceMethodology: 'LATEST_1M_CANDLE_CLOSE_WITH_POLICY_FRESHNESS',
      notice: 'Positions use the latest tenant-instrument-linked 1-minute candle close only while it meets the effective market-data freshness policy. This is a reference valuation, not an exchange mark price. Stale or missing prices withhold affected notionals and quote-currency totals. Derivative contract notionals remain UNKNOWN because no authoritative contract multiplier is stored. Cash balances, FX conversion, PnL, margin and liquidation values are not included; open-order commitments are shown separately and never netted against positions.',
    };
  }

  private async loadFreshMarketPrices(params: {
    instruments: Array<[string, InstrumentReference]>;
    tenantId: string;
    asOf: Date;
    maxAgeMs: number;
  }): Promise<Map<string, MarketPriceReference>> {
    const { instruments, tenantId, asOf, maxAgeMs } = params;
    const results = await Promise.all(instruments.map(async ([key, instrument]) => {
      if (!Number.isFinite(maxAgeMs) || maxAgeMs < 0) {
        return [key, { state: 'UNKNOWN', price: null, timestamp: null } as MarketPriceReference] as const;
      }

      try {
        const candle = await this.prisma.marketDataRecord.findFirst({
          where: {
            symbolId: instrument.symbolId,
            venue: instrument.venue,
            interval: '1m',
            closeTime: { lte: asOf },
          },
          orderBy: { closeTime: 'desc' },
          select: { symbolId: true, venue: true, interval: true, close: true, closeTime: true },
        });

        if (!candle
          || candle.symbolId !== instrument.symbolId
          || candle.venue !== instrument.venue
          || candle.interval !== '1m'
          || !(candle.closeTime instanceof Date)
          || !Number.isFinite(candle.closeTime.getTime())) {
          return [key, { state: 'UNKNOWN', price: null, timestamp: null } as MarketPriceReference] as const;
        }

        const timestamp = candle.closeTime.toISOString();
        const ageMs = asOf.getTime() - candle.closeTime.getTime();
        const price = decimalText(candle.close);
        if (ageMs < 0 || price === null || !positiveDecimal(price)) {
          return [key, { state: 'UNKNOWN', price: null, timestamp } as MarketPriceReference] as const;
        }
        if (ageMs > maxAgeMs) {
          return [key, { state: 'STALE', price: null, timestamp } as MarketPriceReference] as const;
        }
        return [key, { state: 'CURRENT', price, timestamp } as MarketPriceReference] as const;
      } catch {
        this.logger.warn(`Customer exposure market-data lookup unavailable for tenant ${tenantId}; valuation withheld.`);
        return [key, { state: 'UNKNOWN', price: null, timestamp: null } as MarketPriceReference] as const;
      }
    }));

    return new Map(results);
  }

  private toLine(exposure: MutableExposure): CustomerExposureLine {
    const positionState = exposure.hasPosition
      ? exposure.invalidPositionQuantity
        ? 'UNKNOWN'
        : exposure.positionState ?? 'UNKNOWN'
      : 'NO_POSITION';
    const openOrderState = exposure.hasOpenOrders
      ? exposure.openOrderState ?? 'UNKNOWN'
      : 'NO_OPEN_ORDERS';
    const relevantStates: CustomerExposureValueState[] = [
      ...(positionState === 'NO_POSITION' ? [] : [positionState]),
      ...(openOrderState === 'NO_OPEN_ORDERS' ? [] : [openOrderState]),
    ];
    const lineState: CustomerExposureValueState = relevantStates.length === 0
      ? 'UNKNOWN'
      : combinedValueState(relevantStates);
    const positionValuesAvailable = exposure.hasPosition
      && !exposure.invalidPositionQuantity
      && !exposure.incompletePositionValuation
      && positionState === 'CURRENT';
    const openOrderValueAvailable = !exposure.hasOpenOrders
      || (!exposure.invalidOpenOrder && !exposure.openOrderCommitmentIncomplete && openOrderState === 'CURRENT');

    const longQuantity = exposure.invalidPositionQuantity ? null : decimalFromScaled(exposure.longQuantity);
    const shortQuantity = exposure.invalidPositionQuantity ? null : decimalFromScaled(exposure.shortQuantity);
    const netQuantity = exposure.invalidPositionQuantity ? null : decimalFromScaled(exposure.netQuantity);
    const longPositionNotional = exposure.hasPosition
      ? positionValuesAvailable ? decimalFromScaled(exposure.longNotional) : null
      : '0';
    const shortPositionNotional = exposure.hasPosition
      ? positionValuesAvailable ? decimalFromScaled(exposure.shortNotional) : null
      : '0';
    const grossPositionNotional = exposure.hasPosition
      ? positionValuesAvailable ? decimalFromScaled(exposure.longNotional + exposure.shortNotional) : null
      : '0';
    const netPositionNotional = exposure.hasPosition
      ? positionValuesAvailable ? decimalFromScaled(exposure.longNotional - exposure.shortNotional) : null
      : '0';
    const openOrderCommitment = exposure.hasOpenOrders
      ? openOrderValueAvailable ? decimalFromScaled(exposure.openOrderCommitment) : null
      : '0';
    const totalNotional = positionValuesAvailable || !exposure.hasPosition
      ? openOrderValueAvailable
        ? decimalFromScaled((exposure.longNotional + exposure.shortNotional) + exposure.openOrderCommitment)
        : null
      : null;

    const bases = Array.from(exposure.commitmentBases);
    const openOrderCommitmentBasis = bases.length === 0
      ? null
      : bases.length === 1
        ? bases[0]
        : 'MIXED';

    return {
      symbol: exposure.symbol,
      venue: exposure.venue,
      marketType: exposure.marketType,
      baseAsset: exposure.baseAsset,
      quoteAsset: exposure.quoteAsset,
      longQuantity,
      shortQuantity,
      netQuantity,
      longPositionNotional,
      shortPositionNotional,
      grossPositionNotional,
      netPositionNotional,
      openOrderCommitment,
      totalNotional,
      openOrderCount: exposure.openOrderCount,
      openOrderCommitmentBasis,
      price: exposure.price,
      priceSource: exposure.price === null ? null : 'MARKET_DATA_1M_CANDLE_CLOSE',
      priceTimestamp: exposure.priceTimestamp,
      positionState,
      openOrderState,
      state: lineState,
    };
  }

  private calculateQuoteTotals(lines: CustomerExposureLine[]): CustomerExposureQuoteTotal[] {
    const groups = new Map<string, CustomerExposureLine[]>();
    for (const line of lines) {
      if (!line.quoteAsset) continue;
      const existing = groups.get(line.quoteAsset) ?? [];
      existing.push(line);
      groups.set(line.quoteAsset, existing);
    }

    return Array.from(groups.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([quoteAsset, quoteLines]) => {
        const state: CustomerExposureValueState = combinedValueState(quoteLines.map((line) => line.state));
        if (state !== 'CURRENT') {
          return {
            quoteAsset,
            longPositionNotional: null,
            shortPositionNotional: null,
            grossPositionNotional: null,
            openOrderCommitment: null,
            totalNotional: null,
            state,
          };
        }

        const sum = (values: Array<string | null>): bigint | null => {
          if (values.some((value) => value === null)) return null;
          return values.reduce((total, value) => total + parseDecimalString(value as string), 0n);
        };
        const longPositionNotional = sum(quoteLines.map((line) => line.longPositionNotional));
        const shortPositionNotional = sum(quoteLines.map((line) => line.shortPositionNotional));
        const grossPositionNotional = sum(quoteLines.map((line) => line.grossPositionNotional));
        const openOrderCommitment = sum(quoteLines.map((line) => line.openOrderCommitment));
        if (longPositionNotional === null || shortPositionNotional === null
          || grossPositionNotional === null || openOrderCommitment === null) {
          return {
            quoteAsset,
            longPositionNotional: null,
            shortPositionNotional: null,
            grossPositionNotional: null,
            openOrderCommitment: null,
            totalNotional: null,
            state: 'UNKNOWN',
          };
        }

        return {
          quoteAsset,
          longPositionNotional: decimalFromScaled(longPositionNotional),
          shortPositionNotional: decimalFromScaled(shortPositionNotional),
          grossPositionNotional: decimalFromScaled(grossPositionNotional),
          openOrderCommitment: decimalFromScaled(openOrderCommitment),
          totalNotional: decimalFromScaled(grossPositionNotional + openOrderCommitment),
          state,
        };
      });
  }

  private emptyView(
    tenantId: string,
    eligibleAccountCount: number,
    traderId: string | null,
    dataScope: CustomerExposureScope,
  ): CustomerExposureView {
    return {
      tenantId,
      traderId,
      asOf: new Date().toISOString(),
      state: 'EMPTY',
      lines: [],
      totalsByQuoteAsset: [],
      staleSymbols: [],
      unknownSymbols: [],
      eligibleAccountCount,
      dataScope,
      simulatedRecordsIncluded: false,
      cashBalancesIncluded: false,
      currencyTreatment: 'SEPARATE_QUOTE_ASSETS_NO_FX_CONVERSION',
      priceMethodology: 'LATEST_1M_CANDLE_CLOSE_WITH_POLICY_FRESHNESS',
      notice: 'No non-simulated open positions or open orders were found in the owner-scoped non-deleted, non-sandbox exchange accounts. No cash balance, PnL, margin or cross-currency total is implied.',
    };
  }
}
