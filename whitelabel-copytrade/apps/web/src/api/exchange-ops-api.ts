// # Responsibility: reads venue operational status for customer screens and translates it into copy a trader can act on.
//
// The backend (`apps/api/src/modules/exchanges/venue-status.controller.ts`)
// answers one question per venue: is this venue taking orders right now, and how
// sure are we? Three rules shape everything below, because this module is what a
// customer reads while an order is not filling:
//
//   1. UNKNOWN is not OPERATIONAL. A missing feed, a stale sample, a malformed
//      venue status or an unreadable answer all arrive as UNKNOWN, and every
//      helper in this file keeps it UNKNOWN. Rendering "all good" for "we do not
//      know" is the one failure that turns a platform outage into a support
//      ticket per customer.
//   2. The operator's `message` is not customer copy. The API returns a free-text
//      sentence written for an operator ("feed sample stale, override pending").
//      Customers get `describeVenueState` output, which is closed-vocabulary
//      copy keyed on the reason code. The operator sentence is available as
//      `operatorNote` and is deliberately not rendered by the customer banner.
//   3. Nothing here is inferred. `verified: false` means no first-party evidence
//      produced the answer, so the UI must say so rather than showing a venue as
//      healthy because the request happened to succeed.
import { apiClient } from './api-client';

/** Operational state of a venue, as the platform currently believes it to be. */
export type VenueOperationalState = 'OPERATIONAL' | 'DEGRADED' | 'MAINTENANCE' | 'OUTAGE' | 'UNKNOWN';

/** Which input decided the answer. `NONE` means no evidence at all. */
export type VenueStatusSource = 'OVERRIDE' | 'FEED' | 'ACCOUNT_HEALTH' | 'NONE';

/**
 * Why the answer is what it is. A closed set: the API refuses to invent one, and
 * so does this module - an unrecognised code falls back to `NO_SIGNAL` copy
 * rather than being shown raw.
 */
export type VenueStatusReason =
  | 'FEED_OPERATIONAL'
  | 'FEED_DEGRADED'
  | 'FEED_MAINTENANCE'
  | 'FEED_OUTAGE'
  | 'FEED_STATUS_UNRECOGNISED'
  | 'FEED_SAMPLE_STALE'
  | 'MANUAL_OVERRIDE'
  | 'MANUAL_OVERRIDE_EXPIRED'
  | 'NO_FEED_CONFIGURED'
  | 'ACCOUNT_HEALTH_DEGRADED'
  | 'NO_SIGNAL';

