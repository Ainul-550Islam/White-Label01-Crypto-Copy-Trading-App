// # Responsibility: the customer's withdrawal address allowlist — add, see the activation countdown, revoke — where a new address is unusable until its cooldown elapses.
//
// THE COOLDOWN IS THE FEATURE
// ---------------------------
// Anything that lets a session add an address and immediately withdraw from it is
// a single-session path to emptying an account. So a new address is PENDING for a
// tenant-configured period (24 h by default), and this screen says so in the one
// place the customer will look: next to the address, with a live countdown.
//
// Three presentation decisions follow:
//
//   * PENDING is not shown as "saved". It is shown as "waiting", with the exact
//     time it becomes usable, because a customer who thinks it worked will attempt
//     a withdrawal that is refused and conclude the platform is broken.
//   * REVOKED stays visible for a while. Hiding it would make a revocation
//     indistinguishable from a bug, and a revoked address can never be re-added
//     (its cooldown would otherwise be reusable), which the customer needs to know.
//   * Every add and revoke needs a fresh step-up proof. The dialog is in the flow,
//     not a trap: when the API answers STEP_UP_REQUIRED the form asks for the code
//     and retries, instead of failing with a wall of red.
'use client';
import type { JSX } from 'react';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  withdrawalDestinationApi,
  type WithdrawalDestination,
  type WithdrawalDestinationMutation,
} from '@/api/security-api';
import { StepUpAuthDialog } from '@/features/security/step-up-auth-dialog';
import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { LoadingState } from '@/components/loading-state';

export const WITHDRAWAL_DESTINATIONS_QUERY_KEY = ['custody', 'withdrawal-destinations'] as const;

export const WITHDRAWAL_NETWORKS = [
  'ETHEREUM',
  'BSC',
  'POLYGON',
  'ARBITRUM',
  'BASE',
  'OPTIMISM',
  'AVALANCHE',
  'TRON',
  'SOLANA',
  'BITCOIN',
] as const;

/** Step-up action that authorises adding or revoking a destination. */
export const DESTINATION_STEP_UP_ACTION = 'PAYOUT_CREATE';

/**
 * Stable empty list, used until the query has data.
 *
 * A literal `?? []` creates a new array on every render, which makes any `useMemo`
 * over it recompute every time and makes the dependency array read as if it were
 * doing work it is not. One module-level frozen array is the same value for as long
 * as the query has nothing.
 */
const EMPTY_DESTINATIONS: readonly WithdrawalDestination[] = [];

