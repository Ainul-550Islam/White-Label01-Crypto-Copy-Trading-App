// # Responsibility: renders one order's OMS state history as an ordered timeline and offers only the recovery actions that state allows, each behind a fresh step-up check.
//
// THE RULE THIS COMPONENT EXISTS TO ENFORCE
// -----------------------------------------
// An OMS state is a claim about what happened at a venue, and the platform is only
// allowed to make a different claim if it can prove it. So the buttons offered here
// are not "set the state to X": they are the transitions the state machine allows,
// and every one of them asks the engine to reconcile with the venue rather than
// trusting the operator's assertion.
//
// Three consequences:
//
//   * A terminal state (FILLED, CANCELED, REJECTED, EXPIRED) offers no transition
//     at all. Re-opening a settled order is how a duplicate fill happens.
//   * UNKNOWN is the state that most needs action and least supports guessing. It
//     offers reconciliation only, and the timeline says plainly that the platform
//     does not know whether the order reached the venue.
//   * The history is rendered oldest-first and read-only. Nothing in this component
//     can rewrite a transition that has already been recorded.
'use client';
import type { JSX } from 'react';

import { useState } from 'react';

import {
  adminStepUpApi,
  executionAdminApi,
  isStepUpRequired,
  type OrderStateRecoveryResult,
} from '@/api/execution-admin-api';

export interface OrderStateEntry {
  state: string;
  at: string;
  /** Who or what moved the order: ENGINE, RECONCILER, OPERATOR, VENUE. */
  actor: string;
  reason: string;
  venueOrderId?: string | null;
}

export interface OrderTimelineInput {
  orderId: string;
  symbol: string;
  side: string;
  quantity: string;
  state: string;
  entries: OrderStateEntry[];
}

/** Allowed next states per current state. Empty means terminal. */
export const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  CREATED: ['VALIDATED', 'REJECTED', 'CANCELED'],
  VALIDATED: ['SUBMITTED', 'REJECTED', 'CANCELED'],
  SUBMITTED: ['ACKNOWLEDGED', 'REJECTED', 'CANCELED'],
  ACKNOWLEDGED: ['PARTIALLY_FILLED', 'FILLED', 'CANCELED', 'EXPIRED'],
  PARTIALLY_FILLED: ['FILLED', 'CANCELED', 'EXPIRED'],
  // The only move out of UNKNOWN is a reconciliation; the platform must not be
  // able to assert an outcome it could not observe.
  UNKNOWN: ['RECONCILE'],
  CANCELED: [],
  FILLED: [],
  REJECTED: [],
  EXPIRED: [],
};

const TERMINAL = new Set(['FILLED', 'CANCELED', 'REJECTED', 'EXPIRED']);

/**
 * The style used for a state this build does not know.
 *
 * Spelled out as its own constant rather than `STATE_STYLE.UNKNOWN`: the index
 * type is `... | undefined`, so the fallback must be a value the compiler can see
 * is present, or every use needs a non-null assertion and the failure mode comes
 * back the first time someone forgets one.
 */
const FALLBACK_STATE_STYLE = { border: '#fca5a5', background: '#fef2f2', color: '#991b1b' };

const STATE_STYLE: Record<string, { border: string; background: string; color: string }> = {
  CREATED: { border: '#cbd5e1', background: '#f8fafc', color: '#334155' },
  VALIDATED: { border: '#cbd5e1', background: '#f8fafc', color: '#334155' },
  SUBMITTED: { border: '#93c5fd', background: '#eff6ff', color: '#1e3a8a' },
  ACKNOWLEDGED: { border: '#93c5fd', background: '#eff6ff', color: '#1e3a8a' },
  PARTIALLY_FILLED: { border: '#fcd34d', background: '#fffbeb', color: '#92400e' },
  FILLED: { border: '#6ee7b7', background: '#ecfdf5', color: '#065f46' },
  CANCELED: { border: '#cbd5e1', background: '#f8fafc', color: '#475569' },
  REJECTED: { border: '#fca5a5', background: '#fef2f2', color: '#991b1b' },
  EXPIRED: { border: '#cbd5e1', background: '#f8fafc', color: '#475569' },
  UNKNOWN: { border: '#fca5a5', background: '#fef2f2', color: '#991b1b' },
};

