// # Classifies how far a position is from its authoritative liquidation price: SAFE/WATCH/DANGER/CRITICAL buckets with hysteresis, and UNKNOWN - never SAFE - when the venue price is missing.
import { Decimal } from '../../common/decimal-string';

/**
 * Liquidation distance, as a decision rather than a number.
 *
 * THE RULE THAT SHAPES THIS FILE
 * ------------------------------
 * The platform must never invent a liquidation price. `Position` carries
 * `markPrice` because the venue reports it; it does not carry a liquidation
 * price, because the venues this platform integrates compute one from the
 * account's whole margin state and only some of them publish it. A local
 * formula (entry ± maintenance margin) would be a plausible-looking number
 * that is wrong exactly when it matters - in the last 2% before a liquidation.
 *
 * So the input here is `liquidationPrice: string | null`, filled ONLY from an
 * authoritative venue feed. When it is null, the answer is UNKNOWN. UNKNOWN is
 * not SAFE, not WATCH, and not "probably fine": it is the state that says the
 * platform cannot currently tell, and the alert surface renders it as such.
 *
 * HYSTERESIS
 * ----------
 * A mark price that oscillates around a threshold would otherwise emit an
 * alert on every tick - and an alert stream that fires constantly is an alert
 * stream people stop reading. Each bucket therefore has to be left by more than
 * the threshold it was entered at (`hysteresisBps`), and a bucket only moves
 * once the distance clears the band in the direction of travel. Entering a
 * worse bucket is never delayed; leaving one always is.
 *
 * All distances are exact: `Decimal` (Layer 2), no floats anywhere.
 */

export enum LiquidationBucket {
  SAFE = 'SAFE',
  WATCH = 'WATCH',
  DANGER = 'DANGER',
  CRITICAL = 'CRITICAL',
  /** The authoritative liquidation price (or mark price) is not available. */
  UNKNOWN = 'UNKNOWN',
}

/** Why the bucket is what it is. Stable strings: the UI and support quote them. */
export enum LiquidationReasonCode {
  DISTANCE_ABOVE_WATCH = 'DISTANCE_ABOVE_WATCH',
  DISTANCE_BELOW_WATCH = 'DISTANCE_BELOW_WATCH',
  DISTANCE_BELOW_DANGER = 'DISTANCE_BELOW_DANGER',
  DISTANCE_BELOW_CRITICAL = 'DISTANCE_BELOW_CRITICAL',
  HELD_BY_HYSTERESIS = 'HELD_BY_HYSTERESIS',
  LIQUIDATION_PRICE_UNAVAILABLE = 'LIQUIDATION_PRICE_UNAVAILABLE',
  MARK_PRICE_UNAVAILABLE = 'MARK_PRICE_UNAVAILABLE',
  MARK_PRICE_ZERO = 'MARK_PRICE_ZERO',
  POSITION_FLAT = 'POSITION_FLAT',
  INPUT_NOT_DECIMAL = 'INPUT_NOT_DECIMAL',
}

/** Bucket thresholds, in basis points of distance from the mark price. */
export interface LiquidationThresholdsBps {
  watch: number;
  danger: number;
  critical: number;
  /** Width of the band a bucket must be cleared by before the bucket changes. */
  hysteresis: number;
}

export const DEFAULT_LIQUIDATION_THRESHOLDS_BPS: LiquidationThresholdsBps = {
  watch: 1500, // 15%
  danger: 700, // 7%
  critical: 300, // 3%
  hysteresis: 100, // 1%
};

export interface LiquidationDistanceInput {
  /** Mark price reported by the venue. Null when the feed has not delivered one. */
  markPrice: string | null;
  /** Authoritative liquidation price from the venue. Never computed here. */
  liquidationPrice: string | null;
  /** Signed position quantity: positive long, negative short, zero flat. */
  quantity: string;
  /** The bucket the previous evaluation produced, for hysteresis. */
  previousBucket?: LiquidationBucket | null;
  thresholds?: Partial<LiquidationThresholdsBps>;
}

