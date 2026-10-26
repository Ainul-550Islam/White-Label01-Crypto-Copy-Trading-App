// # Responsibility: the browser-side container that wires the stream-health table, the venue override console and the order timeline to the admin API.
//
// WHY A CONTAINER EXISTS AT ALL
// -----------------------------
// The three views below are pure: they take rows and callbacks and render them. That
// keeps their markup testable and keeps every decision about "what is a venue's
// state" on the server. Something has to own the fetching and the transient UI state
// (which venue is being edited, which order the operator is inspecting), and the
// console pages are server components that cannot hold it.
//
// Two behaviours worth naming:
//
//   * An override that comes back STEP_UP_REQUIRED is not retried automatically.
//     The panel asks for an authenticator code and re-submits only after the
//     operator provides one; a silent retry would spend a proof the operator never
//     consciously gave.
//   * A refused override leaves the table exactly as it was. The console's rows are
//     refreshed from the server after a successful write, never optimistically
//     patched, because a venue shown as paused when it is not is the worst possible
//     lie on this screen.
'use client';
import type { JSX } from 'react';

import { useState } from 'react';

import {
  adminStepUpApi,
  executionAdminApi,
  isStepUpRequired,
  type StreamHealthRow,
  type VenueState,
  type VenueStatusRow,
} from '@/api/execution-admin-api';
import { Card } from '@/components/ui';
import { theme } from '@/lib/theme';
import { ExchangeStreamHealth } from './exchange-stream-health';
import { OrderStateTimeline, type OrderTimelineInput } from './order-state-timeline';
import {
  VenueStatusConsole,
  type AssertableVenueState,
  type VenueStatusRow as ConsoleVenueRow,
} from './venue-status-console';

/** The console's view of a venue, built from the API row. */
function toConsoleRow(row: VenueStatusRow): ConsoleVenueRow {
  return {
    venue: row.venue,
    state: row.state,
    source: row.source,
    reason: row.reason,
    since: row.since,
    verified: row.verified,
    customerMessage: row.message,
    override: row.override
      ? {
          state: row.override.state,
          reason: row.override.reason,
          setBy: row.override.setBy ?? 'unknown',
          setAt: row.override.setAt,
          expiresAt: row.override.expiresAt,
        }
      : null,
    checkedAt: row.checkedAt,
  };
}

export interface ExecutionOpsPanelProps {
  initialStreams: StreamHealthRow[];
  initialVenues: VenueStatusRow[];
  /** Server-side failures, shown rather than hidden. */
  initialErrors?: string[];
}

