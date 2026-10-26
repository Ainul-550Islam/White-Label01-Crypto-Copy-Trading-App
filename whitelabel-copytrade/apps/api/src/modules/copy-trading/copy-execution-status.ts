// # Owns the copy-execution state machine: allowed edges only, immutable terminal states, exact retry/backoff arithmetic and the customer-facing failure wording used by the timeline.
import { CopyExecutionStatus } from './copy-trading.types';

/**
 * The copy-execution lifecycle, written down once.
 *
 * Before this table the repository had a partial guard: it checked a terminal
 * list only for FILLED, and the "is this edge allowed" question was answered by
 * three separate `if`s in three files. A copy could therefore go
 * `MAPPED -> FILLED` - a state the follower never observes inside a real fill
 * sequence - and a FILLED row could be rewritten by anything that called
 * `updateStatus` with a different status, because the guard only rejected some
 * of the transitions it should have.
 *
 * The rules encoded here:
 *
 *  - Forward only. Every edge advances the intent through the pipeline; no edge
 *    walks backwards, because a follower's "why is my order SUBMITTED again"
 *    question has no honest answer.
 *  - Terminal means terminal. FILLED, FAILED, REJECTED, SKIPPED and BLOCKED are
 *    final: a retry is a NEW execution row (attempt n+1) that references the
 *    previous one, not a resurrection of a row whose outcome has already been
 *    reported to the customer.
 *  - Same-state is a no-op and is allowed, so an idempotent caller is not
 *    punished for asking twice.
 */
export const COPY_EXECUTION_TRANSITIONS: Readonly<Record<CopyExecutionStatus, readonly CopyExecutionStatus[]>> = {
  [CopyExecutionStatus.PENDING]: [
    CopyExecutionStatus.VALIDATED,
    CopyExecutionStatus.SKIPPED,
    CopyExecutionStatus.BLOCKED,
    CopyExecutionStatus.REJECTED,
    CopyExecutionStatus.FAILED,
  ],
  [CopyExecutionStatus.VALIDATED]: [
    CopyExecutionStatus.MAPPED,
    CopyExecutionStatus.SKIPPED,
    CopyExecutionStatus.BLOCKED,
    CopyExecutionStatus.REJECTED,
    CopyExecutionStatus.FAILED,
  ],
  [CopyExecutionStatus.MAPPED]: [
    CopyExecutionStatus.RISK_CHECKED,
    CopyExecutionStatus.SKIPPED,
    CopyExecutionStatus.BLOCKED,
    CopyExecutionStatus.REJECTED,
    CopyExecutionStatus.FAILED,
  ],
  [CopyExecutionStatus.RISK_CHECKED]: [
    CopyExecutionStatus.ROUTED,
    CopyExecutionStatus.SKIPPED,
    CopyExecutionStatus.BLOCKED,
    CopyExecutionStatus.REJECTED,
    CopyExecutionStatus.FAILED,
  ],
  [CopyExecutionStatus.ROUTED]: [
    CopyExecutionStatus.SUBMITTED,
    CopyExecutionStatus.FILLED,
    CopyExecutionStatus.BLOCKED,
    CopyExecutionStatus.REJECTED,
    CopyExecutionStatus.FAILED,
  ],
  [CopyExecutionStatus.SUBMITTED]: [
    CopyExecutionStatus.FILLED,
    CopyExecutionStatus.REJECTED,
    CopyExecutionStatus.FAILED,
  ],
  [CopyExecutionStatus.FILLED]: [],
  [CopyExecutionStatus.FAILED]: [],
  [CopyExecutionStatus.REJECTED]: [],
  [CopyExecutionStatus.SKIPPED]: [],
  [CopyExecutionStatus.BLOCKED]: [],
};

export const TERMINAL_COPY_EXECUTION_STATUSES: ReadonlySet<CopyExecutionStatus> = new Set([
  CopyExecutionStatus.FILLED,
  CopyExecutionStatus.FAILED,
  CopyExecutionStatus.REJECTED,
  CopyExecutionStatus.SKIPPED,
  CopyExecutionStatus.BLOCKED,
]);

/** Statuses a customer should never see on a live intent. */
export const ATTEMPT_STATUSES: readonly CopyExecutionStatus[] = [
  CopyExecutionStatus.FILLED,
  CopyExecutionStatus.FAILED,
  CopyExecutionStatus.REJECTED,
  CopyExecutionStatus.SKIPPED,
  CopyExecutionStatus.BLOCKED,
];

