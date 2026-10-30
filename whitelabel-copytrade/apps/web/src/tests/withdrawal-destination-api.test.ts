// # Responsibility: pins the withdrawal-destination allowlist routes, proves a malformed row is refused rather than rendered, and proves the client is the same object the withdrawal screen already used.

import { apiClient } from '@/api/api-client';
import { withdrawalDestinationApi, ADDRESS_PATTERN, destinationInputProblem } from '@/api/withdrawal-destination-api';
import { withdrawalDestinationApi as reExported } from '@/api/security-api';

jest.mock('@/api/api-client', () => ({ apiClient: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() } }));
const get = apiClient.get as jest.Mock;
const post = apiClient.post as jest.Mock;
const del = apiClient.delete as jest.Mock;

afterEach(() => jest.resetAllMocks());

const destination = {
  id: 'destination-1', network: 'ETHEREUM', address: `0x${'a'.repeat(40)}`, label: 'Cold wallet',
  status: 'PENDING', activatesAt: '2026-10-31T03:00:00.000Z', revokedAt: null,
  createdAt: '2026-10-30T03:00:00.000Z', remainingCooldownMs: 86_400_000,
};

test('there is one client: the security module re-exports this one', () => {
  expect(reExported).toBe(withdrawalDestinationApi);
});

test('lists the allowlist and returns the rows', async () => {
  get.mockResolvedValue({ data: [destination], total: 1 });

  await expect(withdrawalDestinationApi.list()).resolves.toEqual([destination]);

  expect(get).toHaveBeenCalledWith('/v1/custody/destinations');
});

test.each([
  [{ ...destination, id: '' }],
  [{ ...destination, status: 'ACTIVE_PENDING' }],
  [{ ...destination, activatesAt: 'not-a-date' }],
  [{ ...destination, network: '' }],
])('refuses a malformed destination row instead of rendering it %#', async (row) => {
  get.mockResolvedValue({ data: [row], total: 1 });

  await expect(withdrawalDestinationApi.list()).rejects.toThrow('Invalid destination response');
});

test('adds a destination with the caller key and the exact address', async () => {
  const result = { ok: true, code: 'CREATED', message: 'Submitted', destination };
  post.mockResolvedValue(result);

  await withdrawalDestinationApi.add({ network: 'ETHEREUM', address: destination.address, label: 'Cold wallet' }, 'destination-key-1');

  expect(post).toHaveBeenCalledWith(
    '/v1/custody/destinations',
    { network: 'ETHEREUM', address: destination.address, label: 'Cold wallet' },
    { idempotencyKey: 'destination-key-1' },
  );
});

test('revokes with an optional reason body and the caller key', async () => {
  del.mockResolvedValue({ ok: true, code: 'REVOKED', message: 'Revoked' });

  await withdrawalDestinationApi.revoke('destination/1', 'Revoked by the account holder', 'revoke-key-1');

  expect(del).toHaveBeenCalledWith('/v1/custody/destinations/destination%2F1', {
    body: { reason: 'Revoked by the account holder' },
    idempotencyKey: 'revoke-key-1',
  });
});

test('revokes without a body when no reason was given', async () => {
  del.mockResolvedValue({ ok: true, code: 'REVOKED', message: 'Revoked' });

  await withdrawalDestinationApi.revoke('destination-1', undefined, 'revoke-key-2');

  expect(del).toHaveBeenCalledWith('/v1/custody/destinations/destination-1', { idempotencyKey: 'revoke-key-2' });
});

test('validates the address and label rules the DTO enforces', () => {
  expect(ADDRESS_PATTERN.test(`0x${'a'.repeat(40)}`)).toBe(true);
  expect(destinationInputProblem({ address: '0xabc', label: 'ok' })).toBe('address');
  expect(destinationInputProblem({ address: `0x${'a'.repeat(40)}`, label: 'x' })).toBe('label');
  expect(destinationInputProblem({ address: `0x${'a'.repeat(40)}`, label: 'Cold wallet' })).toBeNull();
  // The DTO's charset includes ':' and '_' for memo-style chains, so those stay valid - but a space,
  // a scheme separator with whitespace, or a too-short address is refused before it is sent.
  expect(destinationInputProblem({ address: 'TRX:TX1_memo-1', label: 'Cold wallet' })).toBe('address');
  expect(destinationInputProblem({ address: `0x${'a'.repeat(40)} extra`, label: 'Cold wallet' })).toBe('address');
});