/** An operator-level override currently in force, if any. */
export interface VenueStatusOverride {
  venue: string;
  state: VenueOperationalState;
  /** Operator's justification, kept for the audit trail. Not customer copy. */
  reason: string;
  setBy: string;
  setAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

/** One venue's status, normalised for the UI. */
export interface VenueStatus {
  venue: string;
  state: VenueOperationalState;
  reason: VenueStatusReason;
  /** ISO timestamp of when the current state began. */
  since: string;
  messageCode: VenueStatusReason;
  /**
   * The operator-facing sentence. Kept so a support conversation can quote it,
   * and deliberately not rendered to customers - see `describeVenueState`.
   */
  operatorNote: string;
  source: VenueStatusSource;
  /** False when the answer rests on no first-party evidence. */
  verified: boolean;
  override: VenueStatusOverride | null;
  checkedAt: string;
}

/** The wire shape. Every field optional so a partial payload cannot crash a screen. */
interface BackendVenueStatus {
  venue?: string | null;
  state?: string | null;
  reason?: string | null;
  since?: string | null;
  messageCode?: string | null;
  message?: string | null;
  source?: string | null;
  verified?: boolean | null;
  override?: BackendVenueStatusOverride | null;
  checkedAt?: string | null;
}

interface BackendVenueStatusOverride {
  venue?: string | null;
  state?: string | null;
  reason?: string | null;
  setBy?: string | null;
  setAt?: string | null;
  expiresAt?: string | null;
  revokedAt?: string | null;
}

const VENUE_STATES: readonly VenueOperationalState[] = [
  'OPERATIONAL',
  'DEGRADED',
  'MAINTENANCE',
  'OUTAGE',
  'UNKNOWN',
];

const VENUE_STATUS_REASONS: readonly VenueStatusReason[] = [
  'FEED_OPERATIONAL',
  'FEED_DEGRADED',
  'FEED_MAINTENANCE',
  'FEED_OUTAGE',
  'FEED_STATUS_UNRECOGNISED',
  'FEED_SAMPLE_STALE',
  'MANUAL_OVERRIDE',
  'MANUAL_OVERRIDE_EXPIRED',
  'NO_FEED_CONFIGURED',
  'ACCOUNT_HEALTH_DEGRADED',
  'NO_SIGNAL',
];

const VENUE_STATUS_SOURCES: readonly VenueStatusSource[] = ['OVERRIDE', 'FEED', 'ACCOUNT_HEALTH', 'NONE'];

function toState(value: unknown): VenueOperationalState {
  const upper = typeof value === 'string' ? value.toUpperCase() : '';
  // Anything the backend did not send, or sent in a shape this build predates,
  // is UNKNOWN. Not OPERATIONAL: never guess in the customer's favour.
  return (VENUE_STATES as readonly string[]).includes(upper) ? (upper as VenueOperationalState) : 'UNKNOWN';
}

function toReason(value: unknown): VenueStatusReason {
  const upper = typeof value === 'string' ? value.toUpperCase() : '';
  return (VENUE_STATUS_REASONS as readonly string[]).includes(upper)
    ? (upper as VenueStatusReason)
    : 'NO_SIGNAL';
}

function toSource(value: unknown): VenueStatusSource {
  const upper = typeof value === 'string' ? value.toUpperCase() : '';
  return (VENUE_STATUS_SOURCES as readonly string[]).includes(upper)
    ? (upper as VenueStatusSource)
    : 'NONE';
}

function toOverride(raw: BackendVenueStatusOverride | null | undefined): VenueStatusOverride | null {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.revokedAt) return null;
  const state = toState(raw.state);
  // An override that names UNKNOWN asserts nothing, so it is not an override.
  if (state === 'UNKNOWN') return null;
  return {
    venue: raw.venue ?? '',
    state,
    reason: raw.reason ?? '',
    setBy: raw.setBy ?? '',
    setAt: raw.setAt ?? '',
    expiresAt: raw.expiresAt ?? '',
    revokedAt: null,
  };
}

/** Normalises one wire record. Exported so tests can drive it without a network. */
export function toVenueStatus(raw: BackendVenueStatus): VenueStatus {
  return {
    venue: (raw.venue ?? '').toUpperCase(),
    state: toState(raw.state),
    reason: toReason(raw.reason ?? raw.messageCode),
    since: raw.since ?? raw.checkedAt ?? '',
    messageCode: toReason(raw.messageCode ?? raw.reason),
    operatorNote: raw.message ?? '',
    source: toSource(raw.source),
    verified: raw.verified === true,
    override: toOverride(raw.override),
    checkedAt: raw.checkedAt ?? '',
  };
}

/** True when the venue may be expected to accept an order right now. */
export function isVenueTradable(status: VenueStatus): boolean {
  return status.state === 'OPERATIONAL';
}

/**
 * True when the customer should be warned before submitting.
 *
 * DEGRADED counts: the venue is up but cancellation-only, rate limited or
 * partially failed, and an order submitted into that gets stuck rather than
 * rejected. Warning is free; a stuck order is not.
 */
export function shouldWarnCustomer(status: VenueStatus): boolean {
  return status.state !== 'OPERATIONAL';
}

