// # Responsibility: the operator console's typed client for stream health, venue status and overrides, order-state recovery and withdrawal-destination audit.
//
// WHY THIS IS A SEPARATE FILE FROM THE CUSTOMER CLIENT
// ---------------------------------------------------
// The console and the customer app ask the platform different questions about the
// same venues. A customer sees "this venue is in maintenance"; an operator sees the
// feed sample age, whether the state came from an override, who set it and when it
// expires. Sharing one client would either leak operator detail into customer
// screens or hide it from the operator, so the two surfaces get two clients with
// two shapes.
//
// Every write here is an operator action on live money. Three rules therefore apply
// to all of them, and each is enforced by the API, mirrored here so the console
// cannot pretend otherwise:
//
//   * a fresh step-up proof is required (`STEP_UP_REQUIRED` comes back as a normal
//     refusal, not an exception);
//   * an override must state an expiry - there is no "until further notice";
//   * a refusal is a typed result, so the console shows the reason instead of
//     swallowing it. A silent failure on a console that can put a venue into
//     maintenance is worse than a loud one.
import { apiClient } from '@/lib/api-client';

export type VenueState = 'OPERATIONAL' | 'DEGRADED' | 'MAINTENANCE' | 'OUTAGE' | 'UNKNOWN';
export type VenueStatusSource = 'OVERRIDE' | 'FEED' | 'ACCOUNT_HEALTH' | 'NONE';
export type StreamState = 'CONNECTED' | 'DEGRADED' | 'DISCONNECTED' | 'UNKNOWN';

export interface VenueStatusRow {
  venue: string;
  state: VenueState;
  reason: string;
  source: VenueStatusSource;
  since: string;
  verified: boolean;
  message: string;
  checkedAt: string;
  override: {
    state: VenueState;
    reason: string;
    setBy: string | null;
    setAt: string;
    expiresAt: string;
    expired: boolean;
  } | null;
  evidence: {
    feedState: VenueState | null;
    feedSampleAgeMs: number | null;
    engineHealthy: boolean | null;
    accountsDegraded: number;
  };
}

export interface VenueOverrideResponse {
  applied: boolean;
  code: string;
  message: string;
}

export interface StreamHealthRow {
  accountId: string;
  tenantId: string;
  venue: string;
  environment: string;
  state: StreamState;
  lastEventAt: string | null;
  lastEventAgeMs: number | null;
  reconnectCount: number;
  listenKeyAgeMs: number | null;
  listenKeyExpiresInMs: number | null;
  reason: string;
  checkedAt: string;
}

export interface OrderStateRecoveryResult {
  accepted: boolean;
  code: string;
  message: string;
  orderId: string;
  fromState: string;
  requestedState: string;
}

export interface DestinationAuditRow {
  id: string;
  tenantId: string;
  userId: string;
  network: string;
  address: string;
  label: string;
  status: string;
  activatesAt: string;
  revokedAt: string | null;
  createdAt: string;
  decisions: Array<{ at: string; decision: string; reason: string }>;
}

const NOT_CONFIRMED = 'The platform did not confirm that request. Nothing was changed.';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

/** `retryAfterSeconds` from a refusal body, so the console can say when to retry. */
export function refusalRetryAfter(payload: unknown): number | null {
  return num(asRecord(payload).retryAfterSeconds);
}

export function toStreamHealthRow(raw: unknown): StreamHealthRow {
  const row = asRecord(raw);
  const state = text(row.state, 'UNKNOWN').toUpperCase();
  return {
    accountId: text(row.accountId),
    tenantId: text(row.tenantId),
    venue: text(row.venue, 'UNKNOWN'),
    environment: text(row.environment, 'UNKNOWN'),
    // Anything unrecognised is UNKNOWN: a console that guesses CONNECTED will miss
    // a dead stream, which is the failure this panel exists to catch.
    state:
      state === 'CONNECTED' || state === 'DEGRADED' || state === 'DISCONNECTED'
        ? (state as StreamState)
        : 'UNKNOWN',
    lastEventAt: typeof row.lastEventAt === 'string' ? row.lastEventAt : null,
    lastEventAgeMs: num(row.lastEventAgeMs),
    reconnectCount: num(row.reconnectCount) ?? 0,
    listenKeyAgeMs: num(row.listenKeyAgeMs),
    listenKeyExpiresInMs: num(row.listenKeyExpiresInMs),
    reason: text(row.reason, 'NO_EVIDENCE'),
    checkedAt: text(row.checkedAt),
  };
}