export interface LiquidationDistanceResult {
  bucket: LiquidationBucket;
  reasonCode: LiquidationReasonCode;
  /** |mark - liquidation| / mark, in basis points, exact. Null when UNKNOWN. */
  distanceBps: string | null;
  /** The same distance as a percentage string, for display. Null when UNKNOWN. */
  distancePercent: string | null;
  /** |mark - liquidation| in quote currency. Null when UNKNOWN. */
  distanceAbs: string | null;
  markPrice: string | null;
  liquidationPrice: string | null;
  /** True when `previousBucket` was kept because the band was not cleared. */
  heldByHysteresis: boolean;
  /** Whether this bucket should reach the customer as an alert. */
  alert: boolean;
}

const DECIMAL = /^\d{1,40}(?:\.\d{1,18})?$/;

function parseExact(value: string | null): Decimal | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!DECIMAL.test(trimmed)) return null;
  return Decimal.parse(trimmed);
}

function thresholdsWithDefaults(overrides?: Partial<LiquidationThresholdsBps>): LiquidationThresholdsBps {
  const merged = { ...DEFAULT_LIQUIDATION_THRESHOLDS_BPS, ...(overrides ?? {}) };
  const values = [merged.watch, merged.danger, merged.critical, merged.hysteresis];
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new RangeError('Liquidation thresholds must be non-negative finite numbers of basis points');
  }
  if (!(merged.critical <= merged.danger && merged.danger <= merged.watch)) {
    throw new RangeError('Liquidation thresholds must be ordered critical <= danger <= watch');
  }
  return merged;
}

/** Rank a bucket so "worse" is a comparison rather than a chain of ifs. */
export function bucketSeverity(bucket: LiquidationBucket): number {
  switch (bucket) {
    case LiquidationBucket.CRITICAL: return 4;
    case LiquidationBucket.DANGER: return 3;
    case LiquidationBucket.WATCH: return 2;
    case LiquidationBucket.SAFE: return 1;
    default: return 0;
  }
}

function bucketForDistance(distanceBps: Decimal, thresholds: LiquidationThresholdsBps): LiquidationBucket {
  const critical = Decimal.fromUnscaled(BigInt(thresholds.critical), 0);
  const danger = Decimal.fromUnscaled(BigInt(thresholds.danger), 0);
  const watch = Decimal.fromUnscaled(BigInt(thresholds.watch), 0);
  if (distanceBps.lt(critical)) return LiquidationBucket.CRITICAL;
  if (distanceBps.lt(danger)) return LiquidationBucket.DANGER;
  if (distanceBps.lt(watch)) return LiquidationBucket.WATCH;
  return LiquidationBucket.SAFE;
}

function reasonForBucket(bucket: LiquidationBucket): LiquidationReasonCode {
  switch (bucket) {
    case LiquidationBucket.CRITICAL: return LiquidationReasonCode.DISTANCE_BELOW_CRITICAL;
    case LiquidationBucket.DANGER: return LiquidationReasonCode.DISTANCE_BELOW_DANGER;
    case LiquidationBucket.WATCH: return LiquidationReasonCode.DISTANCE_BELOW_WATCH;
    default: return LiquidationReasonCode.DISTANCE_ABOVE_WATCH;
  }
}

/**
 * Evaluate one position.
 *
 * Pure: no I/O, no clock, no configuration lookup. The caller supplies the
 * venue's numbers and gets a bucket plus the exact distance that produced it.
 */
