// # Maps leader events into follower order intents with slippage bounds and delay metadata
//
// SAFETY CONTRACT (after the copy-sizing audit)
// --------------------------------------------
// This service decides *how much* a follower trades. Every path through it must
// satisfy three rules, each of which was violated before this rewrite:
//
//   1. SIZE FROM THE FOLLOWER, NEVER FROM THE LEADER'S ABSOLUTE QUANTITY.
//      A follower with 1,000 USDT was previously given a 10 BTC / 600,000 USDT
//      order in PERCENTAGE_BALANCE mode (the percentage was applied to the
//      *leader's* size), and PROPORTIONAL mode fell back to `followerQty =
//      leaderQty` whenever balance context was missing. Both are catastrophic on
//      a platform whose entire premise is that followers have smaller balances.
//      There is no longer any code path that copies an absolute leader size.
//
//   2. FAIL CLOSED, NEVER FABRICATE.
//      Exchange precision metadata (tick/step/min sizes) is required. A lookup
//      error or a missing symbol now rejects the copy instead of silently
//      substituting a hardcoded 8-dp step, which produced orders the venue would
//      reject with no min-quantity/min-notional check at all.
//
//   3. NO SILENT FLOAT DEGRADATION.
//      Arithmetic goes through `@wlct/utils` `Decimal`, which throws rather than
//      falling back to `parseFloat`. The old helpers caught parse failures -
//      e.g. `String(1e-7 / 100) === '1e-9'` - and continued in IEEE-754.
//
// A rejected mapping returns a structured reason so the caller can record *why*
// on the execution row; it never returns a degraded intent.
import { Injectable, Logger } from '@nestjs/common';
import { Decimal } from '../../common/decimal-string';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ExchangeSymbolService } from '../exchanges/exchange-symbol.service';
import { CopyPolicy, CopySizingMode, matchesAnySymbolRule } from './copy-trading.types';

export interface LeaderEvent {
  eventId: string;
  orderId?: string | null;
  fillId?: string | null;
  symbol: string;
  exchangeSymbol: string;
  side: string;
  type: string;
  quantity: string;
  price: string | null;
  stopPrice?: string | null;
  venue: string;
  timestamp: string;
  isSimulated: boolean;
}

export interface FollowerIntent {
  symbol: string;
  exchangeSymbol: string;
  side: string;
  type: string;
  quantity: string;
  price: string | null;
  stopPrice: string | null;
  takeProfitPrice?: string | null;
  stopLossPrice?: string | null;
  trailingStopBps?: number | null;
  notional: string | null;
  slippageUpper: string | null;
  slippageLower: string | null;
  isReduceOnly: boolean;
  executionDelayMs: number;
  sizingMode: CopySizingMode;
  source: string;
}

/** Why a leader event produced no follower order. Recorded, never guessed at. */
export type CopyMappingRejectionCode =
  | 'INVALID_LEADER_QUANTITY'
  | 'INVALID_LEADER_PRICE'
  | 'SYMBOL_BLOCKED'
  | 'SYMBOL_NOT_ALLOWED'
  | 'SIDE_NOT_ALLOWED'
  | 'INVALID_SIZING_INPUT'
  | 'MISSING_FOLLOWER_BALANCE'
  | 'MISSING_REFERENCE_PRICE'
  | 'INVALID_PERCENTAGE'
  | 'MISSING_PROPORTIONAL_BASIS'
  | 'SYMBOL_METADATA_UNAVAILABLE'
  | 'SYMBOL_NOT_REGISTERED'
  | 'INVALID_EXCHANGE_PRECISION'
  | 'SIZE_BELOW_STEP'
  | 'SIZE_BELOW_MIN_QUANTITY'
  | 'NOTIONAL_BELOW_MINIMUM'
  | 'NOTIONAL_ABOVE_LIMIT'
  | 'EXCEEDS_FOLLOWER_BALANCE';

export interface CopyMappingRejection {
  code: CopyMappingRejectionCode;
  message: string;
}

