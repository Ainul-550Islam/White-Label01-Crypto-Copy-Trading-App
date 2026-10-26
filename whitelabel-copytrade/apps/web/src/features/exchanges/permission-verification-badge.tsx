// # Responsibility: states what an exchange key is allowed to do — read-only, trade, or (never acceptable) withdrawal — and why that matters.
//
// A badge is the smallest surface on which a permission claim is shown, so it is
// also where a wrong claim does the most damage: "Read-only" on a key that can
// place orders is a false reassurance on the screen where a customer decides
// whether to trust the platform with a key. Three rules:
//
//   * WITHDRAW_ENABLED is never neutral. It is an error state, because a key that
//     can move funds off the exchange must be replaced, not labelled.
//   * An unverified key says UNVERIFIED. It must not fall back to "read-only"
//     just because trading is not known to be enabled.
//   * The badge states the permission the VENUE reported, not the one the customer
//     asked for. When the two disagree the badge shows the venue's answer, because
//     that is the one the exchange enforces.
'use client';
import type { JSX } from 'react';

/** What a key is, as verified against the venue. */
export type KeyPermissionClass = 'READ_ONLY' | 'TRADE' | 'WITHDRAW_ENABLED' | 'UNKNOWN';

const TONE: Record<KeyPermissionClass, { className: string; label: string }> = {
  TRADE: { className: 'border-emerald-300 bg-emerald-50 text-emerald-900', label: 'Trading enabled' },
  READ_ONLY: { className: 'border-slate-300 bg-slate-50 text-slate-900', label: 'Read-only' },
  WITHDRAW_ENABLED: { className: 'border-red-400 bg-red-50 text-red-900', label: 'Can withdraw — replace this key' },
  UNKNOWN: { className: 'border-amber-300 bg-amber-50 text-amber-900', label: 'Permissions not verified' },
};

const EXPLANATION: Record<KeyPermissionClass, string> = {
  TRADE:
    'This key can place and cancel orders, and cannot move funds off the exchange. That is what copy trading needs.',
  READ_ONLY:
    'This key can read balances and history. Copy orders will be refused by the exchange until a trading key is connected.',
  WITHDRAW_ENABLED:
    'This key can withdraw funds. Replace it with a key that has withdrawals disabled: this platform never trades with a key that can move money out.',
  UNKNOWN:
    'The exchange has not reported what this key may do, so the platform cannot say whether it may trade. Check the connection to verify it.',
};

export interface PermissionVerificationBadgeProps {
  /** Verified class, or null when the account has never been checked. */
  keyClass: KeyPermissionClass | null;
  /** ISO timestamp of the last verification; rendered as context, not as authority. */
  verifiedAt?: string | null;
  /** Show the sentence that explains the class (default true). */
  showExplanation?: boolean;
  className?: string;
}

function normalise(value: KeyPermissionClass | null): KeyPermissionClass {
  if (value === null) return 'UNKNOWN';
  return TONE[value] ? value : 'UNKNOWN';
}

export function PermissionVerificationBadge({
  keyClass,
  verifiedAt,
  showExplanation = true,
  className = '',
}: PermissionVerificationBadgeProps): JSX.Element {
  const resolved = normalise(keyClass);
  const tone = TONE[resolved];
  return (
    <div className={`inline-flex flex-col gap-1 ${className}`}>
      <span
        className={`inline-flex w-fit items-center rounded border px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${tone.className}`}
        role={resolved === 'WITHDRAW_ENABLED' ? 'alert' : 'status'}
      >
        {tone.label}
      </span>
      {showExplanation && <span className="max-w-prose text-xs text-muted">{EXPLANATION[resolved]}</span>}
      {verifiedAt && (
        <span className="text-[11px] text-muted">
          Checked {new Date(verifiedAt).toLocaleString()}
        </span>
      )}
    </div>
  );
}