export function isTerminalCopyExecutionStatus(status: string): boolean {
  return TERMINAL_COPY_EXECUTION_STATUSES.has(status as CopyExecutionStatus);
}

/**
 * Whether `from -> to` is an edge the machine permits.
 *
 * Unknown statuses are refused rather than defaulted: a status string the enum
 * does not know is either a bug or a migration that has not run, and both should
 * fail closed on a money path.
 */
export function canTransitionCopyExecution(from: string, to: string): boolean {
  if (from === to) return true;
  const allowed = COPY_EXECUTION_TRANSITIONS[from as CopyExecutionStatus];
  if (!allowed) return false;
  return allowed.includes(to as CopyExecutionStatus);
}

/** The next statuses an operator or the engine may move this execution to. */
export function allowedNextCopyExecutionStatuses(from: string): CopyExecutionStatus[] {
  const allowed = COPY_EXECUTION_TRANSITIONS[from as CopyExecutionStatus];
  return allowed ? [...allowed] : [];
}

/**
 * Exponential backoff for copy retries, in integer milliseconds.
 *
 * `baseMs * 2^(attempt-1)`, capped. Integer arithmetic only - a retry time that
 * drifts by a float rounding error is a "next retry at" the customer cannot
 * match to anything. Attempt 1 is the FIRST retry, so it waits `baseMs`.
 */
export const COPY_RETRY_BASE_DELAY_MS = 5_000;
export const COPY_RETRY_MAX_DELAY_MS = 15 * 60_000;

export function copyRetryDelayMs(attempt: number, baseMs: number = COPY_RETRY_BASE_DELAY_MS, capMs: number = COPY_RETRY_MAX_DELAY_MS): number {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new RangeError('copyRetryDelayMs requires an integer attempt >= 1');
  }
  if (!Number.isInteger(baseMs) || baseMs < 1 || !Number.isInteger(capMs) || capMs < baseMs) {
    throw new RangeError('copyRetryDelayMs requires integers with 1 <= baseMs <= capMs');
  }
  // Doubling is done on integers and clamped before it can overflow, so a
  // corrupt attempt count cannot produce Infinity and a nonsense "next retry".
  let delay = baseMs;
  for (let step = 1; step < attempt; step += 1) {
    if (delay >= capMs) return capMs;
    delay *= 2;
  }
  return Math.min(delay, capMs);
}

/** When the next attempt is due, from the moment this attempt failed. */
export function nextCopyRetryAt(failedAtIso: string, attempt: number): string | null {
  const failedAt = Date.parse(failedAtIso);
  if (!Number.isFinite(failedAt)) return null;
  return new Date(failedAt + copyRetryDelayMs(attempt)).toISOString();
}

/**
 * Failure reason codes, as the customer reads them.
 *
 * The codes on the execution row are diagnostic (`SLIPPAGE_TOLERANCE_EXCEEDED`,
 * `BLOCKED_BUDGET_EXHAUSTED`). Those are the wrong words in a customer's
 * timeline, and inventing a friendlier code in the UI would be a second source
 * of truth. The mapping lives here, next to the machine, and an unknown code
 * falls back to the code itself rather than to a vague "something went wrong" -
 * support can act on a code, nobody can act on a shrug.
 */
export const COPY_FAILURE_REASON_TEXT: Readonly<Record<string, string>> = {
  SLIPPAGE_TOLERANCE_EXCEEDED: 'The price moved further than your slippage tolerance allowed.',
  SLIPPAGE_REFERENCE_UNAVAILABLE: 'The reference price was unavailable, so the copy was not attempted.',
  BLOCKED_BUDGET_EXHAUSTED: 'This copy would have exceeded your active-copy budget.',
  REDUCED_TO_REMAINING_BUDGET: 'This copy was reduced to fit your active-copy budget.',
  BLOCKED_EQUITY_STALE: 'Your account balance was too old to size a copy safely.',
  BLOCKED_EQUITY_UNKNOWN: 'Your account balance was not available, so the copy was not attempted.',
  BLOCKED_CURRENCY_MISMATCH: 'This market settles in a currency your budget is not denominated in.',
  UNALLOWED_SYMBOL: 'You have not allowed copying for this market.',
  BLOCKED_SYMBOL: 'This market is on your blocked list.',
  MAX_DAILY_LOSS: 'Your daily loss limit was reached.',
  MAX_TOTAL_LOSS: 'Your total loss limit was reached.',
  MAX_DRAWDOWN: 'Your drawdown limit was reached.',
  MAX_CONCURRENT_COPIES: 'You have reached your maximum number of open copied positions.',
  ALLOCATION_INVALID: 'Your allocation for this subscription is no longer valid.',
  VENUE_UNAVAILABLE: 'The exchange was not accepting orders, so the copy was not sent.',
  RATE_LIMITED: 'The exchange rate limit was reached, so the copy was delayed.',
  ORDER_REJECTED: 'The exchange rejected the order.',
  INSUFFICIENT_BALANCE: 'There was not enough available balance on your exchange account.',
};

