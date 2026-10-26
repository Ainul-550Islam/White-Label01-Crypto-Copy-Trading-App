// # Responsibility: shows a follower exactly what happened to one copied order — each attempt, why it failed in words they can act on, and when the next retry is due.
//
// WHAT THE CUSTOMER IS ACTUALLY ASKING
// ------------------------------------
// "My leader bought and I did not." The timeline answers that with the recorded
// facts and nothing else: the attempt number, the status at that attempt, the
// failure code translated into a sentence, the retry count AS STORED, and the
// time of the next retry when there is one.
//
// Two things it deliberately does not do:
//
//   * It does not recompute the retry count or invent an attempt. Those numbers
//     are what the execution service recorded; re-deriving them here would mean
//     the customer's screen can disagree with their statement.
//   * It does not hide a terminal failure. A BLOCKED or FAILED execution stays
//     visible with the reason, because "it silently did not happen" is the worst
//     possible answer to this question.
//
// The only derived values are the ordering (oldest first, so the story reads
// forwards) and the countdown label for `nextRetryAt`, which is presentation.
'use client';
import type { JSX } from 'react';

import { useEffect, useState } from 'react';

import type { CopyExecutionTimeline, CopyExecutionTimelineEntry } from '@/api/copy-ops-api';
import { EmptyState } from '@/components/empty-state';

/** Customer-facing wording for the failure codes the execution pipeline emits. */
const FAILURE_TEXT: Record<string, string> = {
  VENUE_REJECTED: 'The exchange rejected the order.',
  INSUFFICIENT_BALANCE: 'There was not enough available balance on the exchange account.',
  LEVERAGE_MISMATCH: 'The order needed more leverage than your policy allows.',
  SYMBOL_NOT_TRADABLE: 'That market was not tradable at the exchange at the time.',
  RISK_BLOCKED: 'A risk rule stopped the order before it reached the exchange.',
  BUDGET_BLOCKED: 'The order would have exceeded your copy budget.',
  PRICE_DEVIATION: 'The price moved too far from the leader’s fill to copy safely.',
  STALE_MARKET_DATA: 'Market data was stale, so the order was not sent.',
  RATE_LIMITED: 'The exchange was rate limiting requests.',
  TIMEOUT: 'The exchange did not answer in time; it is not known whether the order arrived.',
  RECONCILIATION_REQUIRED: 'The order needs reconciliation before it can be retried.',
  ACCOUNT_DISCONNECTED: 'The exchange account was disconnected.',
  NOTIONAL_TOO_SMALL: 'The copied size was below the exchange minimum.',
  DUPLICATE_INTENT: 'This order was already submitted for the same leader fill.',
};

const STATUS_TONE: Record<string, string> = {
  FILLED: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  PARTIALLY_FILLED: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  PENDING: 'border-slate-300 bg-slate-50 text-slate-900',
  RETRYING: 'border-amber-300 bg-amber-50 text-amber-900',
  FAILED: 'border-red-300 bg-red-50 text-red-900',
  BLOCKED: 'border-red-300 bg-red-50 text-red-900',
  CANCELLED: 'border-slate-300 bg-slate-50 text-slate-900',
  RECONCILING: 'border-amber-300 bg-amber-50 text-amber-900',
};

const TERMINAL_GOOD = new Set(['FILLED', 'PARTIALLY_FILLED']);
const TERMINAL_BAD = new Set(['FAILED', 'BLOCKED', 'CANCELLED']);

/** The sentence for a failure code, falling back to the code itself rather than to silence. */
export function describeFailure(entry: Pick<CopyExecutionTimelineEntry, 'failureReasonCode' | 'failureReasonText'>): string | null {
  if (entry.failureReasonText) return entry.failureReasonText;
  if (!entry.failureReasonCode) return null;
  const head = entry.failureReasonCode.split(/:\s*/)[0];
  const text = head ? FAILURE_TEXT[head] : undefined;
  return text ?? `Failed with code ${entry.failureReasonCode}.`;
}

