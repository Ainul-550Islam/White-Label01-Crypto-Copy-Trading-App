// # Responsibility: values a tenant's persisted positions per quote asset, exactly, and reports UNAVAILABLE rather than a total it cannot support.
//
// This is the input GAP-60 was missing. The allocation preview took its `totalValue` from the
// request body - the customer's own number, marked CLIENT_SUPPLIED_UNVERIFIED - so the arithmetic
// was exact and the figure it started from was whatever the caller typed. A persisted valuation
// gives the same calculation a real basis.
//
// Three rules, all of them consequences of what this value is used for:
//
//   1. Positions are summed per quote asset and never across them. `BTC-USDT` and `ETH-BTC` are not
//      the same money, and there is no FX rate here to convert between them - inventing one would
//      manufacture a number out of nothing.
//   2. A position without a mark price contributes nothing and makes its group UNAVAILABLE. It is
//      not valued at its entry price (that is a different claim about the position) and not at zero
//      (that is a claim it is worthless).
//   3. Simulated positions are excluded unless explicitly requested. A paper position presented as
//      real portfolio value is the most expensive kind of wrong number.
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { formatDecimalString, parseDecimalString } from '../../common/decimal-string';

export interface QuoteAssetValuation {
  quoteAsset: string;
  /** Exact sum of quantity x mark price over the priced positions, or null when unavailable. */
  totalValue: string | null;
  state: 'AVAILABLE' | 'UNAVAILABLE';
  positionCount: number;
  pricedPositionCount: number;
  /** Symbols in this group with no mark price, for which no value was assumed. */
  symbolsWithoutMarkPrice: string[];
  reason: string | null;
}

export interface PersistedPortfolioValuation {
  provenance: 'PERSISTED_PORTFOLIO_VALUATION';
  state: 'AVAILABLE' | 'UNAVAILABLE';
  /** The requested group, when one was requested; null when the whole portfolio was summarised. */
  requestedQuoteAsset: string | null;
  quoteAssets: QuoteAssetValuation[];
  /** Newest `updatedAt` among contributing positions, or null when nothing contributed. */
  asOf: string | null;
  excluded: { simulatedPositions: number; positionsWithoutMarkPrice: number };
  reason: string | null;
}

/** Value scales: the column is Decimal(28,12), so twelve places is exact for both inputs and output. */
const POSITION_SCALE = 12;

/**
 * The quote asset of a symbol. Venues write pairs as BASE-QUOTE (`BTC-USDT`), `BASE/QUOTE`
 * (`BTC/USDT`) or concatenated (`BTCUSDT`). The concatenated form cannot be split reliably without
 * a quote-asset list, so it is returned as the whole symbol: an un-split symbol stays its own group
 * rather than being assigned to a guess, which keeps rule 1 intact.
 */
export function quoteAssetOf(symbol: string): string {
  const upper = symbol.toUpperCase();
  const separator = upper.includes('-') ? '-' : upper.includes('/') ? '/' : null;
  if (!separator) return upper;
  const parts = upper.split(separator);
  return parts.length >= 2 && parts[1] ? parts[1] : upper;
}