const ACTION_LABEL: Record<string, string> = {
  VALIDATED: 'Mark validated (venue accepted the order)',
  SUBMITTED: 'Mark submitted',
  ACKNOWLEDGED: 'Mark acknowledged by the venue',
  PARTIALLY_FILLED: 'Mark partially filled',
  FILLED: 'Mark filled',
  CANCELED: 'Mark canceled',
  REJECTED: 'Mark rejected',
  EXPIRED: 'Mark expired',
  RECONCILE: 'Reconcile with the venue',
};

export interface OrderStateTimelineProps {
  order: OrderTimelineInput;
  /** Called after a recovery request succeeds so the parent can refresh the order. */
  onRecovered?: (result: OrderStateRecoveryResult) => void;
}

export function OrderStateTimeline({ order, onRecovered }: OrderStateTimelineProps): JSX.Element {
  const [target, setTarget] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [code, setCode] = useState('');
  const [needsProof, setNeedsProof] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OrderStateRecoveryResult | null>(null);

  const current = order.state.toUpperCase();
  const allowed = ALLOWED_TRANSITIONS[current] ?? [];
  const entries = [...order.entries].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  async function submit(requested: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      if (needsProof) {
        await adminStepUpApi.issue({ action: 'ORDER_RECOVERY', method: 'TOTP', code: code.trim() });
        setNeedsProof(false);
        setCode('');
      }
      const response = await executionAdminApi.requestOrderRecovery({
        orderId: order.orderId,
        // RECONCILE is not a state: the engine decides what the venue's answer means.
        targetState: requested === 'RECONCILE' ? 'RECONCILED' : requested,
        reason: reason.trim() || `Operator recovery from ${current}`,
      });
      setResult(response);
      setTarget(null);
      setReason('');
      if (response.accepted) onRecovered?.(response);
      else if (response.code === 'STEP_UP_REQUIRED') {
        setNeedsProof(true);
        setError('This action needs a fresh identity check. Enter your authenticator code and try again.');
      } else setError(response.message);
    } catch (failure) {
      if (isStepUpRequired(failure)) {
        setNeedsProof(true);
        setError('This action needs a fresh identity check. Enter your authenticator code and try again.');
      } else {
        setError(failure instanceof Error ? failure.message : 'The recovery request was refused.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ display: 'grid', gap: 12 }}>
      <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
            {order.symbol} · {order.side} {order.quantity}
          </h2>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b', fontFamily: 'ui-monospace, monospace' }}>
            {order.orderId}
          </p>
        </div>
        <span
          style={{
            padding: '2px 10px',
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 600,
            border: `1px solid ${(STATE_STYLE[current] ?? FALLBACK_STATE_STYLE).border}`,
            background: (STATE_STYLE[current] ?? FALLBACK_STATE_STYLE).background,
            color: (STATE_STYLE[current] ?? FALLBACK_STATE_STYLE).color,
          }}
        >
          {current}
        </span>
      </header>

      {current === 'UNKNOWN' && (
        <p role="alert" style={{ margin: 0, padding: '8px 12px', borderRadius: 6, background: '#fef2f2', border: '1px solid #fca5a5', color: '#991b1b', fontSize: 13 }}>
          The platform does not know whether this order reached the venue. Reconcile before doing anything else; do not
          re-send it.
        </p>
      )}

      <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 8 }}>
        {entries.map((entry, index) => {
          const style = STATE_STYLE[entry.state.toUpperCase()] ?? FALLBACK_STATE_STYLE;
          return (
            <li
              key={`${entry.state}-${entry.at}-${index}`}
              style={{
                borderLeft: `3px solid ${style.border}`,
                paddingLeft: 10,
                display: 'grid',
                gap: 2,
              }}
            >
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline' }}>
                <strong style={{ fontSize: 13 }}>{entry.state}</strong>
                <span style={{ fontSize: 11, color: '#94a3b8' }}>{new Date(entry.at).toLocaleString()}</span>
                <span style={{ fontSize: 11, color: '#475569' }}>by {entry.actor}</span>
                {entry.venueOrderId && (
                  <span style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'ui-monospace, monospace' }}>
                    {entry.venueOrderId}
                  </span>
                )}
              </div>
              <p style={{ margin: 0, fontSize: 12, color: '#475569' }}>{entry.reason}</p>
            </li>
          );
        })}
      </ol>

      {TERMINAL.has(current) ? (
        <p style={{ margin: 0, fontSize: 12, color: '#475569' }}>
          This order is settled. No further state change is offered; a new copy order must be created instead.
        </p>
      ) : allowed.length === 0 ? (
        <p style={{ margin: 0, fontSize: 12, color: '#475569' }}>No recovery action is defined for {current}.</p>
      ) : (
        <div style={{ display: 'grid', gap: 8, borderTop: '1px solid #e2e8f0', paddingTop: 12 }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 600 }}>Recovery actions</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {allowed.map((state) => (
              <button
                key={state}
                type="button"
                onClick={() => {
                  setTarget(state);
                  setError(null);
                }}
                style={{
                  padding: '6px 12px',
                  fontSize: 12,
                  borderRadius: 6,
                  border: '1px solid #cbd5e1',
                  background: target === state ? '#0f172a' : '#ffffff',
                  color: target === state ? '#ffffff' : '#0f172a',
                  cursor: 'pointer',
                }}
              >
                {ACTION_LABEL[state] ?? state}
              </button>
            ))}
          </div>

          {target && (
            <form
              style={{ display: 'grid', gap: 8, maxWidth: 520 }}
              onSubmit={(event) => {
                event.preventDefault();
                void submit(target);
              }}
            >
              <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                <span style={{ fontWeight: 600 }}>Why? This is recorded on the order.</span>
                <textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows={2}
                  style={{ padding: 8, borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 12 }}
                  placeholder="Reconciled against the venue's order history after a timeout"
                />
              </label>
              {needsProof && (
                <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                  <span style={{ fontWeight: 600 }}>Authenticator code</span>
                  <input
                    value={code}
                    onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                    inputMode="numeric"
                    style={{ padding: 8, borderRadius: 6, border: '1px solid #cbd5e1', width: 120, fontFamily: 'ui-monospace, monospace' }}
                  />
                </label>
              )}
              {error && (
                <p role="alert" style={{ margin: 0, fontSize: 12, color: '#991b1b' }}>
                  {error}
                </p>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="submit"
                  disabled={busy || reason.trim().length < 8 || (needsProof && !/^\d{6}$/.test(code.trim()))}
                  style={{ padding: '6px 12px', fontSize: 12, borderRadius: 6, border: 'none', background: '#0f172a', color: '#ffffff', cursor: 'pointer' }}
                >
                  {busy ? 'Requesting…' : 'Request recovery'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTarget(null);
                    setError(null);
                  }}
                  style={{ padding: '6px 12px', fontSize: 12, borderRadius: 6, border: '1px solid #cbd5e1', background: '#ffffff' }}
                >
                  Cancel
                </button>
              </div>
              <p style={{ margin: 0, fontSize: 11, color: '#64748b' }}>
                The engine re-reads the order from the venue and may answer with a different state than the one
                requested. Whatever it proves is what gets recorded.
              </p>
            </form>
          )}

          {result && (
            <p
              role="status"
              style={{
                margin: 0,
                padding: '8px 12px',
                borderRadius: 6,
                fontSize: 12,
                background: result.accepted ? '#ecfdf5' : '#fef2f2',
                border: `1px solid ${result.accepted ? '#6ee7b7' : '#fca5a5'}`,
                color: result.accepted ? '#065f46' : '#991b1b',
              }}
            >
              {result.message} ({result.fromState} → {result.requestedState})
            </p>
          )}
        </div>
      )}
    </section>
  );
}