export function evaluateLiquidationDistance(input: LiquidationDistanceInput): LiquidationDistanceResult {
  const thresholds = thresholdsWithDefaults(input.thresholds);
  const unknown = (reasonCode: LiquidationReasonCode, liquidationPrice: string | null = null): LiquidationDistanceResult => ({
    bucket: LiquidationBucket.UNKNOWN,
    reasonCode,
    distanceBps: null,
    distancePercent: null,
    distanceAbs: null,
    markPrice: input.markPrice,
    liquidationPrice,
    heldByHysteresis: false,
    // UNKNOWN is an alert, not a dismissal: "we cannot see your liquidation
    // price" is precisely the state a customer should be told about.
    alert: true,
  });

  if (typeof input.quantity !== 'string' || !DECIMAL.test(input.quantity.trim())) {
    return unknown(LiquidationReasonCode.INPUT_NOT_DECIMAL);
  }
  const quantity = Decimal.parse(input.quantity.trim());
  if (quantity.isZero()) {
    // A flat position cannot be liquidated; the venue agreement is that no
    // liquidation price exists for one, so UNKNOWN would be a lie in the other
    // direction. SAFE with POSITION_FLAT is the honest answer and it does not alert.
    return {
      bucket: LiquidationBucket.SAFE,
      reasonCode: LiquidationReasonCode.POSITION_FLAT,
      distanceBps: null,
      distancePercent: null,
      distanceAbs: null,
      markPrice: input.markPrice,
      liquidationPrice: input.liquidationPrice,
      heldByHysteresis: false,
      alert: false,
    };
  }

  const liquidationPrice = parseExact(input.liquidationPrice);
  if (liquidationPrice === null || liquidationPrice.isZero() || liquidationPrice.isNegative()) {
    return unknown(LiquidationReasonCode.LIQUIDATION_PRICE_UNAVAILABLE);
  }
  const markPrice = parseExact(input.markPrice);
  if (markPrice === null || markPrice.isNegative()) {
    return unknown(LiquidationReasonCode.MARK_PRICE_UNAVAILABLE, liquidationPrice.toString());
  }
  if (markPrice.isZero()) {
    return unknown(LiquidationReasonCode.MARK_PRICE_ZERO, liquidationPrice.toString());
  }

  const distanceAbs = markPrice.sub(liquidationPrice).abs();
  // distanceBps = |mark - liq| / mark * 10_000, floored so a distance that sits
  // exactly on a boundary is treated as the worse bucket.
  const distanceBps = distanceAbs.mul(10_000).div(markPrice, 0, 'FLOOR');
  const nominalBucket = bucketForDistance(distanceBps, thresholds);
  const previous = input.previousBucket ?? null;

  // Hysteresis: leaving a bucket requires clearing the band. Entering a worse
  // bucket never waits - the whole point is to alert early, not to lag.
  let bucket = nominalBucket;
  let heldByHysteresis = false;
  if (previous !== null && previous !== LiquidationBucket.UNKNOWN && bucketSeverity(nominalBucket) < bucketSeverity(previous)) {
    const bandBps = Decimal.fromUnscaled(BigInt(thresholds.hysteresis), 0);
    const boundary = boundaryForBucket(previous, thresholds);
    if (distanceBps.lt(boundary.add(bandBps))) {
      bucket = previous;
      heldByHysteresis = true;
    }
  }

  return {
    bucket,
    reasonCode: heldByHysteresis ? LiquidationReasonCode.HELD_BY_HYSTERESIS : reasonForBucket(bucket),
    distanceBps: distanceBps.toString(),
    distancePercent: distanceBps.div(100, 6, 'FLOOR').toString(),
    distanceAbs: distanceAbs.toString(),
    markPrice: markPrice.toString(),
    liquidationPrice: liquidationPrice.toString(),
    heldByHysteresis,
    alert: bucket === LiquidationBucket.WATCH || bucket === LiquidationBucket.DANGER || bucket === LiquidationBucket.CRITICAL,
  };
}

/** The distance at which `bucket` starts, in basis points. */
export function boundaryForBucket(bucket: LiquidationBucket, thresholds: LiquidationThresholdsBps): Decimal {
  switch (bucket) {
    case LiquidationBucket.CRITICAL: return Decimal.fromUnscaled(BigInt(thresholds.critical), 0);
    case LiquidationBucket.DANGER: return Decimal.fromUnscaled(BigInt(thresholds.danger), 0);
    case LiquidationBucket.WATCH: return Decimal.fromUnscaled(BigInt(thresholds.watch), 0);
    default: return Decimal.ZERO;
  }
}

/**
 * A stable identity for "this position entered this bucket", used as the
 * deduplication key by the notification processor. Position id + bucket, so a
 * DANGER alert and a CRITICAL alert for the same position are two alerts.
 */
export function liquidationAlertKey(positionId: string, bucket: LiquidationBucket): string {
  return `liquidation-alert:${positionId}:${bucket}`;
}