const CUSTOMER_COPY: Record<VenueStatusReason, { title: string; detail: string }> = {
  FEED_OPERATIONAL: {
    title: 'Trading normally',
    detail: 'The exchange reports normal operation.',
  },
  FEED_DEGRADED: {
    title: 'Limited trading',
    detail: 'The exchange reports reduced service. New orders may be delayed or rejected.',
  },
  FEED_MAINTENANCE: {
    title: 'Under maintenance',
    detail: 'The exchange is performing maintenance. Orders may be refused until it finishes.',
  },
  FEED_OUTAGE: {
    title: 'Exchange unavailable',
    detail: 'The exchange reports an outage. Orders cannot be placed right now.',
  },
  FEED_STATUS_UNRECOGNISED: {
    title: 'Exchange status unclear',
    detail: 'The exchange reported a status this platform does not recognise, so it is treated as unknown.',
  },
  FEED_SAMPLE_STALE: {
    title: 'Exchange status out of date',
    detail: 'The link to the exchange status feed is not current, so its state is unknown.',
  },
  MANUAL_OVERRIDE: {
    title: 'Trading paused by the platform',
    detail: 'Operations have paused this exchange. Orders placed now will wait until it reopens.',
  },
  MANUAL_OVERRIDE_EXPIRED: {
    title: 'Trading resumed',
    detail: 'The pause on this exchange has ended and the exchange status feed applies again.',
  },
  NO_FEED_CONFIGURED: {
    title: 'Exchange status unavailable',
    detail: 'This platform has no status feed for the exchange, so its state cannot be confirmed.',
  },
  ACCOUNT_HEALTH_DEGRADED: {
    title: 'Connection problem',
    detail: 'The API key for this exchange is failing checks. Trading may not work until it recovers.',
  },
  NO_SIGNAL: {
    title: 'Exchange status unknown',
    detail: 'No current information about this exchange is available.',
  },
};

const UNKNOWN_COPY = CUSTOMER_COPY.NO_SIGNAL;

/**
 * Customer-facing copy for a status. Closed vocabulary, keyed on the reason, so
 * no operator phrase reaches a customer screen and no state is ever described as
 * healthy without evidence.
 */
export function describeVenueState(status: VenueStatus): { title: string; detail: string } {
  if (!status.verified && status.state === 'OPERATIONAL') {
    // An unverified OPERATIONAL would be the single case where a customer is
    // told everything is fine on no evidence. Refuse it here as well as on the
    // server, because a cached payload can outlive the server's honesty.
    return UNKNOWN_COPY;
  }
  return CUSTOMER_COPY[status.messageCode] ?? UNKNOWN_COPY;
}

/** Severity ordering used to pick the banner when several venues are affected. */
export function venueStateSeverity(state: VenueOperationalState): number {
  switch (state) {
    case 'OUTAGE':
      return 4;
    case 'MAINTENANCE':
      return 3;
    case 'DEGRADED':
      return 2;
    case 'UNKNOWN':
      return 1;
    case 'OPERATIONAL':
    default:
      return 0;
  }
}

/** The most severe status in a list, or `null` when every venue is fine. */
export function worstVenueStatus(statuses: VenueStatus[]): VenueStatus | null {
  let worst: VenueStatus | null = null;
  for (const status of statuses) {
    if (!shouldWarnCustomer(status)) continue;
    if (worst === null || venueStateSeverity(status.state) > venueStateSeverity(worst.state)) {
      worst = status;
    }
  }
  return worst;
}

/** `BINANCE` -> `Binance`. Display only; the wire value is never transformed. */
export function venueDisplayName(venue: string): string {
  if (!venue) return 'the exchange';
  return venue.charAt(0) + venue.slice(1).toLowerCase();
}

/**
 * Venue status for the signed-in tenant.
 *
 * `venues` narrows the query; omitting it asks for every venue the tenant has an
 * account on, which is what the banner wants - a customer who has never traded
 * on an exchange should not be warned about it.
 */
export const exchangeOpsApi = {
  listVenueStatuses: async (venues?: readonly string[]): Promise<VenueStatus[]> => {
    const page = await apiClient.get<{ venues?: BackendVenueStatus[] }>('/v1/venues/status', {
      searchParams: venues && venues.length > 0 ? { venues: venues.join(',') } : undefined,
    });
    const rows = Array.isArray(page?.venues) ? page.venues : [];
    return rows.map(toVenueStatus);
  },

  getVenueStatus: async (venue: string): Promise<VenueStatus> =>
    toVenueStatus(
      await apiClient.get<BackendVenueStatus>(`/v1/venues/${encodeURIComponent(venue.toUpperCase())}/status`),
    ),
};

/** One capability row of an account's health matrix. */
export interface AccountCapabilityRow {
  capability: string;
  state: 'OK' | 'DEGRADED' | 'RISK' | 'UNKNOWN' | 'UNHEALTHY';
  reason: string;
  granted: boolean;
  detail: string;
  countsTowardOverall: boolean;
}