export type CopyMappingResult =
  | { ok: true; intent: FollowerIntent }
  | { ok: false; rejection: CopyMappingRejection };

export interface MapLeaderToFollowerInput {
  tenantId: string;
  leaderEvent: LeaderEvent;
  followerAccountId: string | null;
  allocationAmount: string;
  allocationMode: CopySizingMode;
  copyPolicy: CopyPolicy;
  followerBalance?: string | null;
  leaderTotalBalance?: string | null;
  /**
   * Mark/last price for the instrument, used whenever the leader event carries no
   * price of its own (a MARKET order) and notional maths is required. Supplying
   * it is what lets `maxOrderNotional` and percentage sizing be enforced on
   * market orders. Without it those mappings are refused rather than guessed.
   */
  referencePrice?: string | null;
  /** Force reduce-only (position closing copies). Falls back to the policy flag. */
  isReduceOnly?: boolean;
}

/** Highest fractional precision we will echo back to an exchange. */
const MAX_EXCHANGE_DECIMALS = 18;
const MAX_EXECUTION_DELAY_MS = 60_000;

@Injectable()
export class CopyOrderMapperService {
  private readonly logger = new Logger(CopyOrderMapperService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly symbolService: ExchangeSymbolService,
  ) {}

  /** Backward-compatible entry point: the intent, or `null` when rejected. */
  async mapLeaderToFollower(input: MapLeaderToFollowerInput): Promise<FollowerIntent | null> {
    const result = await this.planLeaderToFollower(input);
    return result.ok ? result.intent : null;
  }