@Injectable()
export class AllocationValuationRepository {
  private readonly logger = new Logger(AllocationValuationRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reads the tenant's persisted positions and values them per quote asset.
   *
   * A database error is not an empty portfolio: `state` is UNAVAILABLE with the reason, because the
   * caller is about to compute allocations from this number and a zero total would produce an
   * allocation preview of zero.
   */
  async loadPersistedPortfolioValuation(input: {
    tenantId: string;
    quoteAsset?: string | null;
    accountId?: string | null;
    includeSimulated?: boolean;
  }): Promise<PersistedPortfolioValuation> {
    const includeSimulated = input.includeSimulated === true;
    const requested = input.quoteAsset ? input.quoteAsset.toUpperCase() : null;

    let rows: Array<{
      symbol: string;
      quantity: unknown;
      markPrice: unknown;
      containsSimulatedFills: boolean;
      updatedAt: Date | string;
    }>;

    try {
      rows = (await this.prisma.position.findMany({
        where: {
          tenantId: input.tenantId,
          ...(input.accountId ? { accountId: input.accountId } : {}),
          ...(includeSimulated ? {} : { containsSimulatedFills: false }),
        },
        select: { symbol: true, quantity: true, markPrice: true, containsSimulatedFills: true, updatedAt: true },
        take: 2000,
      })) as unknown as typeof rows;
    } catch (error) {
      this.logger.error(`portfolio valuation read failed tenant=${input.tenantId} reason=${this.safeReason(error)}`);
      return {
        provenance: 'PERSISTED_PORTFOLIO_VALUATION',
        state: 'UNAVAILABLE',
        requestedQuoteAsset: requested,
        quoteAssets: [],
        asOf: null,
        excluded: { simulatedPositions: 0, positionsWithoutMarkPrice: 0 },
        reason: 'Persisted positions could not be read; no portfolio value is available.',
      };
    }

    const simulatedExcluded = includeSimulated ? 0 : rows.filter((row) => row.containsSimulatedFills === true).length;
    const considered = rows.filter((row) => includeSimulated || row.containsSimulatedFills !== true);

    const groups = new Map<string, typeof considered>();
    for (const row of considered) {
      const quote = quoteAssetOf(row.symbol);
      const bucket = groups.get(quote);
      if (bucket) bucket.push(row);
      else groups.set(quote, [row]);
    }

    const quoteAssets: QuoteAssetValuation[] = [];
    let newestUpdate: Date | null = null;
    let positionsWithoutMarkPrice = 0;

    for (const [quoteAsset, positions] of groups) {
      if (requested && quoteAsset !== requested) continue;

      const symbolsWithoutMarkPrice: string[] = [];
      let total = 0n; // scale-12 units
      let priced = 0;

      for (const position of positions) {
        if (position.markPrice === null || position.markPrice === undefined) {
          symbolsWithoutMarkPrice.push(position.symbol);
          positionsWithoutMarkPrice += 1;
          continue;
        }
        try {
          // quantity x markPrice, both Decimal(28,12) from the database. `String(...)` then
          // `parseDecimalString` is the exact path: a Decimal column is not a JS number and must
          // never be one, and the product of two scale-12 values lands on scale 12 after the
          // division by the factor.
          const quantity = parseDecimalString(String(position.quantity ?? '0'));
          const mark = parseDecimalString(String(position.markPrice));
          if (mark <= 0n) {
            symbolsWithoutMarkPrice.push(position.symbol);
            positionsWithoutMarkPrice += 1;
            continue;
          }
          total += (quantity * mark) / 10n ** BigInt(POSITION_SCALE);
          priced += 1;
          const updatedAt = position.updatedAt instanceof Date ? position.updatedAt : new Date(String(position.updatedAt));
          if (!Number.isNaN(updatedAt.getTime()) && (newestUpdate === null || updatedAt > newestUpdate)) {
            newestUpdate = updatedAt;
          }
        } catch (error) {
          // An unparseable quantity or mark price is not a zero: the position is left out of the
          // total and the group is reported unavailable.
          this.logger.warn(`position ${position.symbol} could not be valued: ${this.safeReason(error)}`);
          symbolsWithoutMarkPrice.push(position.symbol);
          positionsWithoutMarkPrice += 1;
        }
      }

      const state: QuoteAssetValuation['state'] = symbolsWithoutMarkPrice.length === 0 ? 'AVAILABLE' : 'UNAVAILABLE';
      quoteAssets.push({
        quoteAsset,
        totalValue: state === 'AVAILABLE' ? formatDecimalString(total, POSITION_SCALE) : null,
        state,
        positionCount: positions.length,
        pricedPositionCount: priced,
        symbolsWithoutMarkPrice,
        reason:
          state === 'AVAILABLE'
            ? null
            : `${symbolsWithoutMarkPrice.length} position(s) have no usable mark price, so no total is reported for ${quoteAsset}.`,
      });
    }

    quoteAssets.sort((left, right) => left.quoteAsset.localeCompare(right.quoteAsset));

    const requestedGroup = requested ? quoteAssets.find((group) => group.quoteAsset === requested) ?? null : null;
    if (requested && !requestedGroup) {
      return {
        provenance: 'PERSISTED_PORTFOLIO_VALUATION',
        state: 'UNAVAILABLE',
        requestedQuoteAsset: requested,
        quoteAssets,
        asOf: null,
        excluded: { simulatedPositions: simulatedExcluded, positionsWithoutMarkPrice },
        reason: `No persisted positions are denominated in ${requested}.`,
      };
    }

    const state =
      requestedGroup !== null
        ? requestedGroup.state
        : quoteAssets.length > 0 && quoteAssets.every((group) => group.state === 'AVAILABLE')
          ? 'AVAILABLE'
          : quoteAssets.length === 0
            ? 'UNAVAILABLE'
            : 'UNAVAILABLE';

    return {
      provenance: 'PERSISTED_PORTFOLIO_VALUATION',
      state,
      requestedQuoteAsset: requested,
      quoteAssets,
      asOf: newestUpdate === null ? null : newestUpdate.toISOString(),
      excluded: { simulatedPositions: simulatedExcluded, positionsWithoutMarkPrice },
      reason:
        state === 'AVAILABLE'
          ? null
          : requestedGroup
            ? requestedGroup.reason
            : quoteAssets.length === 0
              ? 'This tenant holds no persisted positions to value.'
              : 'At least one quote-asset group has positions with no usable mark price; see the per-group reasons.',
    };
  }

  private safeReason(error: unknown): string {
    if (error && typeof error === 'object' && 'code' in error) {
      const code = (error as { code?: unknown }).code;
      if (typeof code === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(code)) return code;
    }
    return error instanceof Error && error.name ? error.name : 'UNKNOWN';
  }
}
