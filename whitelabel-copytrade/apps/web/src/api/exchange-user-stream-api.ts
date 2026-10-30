// # Responsibility: typed client for the customer's own stream health (exchange-user-stream.controller) and the venue status board (venue-status.controller).
//
//   GET /v1/exchanges/:accountId/user-stream   ExchangeUserStreamController
//   GET /v1/venues/status?venues=a,b           VenueStatusController
//   GET /v1/venues/:venue/status               VenueStatusController
//
// The stream route throws when the engine cannot be reached, and the client keeps that behaviour: a
// default of "healthy" for an unanswered engine is exactly the bug this screen exists to surface, so
// `engineReported` is carried through to the UI untouched.

import { apiClient } from './api-client';

// Literal route prefixes rather than shared constants: the repository's web-api-contract check resolves
// `const API_BASE` only, and a path it cannot resolve is a path nothing verifies.
const API_BASE = '/v1/exchanges';

function params(query: Record<string, string | number | boolean | undefined>): Record<string, string | number | boolean | undefined> {
  return query;
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

export interface ExchangeUserStreamHealth {
  tenantId: string;
  accountId: string;
  venue: string | null;
  state: string;
  reasonCode: string;
  lastEventAt: string | null;
  lastEventAgeMs: number | null;
  reconnectCount: number | null;
  listenKeyAgeMs: number | null;
  persistedStatus: string | null;
  evaluatedAt: string;
  engineReported: boolean;
}

export interface VenueStatusView {
  venue: string;
  state: string;
  reason: string;
  since: string;
  messageCode: string;
  message: string;
  source: 'OVERRIDE' | 'FEED' | 'ACCOUNT_HEALTH' | 'NONE';
  verified: boolean;
  override: { state?: string; reason?: string; until?: string | null } | null;
  checkedAt: string;
}

export const exchangeUserStreamApi = {
  /** Throws when the engine does not answer - the caller renders "unknown", never "healthy". */
  getStreamHealth: (accountId: string) =>
    apiClient.get<ExchangeUserStreamHealth>(`${API_BASE}/${segment(accountId)}/user-stream`),

  listVenueStatus: (venues?: string[]) =>
    apiClient.get<{ venues: VenueStatusView[] }>(`/v1/venues/status`, {
      searchParams: params({ venues: venues?.join(',') }),
    }),

  getVenueStatus: (venue: string) => apiClient.get<VenueStatusView>(`/v1/venues/${segment(venue)}/status`),
};