export interface AccountCapabilityHealth {
  tenantId: string;
  accountId: string;
  venue: string;
  environment: string;
  overall: 'HEALTHY' | 'DEGRADED' | 'RISK' | 'UNHEALTHY' | 'UNKNOWN';
  capabilities: AccountCapabilityRow[];
  verifiedAt: string | null;
  evidenceAgeMs: number | null;
  requiresAction: string[];
  checkedAt: string;
}

/** Health of one exchange account's private user-data stream. UNKNOWN is a real answer. */
export interface UserStreamHealth {
  tenantId: string;
  accountId: string;
  venue: string;
  environment: string;
  state: 'CONNECTED' | 'DEGRADED' | 'DISCONNECTED' | 'UNKNOWN';
  lastEventAt: string | null;
  lastEventAgeMs: number | null;
  reconnectCount: number;
  listenKeyAgeMs: number | null;
  listenKeyExpiresInMs: number | null;
  reason: string;
  checkedAt: string;
}

export const accountHealthApi = {
  /**
   * The capability matrix. A GET: opening the account screen must not spend the
   * customer's venue rate limit on a permissions read.
   */
  getCapabilityHealth: async (accountId: string): Promise<AccountCapabilityHealth> => {
    const raw = await apiClient.get<Record<string, unknown>>(
      `/v1/exchanges/accounts/${encodeURIComponent(accountId)}/capability-health`,
    );
    const rows = Array.isArray(raw?.capabilities) ? (raw.capabilities as AccountCapabilityRow[]) : [];
    const overall = String(raw?.overall ?? 'UNKNOWN').toUpperCase();
    return {
      tenantId: String(raw?.tenantId ?? ''),
      accountId: String(raw?.accountId ?? accountId),
      venue: String(raw?.venue ?? 'UNKNOWN'),
      environment: String(raw?.environment ?? 'UNKNOWN'),
      overall: (['HEALTHY', 'DEGRADED', 'RISK', 'UNHEALTHY'].includes(overall) ? overall : 'UNKNOWN') as AccountCapabilityHealth['overall'],
      capabilities: rows,
      verifiedAt: typeof raw?.verifiedAt === 'string' ? raw.verifiedAt : null,
      evidenceAgeMs: typeof raw?.evidenceAgeMs === 'number' ? raw.evidenceAgeMs : null,
      requiresAction: Array.isArray(raw?.requiresAction) ? (raw.requiresAction as string[]) : [],
      checkedAt: String(raw?.checkedAt ?? ''),
    };
  },

  /** The private stream's state. `DEGRADED` and `UNKNOWN` are rendered as such, never as fine. */
  getUserStream: async (accountId: string): Promise<UserStreamHealth> => {
    const raw = await apiClient.get<Record<string, unknown>>(
      `/v1/exchanges/${encodeURIComponent(accountId)}/user-stream`,
    );
    const state = String(raw?.state ?? 'UNKNOWN').toUpperCase();
    return {
      tenantId: String(raw?.tenantId ?? ''),
      accountId: String(raw?.accountId ?? accountId),
      venue: String(raw?.venue ?? 'UNKNOWN'),
      environment: String(raw?.environment ?? 'UNKNOWN'),
      state: (['CONNECTED', 'DEGRADED', 'DISCONNECTED'].includes(state) ? state : 'UNKNOWN') as UserStreamHealth['state'],
      lastEventAt: typeof raw?.lastEventAt === 'string' ? raw.lastEventAt : null,
      lastEventAgeMs: typeof raw?.lastEventAgeMs === 'number' ? raw.lastEventAgeMs : null,
      reconnectCount: typeof raw?.reconnectCount === 'number' ? raw.reconnectCount : 0,
      listenKeyAgeMs: typeof raw?.listenKeyAgeMs === 'number' ? raw.listenKeyAgeMs : null,
      listenKeyExpiresInMs: typeof raw?.listenKeyExpiresInMs === 'number' ? raw.listenKeyExpiresInMs : null,
      reason: String(raw?.reason ?? 'NO_EVIDENCE'),
      checkedAt: String(raw?.checkedAt ?? ''),
    };
  },
};
