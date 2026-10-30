// # Responsibility: the customer's own withdrawal-destination allowlist - the single client every screen that adds, lists or revokes a destination calls.
//
//   GET    /v1/custody/destinations        WithdrawalDestinationController.index
//   POST   /v1/custody/destinations        ...store   (step-up: PAYOUT_CREATE)
//   DELETE /v1/custody/destinations/:id    ...destroy (step-up: PAYOUT_CREATE)
//
// Moved out of security-api.ts, where it lived beside the step-up client, because the destinations page,
// the withdrawal page and the funding screens all need it and none of them need the rest of that module.
// The behaviour is unchanged: the list validates every row and throws on a malformed one rather than
// rendering an address the API did not describe, the add and the revoke carry an Idempotency-Key, and
// the revoke sends its optional reason in the body.

import { apiClient } from './api-client';

/** Networks the destination DTO accepts. The API refuses anything else; this list drives the selector. */
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

export type WithdrawalNetwork = (typeof WITHDRAWAL_NETWORKS)[number];

/** CreateWithdrawalDestinationDto: 16-128 characters of address, no scheme and no spaces. */
export const ADDRESS_PATTERN = /^[A-Za-z0-9:_-]{16,128}$/;

/**
 * The reason the form would be refused, without asking the API.
 *
 * The API validates the same fields; this exists so the customer sees the problem next to the input
 * instead of after a round trip. A local pass is not permission: the request is still sent exactly as
 * typed, and the API remains the authority.
 */
export function destinationInputProblem(input: { address: string; label: string }): 'address' | 'label' | null {
  if (!ADDRESS_PATTERN.test(input.address.trim())) return 'address';
  const label = input.label.trim();
  if (label.length < 2 || label.length > 80) return 'label';
  return null;
}

/**
 * Withdrawal destinations: the customer's own address allowlist.
 *
 * `status` is the authority on whether an address may receive funds. A PENDING
 * address is NOT usable, and the UI must show the countdown rather than a
 * disabled checkbox the customer cannot explain.
 */
export type WithdrawalDestinationStatus = 'PENDING' | 'ACTIVE' | 'REVOKED';

export interface WithdrawalDestination {
  id: string;
  network: string;
  address: string;
  label: string;
  status: WithdrawalDestinationStatus;
  activatesAt: string;
  revokedAt: string | null;
  createdAt: string;
  remainingCooldownMs: number;
}

export interface WithdrawalDestinationMutation {
  ok: boolean;
  code: string;
  message: string;
  destination?: WithdrawalDestination;
  remainingCooldownMs?: number | null;
}

export const withdrawalDestinationApi = {
  list: async (): Promise<WithdrawalDestination[]> => {
    const page = await apiClient.get<{ data: WithdrawalDestination[]; total: number }>('/v1/custody/destinations');
    if (!Array.isArray(page?.data) || page.data.some((row) => !row || typeof row.id !== 'string' || !row.id || typeof row.network !== 'string' || !row.network || typeof row.address !== 'string' || !row.address || typeof row.label !== 'string' || !['PENDING', 'ACTIVE', 'REVOKED'].includes(row.status) || typeof row.activatesAt !== 'string' || !Number.isFinite(Date.parse(row.activatesAt)))) {
      throw new Error('Invalid destination response');
    }
    return page.data;
  },

  /** Requires a fresh step-up proof for PAYOUT_CREATE; call stepUpApi.issue first. */
  add: (input: { network: string; address: string; label: string }, idempotencyKey?: string): Promise<WithdrawalDestinationMutation> =>
    apiClient.post<WithdrawalDestinationMutation>('/v1/custody/destinations', input, { idempotencyKey }),

  revoke: (id: string, reason?: string, idempotencyKey?: string): Promise<WithdrawalDestinationMutation> =>
    apiClient.delete<WithdrawalDestinationMutation>(`/v1/custody/destinations/${encodeURIComponent(id)}`, {
      ...(reason ? { body: { reason } } : {}), idempotencyKey,
    }),
};