export function toVenueStatusRow(raw: unknown): VenueStatusRow {
  const row = asRecord(raw);
  const state = text(row.state, 'UNKNOWN').toUpperCase();
  const override = row.override ? asRecord(row.override) : null;
  return {
    venue: text(row.venue, 'UNKNOWN'),
    state: (['OPERATIONAL', 'DEGRADED', 'MAINTENANCE', 'OUTAGE'].includes(state) ? state : 'UNKNOWN') as VenueState,
    reason: text(row.reason, 'NO_EVIDENCE'),
    source: (text(row.source, 'NONE') as VenueStatusSource) ?? 'NONE',
    since: text(row.since),
    verified: row.verified === true,
    message: text(row.message),
    checkedAt: text(row.checkedAt),
    override: override
      ? {
          state: text(override.state, 'UNKNOWN').toUpperCase() as VenueState,
          reason: text(override.reason),
          setBy: typeof override.setBy === 'string' ? override.setBy : null,
          setAt: text(override.setAt),
          expiresAt: text(override.expiresAt),
          expired: override.expired === true,
        }
      : null,
    evidence: {
      feedState: (text(asRecord(row.evidence).feedState, '') || null) as VenueState | null,
      feedSampleAgeMs: num(asRecord(row.evidence).feedSampleAgeMs),
      engineHealthy:
        typeof asRecord(row.evidence).engineHealthy === 'boolean'
          ? (asRecord(row.evidence).engineHealthy as boolean)
          : null,
      accountsDegraded: num(asRecord(row.evidence).accountsDegraded) ?? 0,
    },
  };
}

/**
 * Maps one destination audit row.
 *
 * The decisions are kept in the order the API returned them: they are an audit
 * trail, and an audit trail that has been sorted by this console is no longer
 * evidence of the order things happened in.
 */
export function toDestinationAuditRow(entry: unknown): DestinationAuditRow {
  const row = asRecord(entry);
  const decisions = Array.isArray(row.decisions) ? row.decisions : [];
  return {
    id: text(row.id),
    tenantId: text(row.tenantId),
    userId: text(row.userId),
    network: text(row.network, 'UNKNOWN'),
    address: text(row.address),
    label: text(row.label),
    status: text(row.status, 'UNKNOWN'),
    activatesAt: text(row.activatesAt),
    revokedAt: typeof row.revokedAt === 'string' ? row.revokedAt : null,
    createdAt: text(row.createdAt),
    decisions: decisions.map((decision) => {
      const value = asRecord(decision);
      return { at: text(value.at), decision: text(value.decision), reason: text(value.reason) };
    }),
  };
}