  /**
   * Resolve a leader event into a follower intent, or explain why it cannot be
   * copied. Prefer this over {@link mapLeaderToFollower}: the rejection code is
   * what makes a non-copy auditable after the fact.
   */
  async planLeaderToFollower(input: MapLeaderToFollowerInput): Promise<CopyMappingResult> {
    const reject = (code: CopyMappingRejectionCode, message: string): CopyMappingResult => {
      this.logger.warn(
        `Copy mapping rejected code=${code} tenant=${input.tenantId} event=${input.leaderEvent.eventId} : ${message}`,
      );
      return { ok: false, rejection: { code, message } };
    };

    const policy = input.copyPolicy;

    // ------------------------------------------------------------- symbol/side
    if (policy.blockedSymbols?.includes(input.leaderEvent.symbol)) {
      return reject('SYMBOL_BLOCKED', `symbol ${input.leaderEvent.symbol} is blocked by policy`);
    }
    if (policy.allowedSymbols && !matchesAnySymbolRule(policy.allowedSymbols, input.leaderEvent.symbol)) {
      return reject('SYMBOL_NOT_ALLOWED', `symbol ${input.leaderEvent.symbol} is not in the allow-list`);
    }
    if (policy.allowedSides && !policy.allowedSides.includes(input.leaderEvent.side)) {
      return reject('SIDE_NOT_ALLOWED', `side ${input.leaderEvent.side} is not allowed by policy`);
    }

    // ------------------------------------------------------------- leader input
    const leaderQty = Decimal.tryParse(input.leaderEvent.quantity);
    if (!leaderQty || !leaderQty.isPositive()) {
      return reject(
        'INVALID_LEADER_QUANTITY',
        `leader quantity "${input.leaderEvent.quantity}" is not a positive decimal`,
      );
    }

    const leaderPrice = Decimal.tryParse(input.leaderEvent.price);
    if (input.leaderEvent.price !== null && input.leaderEvent.price !== undefined && !leaderPrice) {
      return reject('INVALID_LEADER_PRICE', `leader price "${input.leaderEvent.price}" is not a decimal`);
    }
    if (leaderPrice && !leaderPrice.isPositive()) {
      return reject('INVALID_LEADER_PRICE', `leader price "${input.leaderEvent.price}" is not positive`);
    }

    const referencePrice = Decimal.tryParse(input.referencePrice);
    if (input.referencePrice !== null && input.referencePrice !== undefined && !referencePrice) {
      return reject('MISSING_REFERENCE_PRICE', `reference price "${input.referencePrice}" is not a decimal`);
    }
    if (referencePrice && !referencePrice.isPositive()) {
      return reject('MISSING_REFERENCE_PRICE', 'reference price is not positive');
    }
    /** Price used for all notional maths: the fill price, else the mark. */
    const valuationPrice = leaderPrice ?? referencePrice ?? null;

    const followerBalance = Decimal.tryParse(input.followerBalance);
    const leaderTotalBalance = Decimal.tryParse(input.leaderTotalBalance);
    const allocationAmount = Decimal.tryParse(input.allocationAmount);

    // --------------------------------------------------------------- sizing
    const sizing = this.resolveFollowerQuantity({
      allocationMode: input.allocationMode,
      policy,
      leaderQty,
      allocationAmount,
      followerBalance,
      leaderTotalBalance,
      valuationPrice,
    });
    if (!sizing.ok) return reject(sizing.rejection.code, sizing.rejection.message);

    let followerQty = sizing.quantity;

    // ------------------------------------------- max notional (incl. MARKET)
    const maxOrderNotional = Decimal.tryParse(policy.maxOrderNotional);
    if (policy.maxOrderNotional && !maxOrderNotional) {
      return reject('INVALID_SIZING_INPUT', `maxOrderNotional "${policy.maxOrderNotional}" is not a decimal`);
    }
    if (maxOrderNotional && maxOrderNotional.isPositive()) {
      // A cap that cannot be evaluated must not be skipped. The previous
      // implementation only applied this when the event carried a price, so
      // every MARKET order bypassed maxOrderNotional entirely.
      if (!valuationPrice) {
        return reject(
          'MISSING_REFERENCE_PRICE',
          `maxOrderNotional=${maxOrderNotional.toString()} cannot be enforced without a price (market order and no reference price)`,
        );
      }
      const notional = followerQty.mul(valuationPrice);
      if (notional.gt(maxOrderNotional)) {
        // Trim to the cap, then re-snap to the step below.
        followerQty = maxOrderNotional.div(valuationPrice, MAX_EXCHANGE_DECIMALS, 'FLOOR');
        this.logger.log(
          `Max notional enforced tenant=${input.tenantId} notional=${notional.toString()} max=${maxOrderNotional.toString()}`,
        );
      }
    }

    // ------------------------------------------------- exchange precision
    // Required, never defaulted: a wrong step is an order the venue rejects, and
    // a fabricated one hides the fact that we never checked the venue's rules.
    let exchangeSymbol = input.leaderEvent.exchangeSymbol;
    let tickSize: Decimal;
    let quantityStep: Decimal;
    let minQuantity: Decimal | null = null;
    let minNotional: Decimal | null = null;

    let symbolMeta: Awaited<ReturnType<ExchangeSymbolService['getSymbol']>>;
    try {
      symbolMeta = await this.symbolService.getSymbol(input.tenantId, input.leaderEvent.symbol);
    } catch (error) {
      return reject(
        'SYMBOL_METADATA_UNAVAILABLE',
        `symbol metadata lookup failed for ${input.leaderEvent.symbol}: ${(error as Error)?.message ?? 'unknown error'}`,
      );
    }

    if (!symbolMeta) {
      return reject(
        'SYMBOL_NOT_REGISTERED',
        `no exchange symbol metadata registered for ${input.leaderEvent.symbol}`,
      );
    }

    const tick = Decimal.tryParse(symbolMeta.tickSize);
    const step = Decimal.tryParse(symbolMeta.quantityStep);
    if (!tick || !tick.isPositive() || !step || !step.isPositive()) {
      return reject(
        'INVALID_EXCHANGE_PRECISION',
        `symbol ${input.leaderEvent.symbol} has unusable precision (tick=${symbolMeta.tickSize}, step=${symbolMeta.quantityStep})`,
      );
    }
    tickSize = tick;
    quantityStep = step;
    exchangeSymbol = symbolMeta.exchangeSymbol ?? exchangeSymbol;

    if (symbolMeta.minQuantity) {
      const parsed = Decimal.tryParse(symbolMeta.minQuantity);
      if (!parsed) {
        return reject('INVALID_EXCHANGE_PRECISION', `minQuantity "${symbolMeta.minQuantity}" is not a decimal`);
      }
      minQuantity = parsed;
    }
    if (symbolMeta.minNotional) {
      const parsed = Decimal.tryParse(symbolMeta.minNotional);
      if (!parsed) {
        return reject('INVALID_EXCHANGE_PRECISION', `minNotional "${symbolMeta.minNotional}" is not a decimal`);
      }
      minNotional = parsed;
    }

    // Snap the size DOWN to the venue step. Flooring can only reduce exposure.
    const snapped = Decimal.floorToStep(followerQty, quantityStep);
    if (!snapped) {
      return reject(
        'SIZE_BELOW_STEP',
        `sized quantity ${followerQty.toString()} is below one step (${quantityStep.toString()})`,
      );
    }
    followerQty = snapped;

    // An order for zero is not a small order, it is an invalid one.
    if (!followerQty.isPositive()) {
      return reject('SIZE_BELOW_STEP', `resolved quantity rounds to zero at step ${quantityStep.toString()}`);
    }

    if (minQuantity && followerQty.lt(minQuantity)) {
      return reject(
        'SIZE_BELOW_MIN_QUANTITY',
        `quantity ${followerQty.toString()} is below the venue minimum ${minQuantity.toString()}`,
      );
    }

    if (minNotional && valuationPrice) {
      const notional = followerQty.mul(valuationPrice);
      if (notional.lt(minNotional)) {
        return reject(
          'NOTIONAL_BELOW_MINIMUM',
          `notional ${notional.toString()} is below the venue minimum ${minNotional.toString()}`,
        );
      }
    }

    // ------------------------------------------- follower affordability
    // Never let a single copy exceed the follower's available balance when we
    // know it. This is the last line of defence behind the sizing rules above.
    if (followerBalance && followerBalance.isPositive() && valuationPrice) {
      const notional = followerQty.mul(valuationPrice);
      if (notional.gt(followerBalance)) {
        return reject(
          'EXCEEDS_FOLLOWER_BALANCE',
          `notional ${notional.toString()} exceeds follower balance ${followerBalance.toString()}`,
        );
      }
    }

    // ------------------------------------------------------------- prices
    let followerPrice: Decimal | null = leaderPrice;
    if (followerPrice) {
      followerPrice = Decimal.roundToTick(followerPrice, tickSize, 'HALF_UP');
      if (!followerPrice.isPositive()) {
        return reject('INVALID_LEADER_PRICE', 'price rounds to zero at the venue tick size');
      }
    }

    let stopPrice: Decimal | null = null;
    if (input.leaderEvent.stopPrice) {
      const parsed = Decimal.tryParse(input.leaderEvent.stopPrice);
      if (!parsed) {
        return reject('INVALID_SIZING_INPUT', `stopPrice "${input.leaderEvent.stopPrice}" is not a decimal`);
      }
      stopPrice = Decimal.roundToTick(parsed, tickSize, 'HALF_UP');
    }

    // ---------------------------------------------------------- slippage
    // Bounds are the worst price the follower may accept, snapped so the bound
    // itself is a legal price: a BUY ceiling rounds up, a SELL floor rounds down.
    let slippageUpper: Decimal | null = null;
    let slippageLower: Decimal | null = null;

    if (followerPrice && policy.slippageToleranceBps && policy.slippageToleranceBps > 0) {
      const tolerance = followerPrice.mul(policy.slippageToleranceBps).div(10_000, MAX_EXCHANGE_DECIMALS, 'HALF_UP');
      if (input.leaderEvent.side === 'BUY') {
        slippageUpper = Decimal.ceilToTick(followerPrice.add(tolerance), tickSize);
        slippageLower = followerPrice;
      } else {
        slippageUpper = followerPrice;
        const rawFloor = followerPrice.sub(tolerance);
        // A negative price is not a valid bound; the tick is the lowest legal one.
        slippageLower = rawFloor.isPositive() ? Decimal.floorToTick(rawFloor, tickSize) : tickSize;
      }
    }

    // ------------------------------------------------------------ TP / SL
    let takeProfitPrice: Decimal | null = null;
    let stopLossPrice: Decimal | null = null;
    if (followerPrice) {
      const isBuy = input.leaderEvent.side === 'BUY';
      if (policy.takeProfitBps && policy.takeProfitBps > 0) {
        const delta = followerPrice.mul(policy.takeProfitBps).div(10_000, MAX_EXCHANGE_DECIMALS, 'HALF_UP');
        const raw = isBuy ? followerPrice.add(delta) : followerPrice.sub(delta);
        if (raw.isPositive()) takeProfitPrice = Decimal.roundToTick(raw, tickSize, 'HALF_UP');
      }
      if (policy.stopLossBps && policy.stopLossBps > 0) {
        const delta = followerPrice.mul(policy.stopLossBps).div(10_000, MAX_EXCHANGE_DECIMALS, 'HALF_UP');
        const raw = isBuy ? followerPrice.sub(delta) : followerPrice.add(delta);
        if (raw.isPositive()) stopLossPrice = Decimal.roundToTick(raw, tickSize, 'HALF_UP');
      }
    }

    const executionDelayMs = Math.min(
      MAX_EXECUTION_DELAY_MS,
      Math.max(0, Math.trunc(policy.executionDelayMs ?? 0) || 0),
    );

    return {
      ok: true,
      intent: {
        symbol: input.leaderEvent.symbol,
        exchangeSymbol,
        side: input.leaderEvent.side,
        type: input.leaderEvent.type,
        quantity: followerQty.toString(),
        price: followerPrice ? followerPrice.toString() : null,
        stopPrice: stopPrice ? stopPrice.toString() : null,
        takeProfitPrice: takeProfitPrice ? takeProfitPrice.toString() : null,
        stopLossPrice: stopLossPrice ? stopLossPrice.toString() : null,
        trailingStopBps: policy.trailingStopBps ?? null,
        notional: valuationPrice ? followerQty.mul(valuationPrice).toString() : null,
        slippageUpper: slippageUpper ? slippageUpper.toString() : null,
        slippageLower: slippageLower ? slippageLower.toString() : null,
        isReduceOnly: input.isReduceOnly ?? policy.reduceOnly ?? false,
        executionDelayMs,
        sizingMode: input.allocationMode,
        source: 'COPY_TRADING',
      },
    };
  }

