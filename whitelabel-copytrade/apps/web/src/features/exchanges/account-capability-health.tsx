// # Responsibility: shows the per-capability health of one exchange account — what the venue says this key may do, what is actually working, and what the customer must fix.
//
// `healthState` alone cannot express the states that matter most here: reads fine
// and trading refused; trading fine and the key able to withdraw; nothing verified
// at all. So this panel renders the capability matrix from the API row by row, and
// the overall verdict is only as good as its worst counted row.
//
// Two presentation rules follow from the money at stake:
//
//   * RISK (a withdraw-capable key) is never shown in the same visual family as a
//     limitation. It is red, it is first, and it carries the instruction.
//   * UNKNOWN is not DEGRADED and neither is OK. An unverified key shows as
//     unverified, because "we have not checked" is different information from
//     "we checked and it is limited" - and the customer's next action differs.
'use client';
import type { JSX } from 'react';

import { useMemo } from 'react';

import { PermissionVerificationBadge, type KeyPermissionClass } from './permission-verification-badge';

export type CapabilityState = 'OK' | 'DEGRADED' | 'RISK' | 'UNKNOWN' | 'UNHEALTHY';

export interface CapabilityRow {
  capability: 'READ' | 'TRADE' | 'WITHDRAW' | 'MARGIN' | string;
  state: CapabilityState;
  reason: string;
  granted: boolean;
  detail: string;
  countsTowardOverall?: boolean;
}

export interface AccountCapabilityHealthView {
  accountId: string;
  venue: string;
  environment: string;
  overall: 'HEALTHY' | 'DEGRADED' | 'RISK' | 'UNHEALTHY' | 'UNKNOWN';
  capabilities: CapabilityRow[];
  verifiedAt: string | null;
  evidenceAgeMs: number | null;
  requiresAction: string[];
}

const STATE_TONE: Record<CapabilityState, string> = {
  OK: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  DEGRADED: 'border-amber-300 bg-amber-50 text-amber-900',
  RISK: 'border-red-400 bg-red-50 text-red-900',
  UNHEALTHY: 'border-red-400 bg-red-50 text-red-900',
  UNKNOWN: 'border-slate-300 bg-slate-50 text-slate-900',
};

const OVERALL_COPY: Record<AccountCapabilityHealthView['overall'], { label: string; tone: string }> = {
  HEALTHY: { label: 'Healthy', tone: 'border-emerald-300 bg-emerald-50 text-emerald-900' },
  DEGRADED: { label: 'Limited', tone: 'border-amber-300 bg-amber-50 text-amber-900' },
  RISK: { label: 'Action required', tone: 'border-red-400 bg-red-50 text-red-900' },
  UNHEALTHY: { label: 'Not working', tone: 'border-red-400 bg-red-50 text-red-900' },
  UNKNOWN: { label: 'Not verified', tone: 'border-slate-300 bg-slate-50 text-slate-900' },
};

const ACTION_COPY: Record<string, string> = {
  ROTATE_KEY_WITHOUT_WITHDRAWAL: 'Replace this key with one that cannot withdraw funds.',
  RECONNECT_KEY: 'Reconnect the exchange account with a working key.',
  VERIFY_PERMISSIONS: 'Run a permission check against the exchange.',
};

const CAPABILITY_LABEL: Record<string, string> = {
  READ: 'Read balances',
  TRADE: 'Place orders',
  WITHDRAW: 'Withdraw funds',
  MARGIN: 'Margin trading',
};

function severity(state: CapabilityState): number {
  switch (state) {
    case 'RISK':
      return 4;
    case 'UNHEALTHY':
      return 3;
    case 'DEGRADED':
      return 2;
    case 'UNKNOWN':
      return 1;
    default:
      return 0;
  }
}

/** Age of the evidence in whole hours, or null when nothing was ever verified. */
function evidenceAgeLabel(evidenceAgeMs: number | null): string {
  if (evidenceAgeMs === null) return 'never verified';
  const hours = Math.floor(evidenceAgeMs / 3_600_000);
  if (hours < 1) return 'verified in the last hour';
  if (hours < 48) return `verified ${hours}h ago`;
  return `verified ${Math.floor(hours / 24)} days ago`;
}