export const executionAdminApi = {
  /**
   * Stream health for every account in the operator's tenant.
   *
   * There is no `tenantId` parameter on purpose: the tenant comes from the
   * operator's session, and a console that could pass one would be a console that
   * could read another tenant's accounts by editing a query string.
   */
  listStreamHealth: async (params?: { limit?: number }): Promise<StreamHealthRow[]> => {
    const raw = await apiClient.get<unknown>('/v1/admin/exchange-user-streams', {
      searchParams: { limit: params?.limit },
    });
    const payload = asRecord(raw);
    const rows = Array.isArray(payload.data) ? payload.data : Array.isArray(raw) ? raw : [];
    return rows.map(toStreamHealthRow);
  },

  /** Normalised status for every venue, with the evidence that produced it. */
  listVenueStatuses: async (): Promise<VenueStatusRow[]> => {
    const raw = await apiClient.get<unknown>('/v1/venues/status');
    const payload = asRecord(raw);
    const rows = Array.isArray(payload.data) ? payload.data : Array.isArray(raw) ? raw : [];
    return rows.map(toVenueStatusRow);
  },

  /** Put a venue into a named state for a bounded time. Needs a step-up proof. */
  setVenueOverride: async (input: {
    venue: string;
    state: VenueState;
    reason: string;
    ttlSeconds: number;
  }): Promise<VenueOverrideResponse> => {
    if (input.state === 'UNKNOWN') {
      return {
        applied: false,
        code: 'UNKNOWN_NOT_SETTABLE',
        message: 'An operator cannot declare a venue unknown. Clear the override instead.',
      };
    }
    if (input.ttlSeconds <= 0) {
      return {
        applied: false,
        code: 'EXPIRY_REQUIRED',
        message: 'Choose how long this override lasts. It cannot be open-ended.',
      };
    }
    const raw = asRecord(
      await apiClient.put<unknown>(`/v1/admin/venues/${encodeURIComponent(input.venue)}/status`, {
        state: input.state,
        reason: input.reason.trim(),
        ttlSeconds: input.ttlSeconds,
      }),
    );
    return {
      applied: raw.applied === true,
      code: text(raw.code, 'UNKNOWN'),
      message: text(raw.message, NOT_CONFIRMED),
    };
  },

  /** Remove the override so the venue's state returns to the evidence. */
  clearVenueOverride: async (venue: string): Promise<VenueOverrideResponse> => {
    const raw = asRecord(
      await apiClient.delete<unknown>(`/v1/admin/venues/${encodeURIComponent(venue)}/status`),
    );
    return {
      applied: raw.applied === true,
      code: text(raw.code, 'UNKNOWN'),
      message: text(raw.message, NOT_CONFIRMED),
    };
  },

  /**
   * Ask the engine to reconcile one order into a state it can prove.
   *
   * The requested state is a *request*: the engine reads the venue first and may
   * answer with a different one. That is why the response echoes `fromState`, so
   * the timeline can show what changed rather than what the operator typed.
   */
  requestOrderRecovery: async (input: {
    orderId: string;
    targetState: string;
    reason: string;
  }): Promise<OrderStateRecoveryResult> => {
    const raw = asRecord(
      await apiClient.post<unknown>(`/v1/admin/oms/orders/${encodeURIComponent(input.orderId)}/recover`, {
        targetState: input.targetState,
        reason: input.reason.trim(),
      }),
    );
    return {
      accepted: raw.accepted === true,
      code: text(raw.code, 'UNKNOWN'),
      message: text(raw.message, NOT_CONFIRMED),
      orderId: text(raw.orderId, input.orderId),
      fromState: text(raw.fromState, 'UNKNOWN'),
      requestedState: text(raw.requestedState, input.targetState),
    };
  },

  /**
   * One order's recorded state history.
   *
   * Read-only: the timeline is what the engine recorded, and an operator view that
   * could edit it would destroy the only artefact that proves what happened.
   */
  getOrderTimeline: async (orderId: string): Promise<{
    orderId: string;
    symbol: string;
    side: string;
    quantity: string;
    state: string;
    entries: Array<{ state: string; at: string; actor: string; reason: string; venueOrderId: string | null }>;
  } | null> => {
    const raw = await apiClient.get<unknown>(`/v1/admin/oms/orders/${encodeURIComponent(orderId)}/timeline`);
    const payload = asRecord(raw);
    if (payload.orderId === undefined && !Array.isArray(payload.entries)) return null;
    const entries = Array.isArray(payload.entries) ? payload.entries : [];
    return {
      orderId: text(payload.orderId, orderId),
      symbol: text(payload.symbol, 'UNKNOWN'),
      side: text(payload.side, 'UNKNOWN'),
      quantity: text(payload.quantity, '0'),
      state: text(payload.state, 'UNKNOWN').toUpperCase(),
      entries: entries.map((entry) => {
        const row = asRecord(entry);
        return {
          state: text(row.state, 'UNKNOWN').toUpperCase(),
          at: text(row.at),
          actor: text(row.actor, 'UNKNOWN'),
          reason: text(row.reason),
          venueOrderId: typeof row.venueOrderId === 'string' ? row.venueOrderId : null,
        };
      }),
    };
  },

  /** Read-only audit of destinations and the policy decision taken on each. */
  listDestinationAudit: async (params?: { limit?: number }): Promise<DestinationAuditRow[]> => {
    // Tenant from the session, never from the query string: see `listStreamHealth`.
    const raw = await apiClient.get<unknown>('/v1/admin/custody/destinations', {
      searchParams: { limit: params?.limit },
    });
    const payload = asRecord(raw);
    const rows = Array.isArray(payload.data) ? payload.data : Array.isArray(raw) ? raw : [];
    return rows.map(toDestinationAuditRow);
  },
};

/**
 * Step-up proofs for console actions.
 *
 * Kept next to the client it authorises rather than in a general security client:
 * every caller here is a sensitive operator action, and the console should not be
 * able to obtain a proof without also importing the surface that documents why.
 * The proof is bound to one action and is spent by the request that uses it, so
 * the console asks for a code at the moment of the action, never earlier.
 */
export const adminStepUpApi = {
  issue: async (input: {
    action: string;
    method: 'TOTP' | 'PASSWORD' | 'RECOVERY_CODE';
    code?: string;
    password?: string;
    recoveryCode?: string;
  }): Promise<{ proofId: string; action: string; expiresAt: string }> => {
    const raw = asRecord(
      await apiClient.post<unknown>('/v1/auth/step-up', {
        action: input.action,
        method: input.method,
        ...(input.code ? { code: input.code } : {}),
        ...(input.password ? { password: input.password } : {}),
        ...(input.recoveryCode ? { recoveryCode: input.recoveryCode } : {}),
      }),
    );
    return {
      proofId: text(raw.proofId),
      action: text(raw.action, input.action),
      expiresAt: text(raw.expiresAt),
    };
  },
};

/** True when an error body says the action needs a fresh identity check. */
export function isStepUpRequired(error: unknown): boolean {
  const payload = asRecord((error as { details?: unknown } | null)?.details);
  const code = text(asRecord(error).code) || text(payload.code);
  const message = error instanceof Error ? error.message : text(asRecord(error).message);
  return code === 'STEP_UP_REQUIRED' || /step-?up/i.test(message);
}