  /**
   * Follower quantity for each sizing mode.
   *
   * Every branch is expressed relative to the *follower's* resources. There is
   * deliberately no fallback that copies `leaderQty` outright: if the inputs a
   * mode needs are missing, the copy is refused.
   */
  private resolveFollowerQuantity(args: {
    allocationMode: CopySizingMode;
    policy: CopyPolicy;
    leaderQty: Decimal;
    allocationAmount: Decimal | null;
    followerBalance: Decimal | null;
    leaderTotalBalance: Decimal | null;
    valuationPrice: Decimal | null;
  }): { ok: true; quantity: Decimal } | { ok: false; rejection: CopyMappingRejection } {
    const { allocationMode, policy, leaderQty, allocationAmount, followerBalance, leaderTotalBalance, valuationPrice } = args;

    const missingPrice = (): { ok: false; rejection: CopyMappingRejection } => ({
      ok: false,
      rejection: {
        code: 'MISSING_REFERENCE_PRICE',
        message: 'a price is required to size this order and neither the leader fill price nor a reference price was available',
      },
    });

    switch (allocationMode) {
      case CopySizingMode.FIXED: {
        // A fixed *notional* converts at the current price.
        if (policy.fixedNotional) {
          const notional = Decimal.tryParse(policy.fixedNotional);
          if (!notional || !notional.isPositive()) {
            return {
              ok: false,
              rejection: { code: 'INVALID_SIZING_INPUT', message: `fixedNotional "${policy.fixedNotional}" is not a positive decimal` },
            };
          }
          if (!valuationPrice) return missingPrice();
          return { ok: true, quantity: notional.div(valuationPrice, MAX_EXCHANGE_DECIMALS, 'FLOOR') };
        }

        const fixed = policy.fixedQuantity ? Decimal.tryParse(policy.fixedQuantity) : null;
        if (policy.fixedQuantity && (!fixed || !fixed.isPositive())) {
          return {
            ok: false,
            rejection: { code: 'INVALID_SIZING_INPUT', message: `fixedQuantity "${policy.fixedQuantity}" is not a positive decimal` },
          };
        }
        if (fixed) return { ok: true, quantity: fixed };

        // Legacy: the allocation field itself carries a quantity.
        if (allocationAmount && allocationAmount.isPositive()) {
          return { ok: true, quantity: allocationAmount };
        }

        return {
          ok: false,
          rejection: { code: 'INVALID_SIZING_INPUT', message: 'FIXED sizing needs fixedNotional, fixedQuantity or a positive allocationAmount' },
        };
      }

      case CopySizingMode.PERCENTAGE_BALANCE: {
        // THE AUDIT FIX. The percentage applies to the FOLLOWER's balance, which
        // requires both that balance and a price to convert notional to size.
        if (!followerBalance || !followerBalance.isPositive()) {
          return {
            ok: false,
            rejection: {
              code: 'MISSING_FOLLOWER_BALANCE',
              message: 'PERCENTAGE_BALANCE sizing requires a positive follower balance',
            },
          };
        }
        if (!allocationAmount) {
          return {
            ok: false,
            rejection: { code: 'INVALID_PERCENTAGE', message: `allocation "${String(args.allocationAmount)}" is not a decimal percentage` },
          };
        }
        if (!allocationAmount.isPositive() || allocationAmount.gt(100)) {
          return {
            ok: false,
            rejection: { code: 'INVALID_PERCENTAGE', message: `percentage ${allocationAmount.toString()} must be within (0, 100]` },
          };
        }
        if (!valuationPrice) return missingPrice();

        const budget = followerBalance.mul(allocationAmount).div(100, MAX_EXCHANGE_DECIMALS, 'FLOOR');
        return { ok: true, quantity: budget.div(valuationPrice, MAX_EXCHANGE_DECIMALS, 'FLOOR') };
      }

      case CopySizingMode.PROPORTIONAL:
      default: {
        // An explicit ratio is a scale factor on the leader's size.
        if (policy.proportionalRatio) {
          const ratio = Decimal.tryParse(policy.proportionalRatio);
          if (!ratio || !ratio.isPositive()) {
            return {
              ok: false,
              rejection: { code: 'INVALID_SIZING_INPUT', message: `proportionalRatio "${policy.proportionalRatio}" is not a positive decimal` },
            };
          }
          return { ok: true, quantity: leaderQty.mul(ratio) };
        }

        // Otherwise mirror the leader's *portfolio share*, which needs both sides.
        if (allocationAmount && allocationAmount.isPositive() && leaderTotalBalance && leaderTotalBalance.isPositive()) {
          const ratio = allocationAmount.div(leaderTotalBalance, MAX_EXCHANGE_DECIMALS, 'HALF_UP');
          return { ok: true, quantity: leaderQty.mul(ratio) };
        }

        // No ratio, no comparable balances: refuse. Copying `leaderQty` here
        // would hand a follower the leader's absolute position size.
        return {
          ok: false,
          rejection: {
            code: 'MISSING_PROPORTIONAL_BASIS',
            message:
              'PROPORTIONAL sizing needs proportionalRatio, or an allocation and the leader total balance; refusing to copy the leader size verbatim',
          },
        };
      }
    }
  }
}
