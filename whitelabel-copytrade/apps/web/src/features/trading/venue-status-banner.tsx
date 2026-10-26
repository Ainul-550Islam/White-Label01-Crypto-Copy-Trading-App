// # Responsibility: warns a trader, before they order, that an exchange they use is degraded, paused or of unknown state.
//
// Why a shell-level banner rather than a per-page notice: the failure this closes
// (GAP-72) is a customer submitting into an exchange that stopped accepting
// orders minutes ago, from whichever screen they happen to be on. A warning that
// only appears on the order ticket is a warning half the customers never see.
//
// Three behaviours are deliberate:
//
//   * It renders nothing when every venue the tenant uses is OPERATIONAL. A
//     permanent green bar trains people to ignore the red one.
//   * It renders nothing on a failed request. The banner polls; a transient 502
//     from our own proxy must not tell a customer their exchange is down. The
//     server's own answer is the only thing that raises a banner, and when the
//     server cannot answer the previous (or no) banner stands.
//   * It never claims a venue is fine when the platform is unsure. `UNKNOWN`
//     shows as its own warning, because "we cannot confirm this exchange is up"
//     is information a trader needs before sizing a position.
'use client';
import type { JSX } from 'react';

import { useQuery } from '@tanstack/react-query';

import {
  exchangeOpsApi,
  describeVenueState,
  venueDisplayName,
  worstVenueStatus,
  type VenueOperationalState,
} from '@/api/exchange-ops-api';
import { useAuth } from '@/auth/auth.store';

/** How often the shell re-asks. Venue status changes on the scale of minutes. */
const POLL_INTERVAL_MS = 60_000;

const TONE: Record<VenueOperationalState, { wrapper: string; label: string }> = {
  OUTAGE: { wrapper: 'border-red-300 bg-red-50 text-red-900', label: 'Exchange unavailable' },
  MAINTENANCE: { wrapper: 'border-amber-300 bg-amber-50 text-amber-900', label: 'Exchange paused' },
  DEGRADED: { wrapper: 'border-amber-300 bg-amber-50 text-amber-900', label: 'Limited trading' },
  UNKNOWN: { wrapper: 'border-slate-300 bg-slate-50 text-slate-900', label: 'Exchange status unknown' },
  OPERATIONAL: { wrapper: 'border-green-200 bg-green-50 text-green-900', label: 'Trading normally' },
};

export interface VenueStatusBannerProps {
  /**
   * Restrict the banner to these venues. Omitted, the banner follows every venue
   * the signed-in tenant has an account on - which is the set of venues where an
   * order could actually be placed.
   */
  venues?: readonly string[];
  /** Disable polling (used by screens that render their own live detail). */
  poll?: boolean;
}

/**
 * The banner. Renders `null` unless some venue the tenant uses is not
 * OPERATIONAL, so it costs one request a minute and no layout when all is well.
 *
 * The query is shared by key, so mounting the banner on every page reuses the
 * same cached answer rather than polling once per mount.
 */
export function VenueStatusBanner({ venues, poll = true }: VenueStatusBannerProps): JSX.Element | null {
  const { session } = useAuth();
  const permissions = session?.user.permissions ?? [];
  const { data, isFetching, refetch } = useQuery({
    queryKey: ['venues', 'status', session?.user.id ?? 'anonymous', venues?.join(',') ?? 'all', permissions.join(',')],
    queryFn: () => exchangeOpsApi.listVenueStatuses(venues),
    // A signed-out visitor gets no banner and no request.
    enabled: Boolean(session),
    staleTime: POLL_INTERVAL_MS,
    refetchInterval: poll ? POLL_INTERVAL_MS : false,
    // Keep the last good answer while a refetch is in flight: a failed poll must
    // not blank a warning the customer is currently reading.
    placeholderData: (previous) => previous,
  });

  const worst = worstVenueStatus(data ?? []);
  if (!worst) return null;

  const copy = describeVenueState(worst);
  const tone = TONE[worst.state];
  const others = (data ?? [])
    .filter((status) => status.state !== 'OPERATIONAL' && status.venue !== worst.venue)
    .map((status) => venueDisplayName(status.venue));

  return (
    <div className={`border-b px-4 py-2 text-sm ${tone.wrapper}`} role='status' aria-live='polite'>
      <div className='mx-auto flex max-w-7xl flex-wrap items-center gap-x-2 gap-y-1'>
        <span className='font-semibold'>{tone.label}:</span>
        <span className='font-medium'>{venueDisplayName(worst.venue)}</span>
        <span>{copy.detail}</span>
        {others.length > 0 && <span className='opacity-80'>Also affected: {others.join(', ')}.</span>}
        {!worst.verified && <span className='opacity-80'>This state could not be confirmed by the exchange itself.</span>}
        <button
          type='button'
          onClick={() => void refetch()}
          disabled={isFetching}
          className='ml-auto rounded border border-current px-2 py-0.5 text-xs font-medium disabled:opacity-50'
        >
          {isFetching ? 'Checking status' : 'Check again'}
        </button>
      </div>
      {worst.checkedAt && (
        <p className='mx-auto mt-1 max-w-7xl text-xs opacity-70'>
          Last checked {new Date(worst.checkedAt).toLocaleTimeString()}
          {poll ? '' : ' (live status paused on this screen)'}
        </p>
      )}
    </div>
  );
}