export function ExecutionOpsPanel({
  initialStreams,
  initialVenues,
  initialErrors = [],
}: ExecutionOpsPanelProps): JSX.Element {
  const [venues, setVenues] = useState<VenueStatusRow[]>(initialVenues);
  const [editingVenue, setEditingVenue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsProof, setNeedsProof] = useState(false);
  const [proofCode, setProofCode] = useState('');
  const [pendingOverride, setPendingOverride] = useState<{
    venue: string;
    state: AssertableVenueState;
    reason: string;
    ttlSeconds: number;
  } | null>(null);

  const [orderId, setOrderId] = useState('');
  const [order, setOrder] = useState<OrderTimelineInput | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [orderBusy, setOrderBusy] = useState(false);

  async function refreshVenues(): Promise<void> {
    const next = await executionAdminApi.listVenueStatuses();
    setVenues(next);
  }

  async function publishOverride(input: {
    venue: string;
    state: AssertableVenueState;
    reason: string;
    ttlSeconds: number;
  }): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      if (needsProof) {
        await adminStepUpApi.issue({ action: 'VENUE_STATUS_OVERRIDE', method: 'TOTP', code: proofCode.trim() });
        setNeedsProof(false);
        setProofCode('');
      }
      const result = await executionAdminApi.setVenueOverride({
        venue: input.venue,
        state: input.state as VenueState,
        reason: input.reason,
        ttlSeconds: input.ttlSeconds,
      });
      if (!result.applied) {
        if (result.code === 'STEP_UP_REQUIRED') {
          setPendingOverride(input);
          setNeedsProof(true);
          setError('This override needs a fresh identity check. Enter your authenticator code, then publish again.');
          return;
        }
        setError(result.message);
        return;
      }
      setEditingVenue(null);
      setPendingOverride(null);
      await refreshVenues();
    } catch (failure) {
      if (isStepUpRequired(failure)) {
        setPendingOverride(input);
        setNeedsProof(true);
        setError('This override needs a fresh identity check. Enter your authenticator code, then publish again.');
      } else {
        setError(failure instanceof Error ? failure.message : 'The override was refused.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function clearOverride(venue: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await executionAdminApi.clearVenueOverride(venue);
      if (!result.applied) {
        setError(result.message);
        return;
      }
      setEditingVenue(null);
      await refreshVenues();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The override could not be cleared.');
    } finally {
      setBusy(false);
    }
  }

  async function loadOrder(): Promise<void> {
    const id = orderId.trim();
    if (id.length < 8) {
      setOrderError('Enter the full order id.');
      return;
    }
    setOrderBusy(true);
    setOrderError(null);
    try {
      const timeline = await executionAdminApi.getOrderTimeline(id);
      if (!timeline) {
        setOrder(null);
        setOrderError('No order with that id is known to the platform.');
        return;
      }
      setOrder(timeline);
    } catch (failure) {
      setOrder(null);
      setOrderError(failure instanceof Error ? failure.message : 'The order timeline could not be loaded.');
    } finally {
      setOrderBusy(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: theme.space(5) }}>
      {initialErrors.length > 0 && (
        <p
          role="alert"
          style={{
            margin: 0,
            padding: '8px 12px',
            borderRadius: 6,
            background: '#fffbeb',
            border: '1px solid #fcd34d',
            color: '#92400e',
            fontSize: 13,
          }}
        >
          {initialErrors.join(' · ')}
        </p>
      )}

      <Card
        title="Exchange streams"
        description="Every account's user-data stream, how long since its last event, and whether its listen key is about to lapse."
      >
        <ExchangeStreamHealth initialRows={initialStreams} />
      </Card>

      <Card
        title="Venue status"
        description="Override a venue's operational state for a bounded time. The customer message shown here is the sentence your override produces."
      >
        {error && (
          <p role="alert" style={{ margin: '0 0 12px', fontSize: 13, color: '#991b1b' }}>
            {error}
          </p>
        )}
        {needsProof && (
          <label style={{ display: 'grid', gap: 4, fontSize: 12, marginBottom: 12, maxWidth: 200 }}>
            <span style={{ fontWeight: 600 }}>Authenticator code</span>
            <input
              value={proofCode}
              onChange={(event) => setProofCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #cbd5e1', fontFamily: 'ui-monospace, monospace' }}
            />
            {pendingOverride && (
              <button
                type="button"
                disabled={busy || !/^\d{6}$/.test(proofCode.trim())}
                onClick={() => void publishOverride(pendingOverride)}
                style={{ marginTop: 4, padding: '6px 12px', fontSize: 12, borderRadius: 6, border: 'none', background: '#0f172a', color: '#ffffff' }}
              >
                Publish with this code
              </button>
            )}
          </label>
        )}
        <VenueStatusConsole
          rows={venues.map(toConsoleRow)}
          editingVenue={editingVenue}
          onEdit={(venue) => {
            setEditingVenue(venue);
            setError(null);
          }}
          onSetOverride={publishOverride}
          onClearOverride={clearOverride}
          error={error}
          busy={busy}
          stepUpRequired={needsProof}
        />
      </Card>

      <Card
        title="Order inspector"
        description="Look up one order's recorded state history and the recovery actions its current state allows."
      >
        <form
          style={{ display: 'flex', gap: 8, marginBottom: 12 }}
          onSubmit={(event) => {
            event.preventDefault();
            void loadOrder();
          }}
        >
          <input
            value={orderId}
            onChange={(event) => setOrderId(event.target.value)}
            placeholder="Order id"
            style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 12, minWidth: 320, fontFamily: 'ui-monospace, monospace' }}
          />
          <button
            type="submit"
            disabled={orderBusy}
            style={{ padding: '6px 12px', fontSize: 12, borderRadius: 6, border: '1px solid #cbd5e1', background: '#ffffff', cursor: 'pointer' }}
          >
            {orderBusy ? 'Loading…' : 'Load timeline'}
          </button>
        </form>
        {orderError && (
          <p role="alert" style={{ margin: 0, fontSize: 12, color: '#991b1b' }}>
            {orderError}
          </p>
        )}
        {order && (
          <OrderStateTimeline
            order={order}
            onRecovered={() => {
              void loadOrder();
            }}
          />
        )}
      </Card>
    </div>
  );
}