export function copyFailureReasonText(reasonCode: string | null | undefined): string | null {
  if (typeof reasonCode !== 'string' || reasonCode.trim().length === 0) return null;
  const code = reasonCode.trim();
  // A failureReason column often carries "CODE: detail". The code is the part
  // before the separator; the detail is appended verbatim so nothing is lost.
  const [head, ...rest] = code.split(/:\s*/);
  const text = COPY_FAILURE_REASON_TEXT[head];
  if (!text) return code;
  return rest.length > 0 ? `${text} (${rest.join(': ')})` : text;
}

export interface CopyExecutionTimelineEntry {
  executionId: string;
  attempt: number;
  status: CopyExecutionStatus | string;
  failureReasonCode: string | null;
  failureReasonText: string | null;
  retryCount: number;
  at: string;
  /** Present only on a non-terminal failure that will be retried. */
  nextRetryAt: string | null;
  followerQuantity: string | null;
  followerPrice: string | null;
}

export interface CopyExecutionTimeline {
  executionId: string;
  subscriptionId: string;
  terminal: boolean;
  currentStatus: CopyExecutionStatus | string;
  entries: CopyExecutionTimelineEntry[];
}

export interface CopyExecutionTimelineRow {
  id: string;
  subscriptionId: string;
  status: string;
  failureReason: string | null;
  retryCount: number;
  followerQuantity: string | null;
  followerPrice: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  executionIntent?: unknown;
}

/**
 * Build the ordered timeline for one execution chain.
 *
 * Ordered by the time each row was last written, then by attempt, so two rows
 * sharing a millisecond still produce a stable order. `retryCount` and the
 * failure code are copied from the row exactly as stored - the timeline never
 * recomputes them, because a number the customer can check against their own
 * statement must not be re-derived on the way to the screen.
 */
export function buildCopyExecutionTimeline(rows: readonly CopyExecutionTimelineRow[]): CopyExecutionTimeline | null {
  if (rows.length === 0) return null;
  const ordered = [...rows].sort((left, right) => {
    const leftAt = Date.parse(String(left.updatedAt ?? left.createdAt));
    const rightAt = Date.parse(String(right.updatedAt ?? right.createdAt));
    if (leftAt !== rightAt) return leftAt - rightAt;
    return left.retryCount - right.retryCount;
  });
  const entries: CopyExecutionTimelineEntry[] = ordered.map((row, index) => {
    const failureReasonCode = row.failureReason ?? null;
    const failed = row.status === CopyExecutionStatus.FAILED || row.status === CopyExecutionStatus.REJECTED;
    const finalRow = index === ordered.length - 1;
    return {
      executionId: row.id,
      attempt: row.retryCount + 1,
      status: row.status,
      failureReasonCode,
      failureReasonText: copyFailureReasonText(failureReasonCode),
      retryCount: row.retryCount,
      at: new Date(String(row.updatedAt ?? row.createdAt)).toISOString(),
      // A retry is only scheduled when the row failed AND it is the latest one;
      // an old failed attempt's "next retry" already happened.
      nextRetryAt: failed && finalRow ? nextCopyRetryAt(new Date(String(row.updatedAt ?? row.createdAt)).toISOString(), row.retryCount + 1) : null,
      followerQuantity: row.followerQuantity,
      followerPrice: row.followerPrice,
    };
  });
  const latest = ordered[ordered.length - 1];
  return {
    executionId: latest.id,
    subscriptionId: latest.subscriptionId,
    terminal: isTerminalCopyExecutionStatus(latest.status),
    currentStatus: latest.status,
    entries,
  };
}