/** The class to show in the badge, derived from the matrix rather than stored twice. */
export function permissionClassFromMatrix(view: AccountCapabilityHealthView): KeyPermissionClass {
  const withdraw = view.capabilities.find((row) => row.capability === 'WITHDRAW');
  if (!withdraw || withdraw.state === 'UNKNOWN') return 'UNKNOWN';
  if (withdraw.state === 'RISK') return 'WITHDRAW_ENABLED';
  const trade = view.capabilities.find((row) => row.capability === 'TRADE');
  if (!trade || trade.state === 'UNKNOWN') return 'UNKNOWN';
  return trade.state === 'OK' || trade.state === 'DEGRADED' ? 'TRADE' : 'READ_ONLY';
}

export interface AccountCapabilityHealthProps {
  health: AccountCapabilityHealthView;
  /** Called when the customer chooses to replace the key (opens rotation). */
  onRotateKey?: () => void;
  /** Called when the customer chooses to re-run verification. */
  onVerify?: () => void;
}

export function AccountCapabilityHealth({ health, onRotateKey, onVerify }: AccountCapabilityHealthProps): JSX.Element {
  const rows = useMemo(
    () =>
      [...health.capabilities].sort((a, b) => {
        const bySeverity = severity(b.state) - severity(a.state);
        if (bySeverity !== 0) return bySeverity;
        // Rows that cannot drag the verdict down (a spot-only venue not offering
        // margin) sort last, so the fixable problems are at the top.
        return Number(b.countsTowardOverall ?? true) - Number(a.countsTowardOverall ?? true);
      }),
    [health.capabilities],
  );
  const overall = OVERALL_COPY[health.overall] ?? OVERALL_COPY.UNKNOWN;
  const withdrawRisk = rows.some((row) => row.capability === 'WITHDRAW' && row.state === 'RISK');

  return (
    <section className="grid gap-3 rounded border bg-card p-4" aria-label="Exchange account capability health">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">
            {health.venue} · {health.environment}
          </h2>
          <p className="text-xs text-muted">{evidenceAgeLabel(health.evidenceAgeMs)}</p>
        </div>
        <span className={`rounded border px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${overall.tone}`}>
          {overall.label}
        </span>
      </header>

      <PermissionVerificationBadge keyClass={permissionClassFromMatrix(health)} verifiedAt={health.verifiedAt} />

      {withdrawRisk && (
        <p className="rounded border border-red-400 bg-red-50 p-2 text-xs text-red-900" role="alert">
          This key can withdraw funds. Nothing else about the account is safe to rely on until it is replaced.
        </p>
      )}

      <ul className="grid gap-2">
        {rows.map((row) => (
          <li key={row.capability} className={`rounded border p-2 text-sm ${STATE_TONE[row.state] ?? STATE_TONE.UNKNOWN}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium">{CAPABILITY_LABEL[row.capability] ?? row.capability}</span>
              <span className="text-xs uppercase tracking-wide">{row.state}</span>
            </div>
            <p className="mt-1 text-xs">{row.detail}</p>
            <p className="mt-1 text-[11px] opacity-60">{row.reason}</p>
          </li>
        ))}
      </ul>

      {health.requiresAction.length > 0 && (
        <div className="rounded border border-dashed p-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">What to do</p>
          <ul className="mt-1 list-disc pl-4 text-xs">
            {health.requiresAction.map((action) => (
              <li key={action}>{ACTION_COPY[action] ?? action}</li>
            ))}
          </ul>
          <div className="mt-2 flex gap-2">
            {onRotateKey && health.requiresAction.includes('ROTATE_KEY_WITHOUT_WITHDRAWAL') && (
              <button type="button" className="rounded bg-red-600 px-3 py-1 text-xs font-medium text-white" onClick={onRotateKey}>
                Replace the key
              </button>
            )}
            {onVerify && health.requiresAction.includes('VERIFY_PERMISSIONS') && (
              <button type="button" className="rounded border px-3 py-1 text-xs font-medium" onClick={onVerify}>
                Check permissions now
              </button>
            )}
            {onRotateKey && health.requiresAction.includes('RECONNECT_KEY') && (
              <button type="button" className="rounded border px-3 py-1 text-xs font-medium" onClick={onRotateKey}>
                Reconnect
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
