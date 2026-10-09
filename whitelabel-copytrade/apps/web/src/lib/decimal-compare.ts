// # Responsibility: orders decimal strings exactly, so a client-side list order never depends on float rounding.
//
// This exists because the web app has no access to the API's `apps/api/src/common/decimal-string.ts`:
// they are separate builds. The web app uses `@wlct/utils` for transport-neutral helpers, but this
// comparator stays app-local; the API module remains the authority for money decisions, while this
// one only orders values the server already computed and deliberately does no arithmetic at all.
//
// The bug it replaces was silent. The traders discovery page offers "Sort by Realized PnL" and
// "Sort by Win Rate" while the filter only implemented volume / trades / followers, so choosing
// PnL re-sorted by follower count with no indication that the choice had been ignored. Sorting by
// `parseFloat` would have been the same class of mistake in a smaller font: two values that are
// equal as doubles can differ as decimals, and the order would then depend on a rounding error.
'use strict';

/** True when the value is a plain decimal string: optional sign, digits, optional fraction. */
export function isPlainDecimalString(value: unknown): value is string {
  return typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value);
}

/**
 * Compares two decimal strings exactly, returning -1, 0 or 1.
 *
 * Both sides are expanded to a common fractional width and compared as integers, so the result does
 * not depend on the magnitude or the precision of either input. Null, undefined and non-decimal
 * values sort last regardless of direction: a trader whose performance is unknown is not a trader
 * with a performance of zero, and putting unknown either first or last as if it were a number would
 * state something the data does not.
 */
export function compareDecimalStringsExact(a: string | null | undefined, b: string | null | undefined): number {
  const left = isPlainDecimalString(a) ? a : null;
  const right = isPlainDecimalString(b) ? b : null;
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;

  // Defaulted rather than asserted: the regex above guarantees an integer part, and a default keeps
  // the function total without a non-null assertion the compiler cannot verify.
  const [leftInteger = '0', leftFraction = ''] = left.split('.');
  const [rightInteger = '0', rightFraction = ''] = right.split('.');
  const width = Math.max(leftFraction.length, rightFraction.length);
  const leftScaled = BigInt(`${leftInteger.replace('-', '')}${leftFraction.padEnd(width, '0')}`);
  const rightScaled = BigInt(`${rightInteger.replace('-', '')}${rightFraction.padEnd(width, '0')}`);
  const leftSigned = leftInteger.startsWith('-') ? -leftScaled : leftScaled;
  const rightSigned = rightInteger.startsWith('-') ? -rightScaled : rightScaled;

  if (leftSigned === rightSigned) return 0;
  return leftSigned < rightSigned ? -1 : 1;
}

/**
 * Orders decimal strings descending, with unknown values last.
 *
 * The unknown check is repeated rather than delegated: negating `compareDecimalStringsExact` would
 * invert its "unknown last" rule too, and put every trader with no recorded performance at the top
 * of a descending list - which reads as the best performers.
 */
export function compareDecimalStringsDescending(a: string | null | undefined, b: string | null | undefined): number {
  const leftUnknown = !isPlainDecimalString(a);
  const rightUnknown = !isPlainDecimalString(b);
  if (leftUnknown && rightUnknown) return 0;
  if (leftUnknown) return 1;
  if (rightUnknown) return -1;
  return -compareDecimalStringsExact(a, b);
}