/** Whole seconds until `iso`, floored at zero. */
function secondsUntil(iso: string, nowMs: number): number {
  const target = Date.parse(iso);
  if (!Number.isFinite(target)) return 0;
  return Math.max(0, Math.floor((target - nowMs) / 1_000));
}

function countdownLabel(seconds: number): string {
  if (seconds <= 0) return 'due now';
  if (seconds < 60) return `in ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `in ${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `in ${hours}h ${minutes % 60}m`;
}

export interface CopyExecutionStatusTimelineProps {
  timeline: CopyExecutionTimeline | null;
  /** Clock injected by tests; defaults to the real one. */
  nowMs?: number;
}

export function CopyExecutionStatusTimeline({ timeline, nowMs }: CopyExecutionStatusTimelineProps): JSX.Element {
  // The clock is an external system, so it is read only inside the interval callback
  // and only stored once it has a value. Calling `setNow` synchronously in the effect
  // body (to seed it on mount, or to adopt a test-supplied `nowMs`) is the pattern
  // React rejects as a cascading render - and it also made the injected clock fight
  // the interval. `null` means "the clock has not ticked yet", and the retry countdown
  // is simply omitted for that first second rather than rendered as `due now`.
  const [clockMs, setClockMs] = useState<number | null>(null);

  useEffect(() => {
    if (nowMs !== undefined) return undefined;
    const timer = setInterval(() => setClockMs(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [nowMs]);

  const now = nowMs ?? clockMs;

  if (!timeline || timeline.entries.length === 0) {
    return (
      <EmptyState
        title="No attempts recorded"
        description="Nothing has been submitted for this copy order yet."
      />
    );
  }

  const entries = [...timeline.entries].sort((a, b) => {
    const at = Date.parse(a.at);
    const bt = Date.parse(b.at);
    if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) return at - bt;
    return a.attempt - b.attempt;
  });

  const last = entries[entries.length - 1];
  if (!last) {
    return (
      <EmptyState
        title="No attempts recorded"
        description="Nothing has been submitted for this copy order yet."
      />
    );
  }
  const lastStatus = String(last.status).toUpperCase();
  const outcome = TERMINAL_GOOD.has(lastStatus)
    ? 'This copy order completed.'
    : TERMINAL_BAD.has(lastStatus)
      ? 'This copy order did not complete.'
      : 'This copy order is still being worked.';

  return (
    <section className="rounded border bg-card p-4" aria-label="Copy execution timeline">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">What happened</h2>
        <span className="text-xs text-muted">
          {entries.length} attempt{entries.length === 1 ? '' : 's'}
          {timeline.terminal ? ' · finished' : ' · in progress'}
        </span>
      </header>
      <p className="mt-1 text-xs text-muted">{outcome}</p>

      <ol className="mt-3 grid gap-2">
        {entries.map((entry) => {
          const status = String(entry.status).toUpperCase();
          const tone = STATUS_TONE[status] ?? 'border-slate-300 bg-slate-50 text-slate-900';
          const failure = describeFailure(entry);
          const retryInSeconds = entry.nextRetryAt && now !== null ? secondsUntil(entry.nextRetryAt, now) : null;
          return (
            <li key={`${entry.executionId}-${entry.attempt}`} className={`rounded border p-3 text-sm ${tone}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">
                  Attempt {entry.attempt} · {status.replace(/_/g, ' ').toLowerCase()}
                </span>
                <span className="text-xs opacity-80">{new Date(entry.at).toLocaleString()}</span>
              </div>

              {failure && <p className="mt-1 text-xs">{failure}</p>}

              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs opacity-80">
                <span>Retries recorded: {entry.retryCount}</span>
                {entry.followerQuantity && <span>Size: {entry.followerQuantity}</span>}
                {entry.followerPrice && <span>Price: {entry.followerPrice}</span>}
                {entry.nextRetryAt && (
                  <span aria-live="polite">
                    Next retry {countdownLabel(retryInSeconds ?? 0)} ({new Date(entry.nextRetryAt).toLocaleTimeString()})
                  </span>
                )}
                {!entry.nextRetryAt && !TERMINAL_GOOD.has(status) && !TERMINAL_BAD.has(status) && (
                  <span>Waiting on the exchange</span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