function formatRemaining(ms: number): string {
  if (ms <= 0) return 'activating…';
  const totalMinutes = Math.ceil(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

function isStepUpRefusal(result: WithdrawalDestinationMutation): boolean {
  return result.code === 'STEP_UP_REQUIRED';
}

export function WithdrawalDestinationManager(): JSX.Element {
  const queryClient = useQueryClient();
  const destinationsQuery = useQuery({
    queryKey: WITHDRAWAL_DESTINATIONS_QUERY_KEY,
    queryFn: () => withdrawalDestinationApi.list(),
    // The list carries a cooldown countdown, so refresh it while the screen is open.
    refetchInterval: 60_000,
    retry: false,
  });

  const [network, setNetwork] = useState<string>('ETHEREUM');
  const [address, setAddress] = useState('');
  const [label, setLabel] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Identity checking is delegated to the shared dialog so this screen never handles
  // an authenticator code itself. The dialog offers authenticator, password and
  // recovery code, which matters here: a customer who withdraws rarely may not have
  // an authenticator set up, and a hard-coded "authenticator code" field would leave
  // them with no way to whitelist an address at all.
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  // `?? []` would build a new array on every render, so the memo below would recompute
  // every time and the dependency would be a lie. Depend on the query's own array.
  const rows = destinationsQuery.data ?? EMPTY_DESTINATIONS;
  const pending = useMemo(() => rows.filter((row) => row.status === 'PENDING'), [rows]);

  const addMutation = useMutation({
    mutationFn: () => withdrawalDestinationApi.add({ network, address: address.trim(), label: label.trim() }),
    onSuccess: (result) => {
      if (!result.ok) {
        if (isStepUpRefusal(result)) {
          setStepUpOpen(true);
          setFormError('Confirm your identity to add this address.');
          return;
        }
        setFormError(result.message);
        return;
      }
      setFormError(null);
      setNotice(result.message);
      setAddress('');
      setLabel('');
      void queryClient.invalidateQueries({ queryKey: WITHDRAWAL_DESTINATIONS_QUERY_KEY });
    },
    onError: (error: unknown) => {
      setFormError(error instanceof Error ? error.message : 'The address could not be added.');
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => withdrawalDestinationApi.revoke(id, 'Revoked by the account holder'),
    onSuccess: (result) => {
      setNotice(result.message);
      void queryClient.invalidateQueries({ queryKey: WITHDRAWAL_DESTINATIONS_QUERY_KEY });
    },
    onError: (error: unknown) => {
      setFormError(error instanceof Error ? error.message : 'The address could not be revoked.');
    },
  });

  if (destinationsQuery.isLoading) return <LoadingState />;
  if (destinationsQuery.error) {
    return <ErrorState error={destinationsQuery.error} onRetry={() => void destinationsQuery.refetch()} />;
  }

  return (
    <div className="grid gap-4">
      <section className="rounded border bg-card p-4">
        <h2 className="text-sm font-semibold">Withdrawal addresses</h2>
        <p className="mt-1 text-xs text-muted">
          Withdrawals are only sent to an address on this list. A new address waits out a safety period before it can
          be used — that wait is what stops a stolen session moving your funds to an address you do not control.
        </p>

        {pending.length > 0 && (
          <p className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900" role="status">
            {pending.length} address{pending.length === 1 ? '' : 'es'} still waiting to become usable. Until then a
            withdrawal to it will be refused.
          </p>
        )}

        {rows.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              title="No withdrawal addresses yet"
              description="Add the address you withdraw to. It becomes usable once its safety period has passed."
            />
          </div>
        ) : (
          <ul className="mt-3 grid gap-2">
            {rows.map((row) => (
              <DestinationRow
                key={row.id}
                destination={row}
                nowMs={now}
                revoking={revokeMutation.isPending}
                onRevoke={() => revokeMutation.mutate(row.id)}
              />
            ))}
          </ul>
        )}
      </section>

      <form
        className="grid gap-3 rounded border bg-card p-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (label.trim().length < 2) {
            setFormError('Give this address a label so you can recognise it later.');
            return;
          }
          if (address.trim().length < 16) {
            setFormError('Enter the full address.');
            return;
          }
          addMutation.mutate();
        }}
      >
        <h2 className="text-sm font-semibold">Add an address</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Network</span>
            <select className="rounded border px-3 py-2" value={network} onChange={(e) => setNetwork(e.target.value)}>
              {WITHDRAWAL_NETWORKS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Label</span>
            <input
              className="rounded border px-3 py-2"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Cold storage"
              maxLength={80}
            />
          </label>
        </div>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Address</span>
          <input
            className="rounded border px-3 py-2 font-mono"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <span className="text-xs text-muted">
            Paste it exactly. On networks with a case-sensitive address, the case is kept as you typed it.
          </span>
        </label>

        {formError && (
          <p className="text-xs text-red-700" role="alert">
            {formError}
          </p>
        )}
        {notice && (
          <p className="text-xs text-emerald-700" role="status">
            {notice}
          </p>
        )}

        <button
          type="submit"
          className="w-fit rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          disabled={addMutation.isPending}
        >
          {addMutation.isPending ? 'Adding…' : 'Add address'}
        </button>
      </form>

      <StepUpAuthDialog
        open={stepUpOpen}
        action={DESTINATION_STEP_UP_ACTION}
        onVerified={() => {
          setStepUpOpen(false);
          // The proof is single-use and bound to this action, so the add is retried
          // immediately with the same values the customer already entered.
          addMutation.mutate();
        }}
        onCancel={() => {
          setStepUpOpen(false);
          setFormError('The address was not added because your identity was not confirmed.');
        }}
      />
    </div>
  );
}

function DestinationRow({
  destination,
  nowMs,
  revoking,
  onRevoke,
}: {
  destination: WithdrawalDestination;
  nowMs: number;
  revoking: boolean;
  onRevoke: () => void;
}): JSX.Element {
  const activatesAt = Date.parse(destination.activatesAt);
  const remaining = Number.isFinite(activatesAt) ? Math.max(0, activatesAt - nowMs) : destination.remainingCooldownMs;
  const status = destination.status;

  const tone =
    status === 'ACTIVE'
      ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
      : status === 'PENDING'
        ? 'border-amber-300 bg-amber-50 text-amber-900'
        : 'border-slate-300 bg-slate-50 text-slate-900';

  return (
    <li className={`rounded border p-3 text-sm ${tone}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">
            {destination.label} <span className="opacity-70">· {destination.network}</span>
          </p>
          <p className="break-all font-mono text-xs opacity-80">{destination.address}</p>
        </div>
        <div className="text-right text-xs">
          <p className="font-semibold uppercase tracking-wide">{status}</p>
          {status === 'PENDING' && <p>usable in {formatRemaining(remaining)}</p>}
          {status === 'ACTIVE' && <p>usable now</p>}
          {status === 'REVOKED' && <p>never reusable</p>}
        </div>
      </div>
      {status !== 'REVOKED' && (
        <button
          type="button"
          className="mt-2 rounded border border-current px-3 py-1 text-xs font-medium"
          onClick={onRevoke}
          disabled={revoking}
        >
          Revoke
        </button>
      )}
    </li>
  );
}
