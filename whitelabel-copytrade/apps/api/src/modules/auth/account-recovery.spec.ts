// # Responsibility: prove recovery tokens are single-use, expiring, stored only as hashes, non-enumerating, and revoke every session on completion.
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
  AccountRecoveryService,
  type AccountLookupPort,
  type AccountRecoveryRepository,
  type RecoveryAuditPort,
  type RecoveryTokenRecord,
  type SessionRevocationPort,
} from './account-recovery.service';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const KEY = 'unit-recovery-hash-key-0123456789';
const NOW = new Date('2026-10-26T12:00:00.000Z');

class MemoryAccountRecoveryRepository implements AccountRecoveryRepository {
  rows: RecoveryTokenRecord[] = [];
  private sequence = 0;
  requests: Array<{ tenantId: string | null; userId: string | null; ipHash: string | null }> = [];

  async findByHash(input: { tokenHash: string }): Promise<RecoveryTokenRecord | null> {
    return this.rows.find((row) => row.tokenHash === input.tokenHash) ?? null;
  }

  async createToken(input: {
    tenantId: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    requestIpHash: string | null;
  }): Promise<RecoveryTokenRecord> {
    this.sequence += 1;
    const row: RecoveryTokenRecord = {
      id: `token-${this.sequence}`,
      tenantId: input.tenantId,
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      usedAt: null,
      createdAt: NOW,
    };
    this.rows.push(row);
    this.requests.push({ tenantId: input.tenantId, userId: input.userId, ipHash: input.requestIpHash });
    return row;
  }

  async markUsed(input: { tenantId: string; id: string; usedAt: Date }): Promise<boolean> {
    const row = this.rows.find((candidate) => candidate.id === input.id && candidate.tenantId === input.tenantId);
    if (!row || row.usedAt) return false;
    row.usedAt = input.usedAt;
    return true;
  }

  async invalidateUserTokens(input: { tenantId: string; userId: string; at: Date }): Promise<number> {
    let count = 0;
    for (const row of this.rows) {
      if (row.tenantId === input.tenantId && row.userId === input.userId && !row.usedAt) {
        row.usedAt = input.at;
        count += 1;
      }
    }
    return count;
  }

  async countRecentRequests(input: {
    tenantId: string | null;
    userId: string | null;
    ipHash: string | null;
    since: Date;
  }): Promise<number> {
    return this.requests.filter(
        (request) =>
          (input.userId !== null && request.userId === input.userId) ||
          (input.ipHash !== null && request.ipHash === input.ipHash),
    ).length;
  }
}

describe('Account recovery', () => {
  let repository: MemoryAccountRecoveryRepository;
  let accounts: jest.Mocked<AccountLookupPort>;
  let sessions: jest.Mocked<SessionRevocationPort>;
  let audit: jest.Mocked<RecoveryAuditPort>;
  let clock: Date;
  let service: AccountRecoveryService;

  beforeEach(() => {
    repository = new MemoryAccountRecoveryRepository();
    accounts = {
      findByEmail: jest.fn<AccountLookupPort['findByEmail']>(async (email: string) =>
        email === 'customer@example.com' ? { tenantId: TENANT, userId: USER } : null,
      ),
    };
    sessions = {
      revokeAllSessions: jest.fn<SessionRevocationPort['revokeAllSessions']>(async () => 3),
      revokeStepUpState: jest.fn<SessionRevocationPort['revokeStepUpState']>(async () => undefined),
    };
    audit = { record: jest.fn<RecoveryAuditPort['record']>(async () => undefined) };
    clock = new Date(NOW);
    service = new AccountRecoveryService(repository, accounts, sessions, audit, {
      hashKey: KEY,
      now: () => clock,
    });
  });

  async function issueToken(): Promise<string> {
    const result = await service.request({ email: 'customer@example.com', ipHash: 'ip-1' });
    if (!result.tokenForDelivery) throw new Error('no token issued');
    return result.tokenForDelivery;
  }

  it('issues a 256-bit token valid for thirty minutes and stores only its hash', async () => {
    const token = await issueToken();

    expect(token.length).toBeGreaterThanOrEqual(43); // 32 bytes base64url
    expect(repository.rows).toHaveLength(1);
    expect(repository.rows[0].tokenHash).toBe(service.hashToken(token));
    expect(repository.rows[0].expiresAt.toISOString()).toBe('2026-10-26T12:30:00.000Z');
    // The plaintext exists only in the delivery channel.
    expect(JSON.stringify(repository.rows)).not.toContain(token);
  });

  it('issues a different token every time', async () => {
    const first = await issueToken();
    const second = await issueToken();

    expect(first).not.toBe(second);
  });

  it('answers an unknown address exactly as it answers a known one', async () => {
    const known = await service.request({ email: 'customer@example.com', ipHash: 'ip-1' });
    const unknown = await service.request({ email: 'nobody@example.com', ipHash: 'ip-2' });

    expect(unknown.accepted).toBe(known.accepted);
    expect(unknown.message).toBe(known.message);
    expect(unknown.tokenForDelivery).toBeNull();
    expect(unknown.deliveryQueued).toBe(false);
    // Nothing was written for the address that does not exist.
    expect(repository.rows).toHaveLength(1);
  });

  it('throttles a burst without saying so to the caller', async () => {
    for (let index = 0; index < 5; index += 1) {
      const result = await service.request({ email: 'customer@example.com', ipHash: 'ip-1' });
      expect(result.deliveryQueued).toBe(false); // Token creation is not delivery evidence.
    }

    const throttled = await service.request({ email: 'customer@example.com', ipHash: 'ip-1' });

    expect(throttled.accepted).toBe(true);
    expect(throttled.message).toBe('If an eligible account matches and delivery is available, recovery instructions may be sent.');
    expect(throttled.deliveryQueued).toBe(false);
    expect(throttled.tokenForDelivery).toBeNull();
    expect(repository.rows).toHaveLength(5);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ result: 'THROTTLED' }));
  });

  it('verifies a live token and refuses a malformed one', async () => {
    const token = await issueToken();

    expect(await service.verify({ token })).toMatchObject({ valid: true, reason: null });
    expect(await service.verify({ token: 'not-a-token' })).toMatchObject({ valid: false, reason: 'INVALID_TOKEN' });
    expect(await service.verify({ token: '' })).toMatchObject({ valid: false, reason: 'INVALID_TOKEN' });
  });

  it('does not describe an unreadable token store as an invalid link', async () => {
    const token = await issueToken();
    const failure = new Error('token storage unavailable');
    jest.spyOn(repository, 'findByHash').mockRejectedValue(failure);

    await expect(service.verify({ token })).rejects.toBe(failure);
    await expect(service.resolveAccountForToken(token)).rejects.toBe(failure);
    await expect(service.complete({ token, ipHash: 'ip-1' })).rejects.toBe(failure);
    expect(sessions.revokeAllSessions).not.toHaveBeenCalled();
  });

  it('treats the token as live right up to its expiry instant and expired at it', async () => {
    const token = await issueToken();

    clock = new Date(NOW.getTime() + 30 * 60 * 1_000 - 1);
    expect((await service.verify({ token })).valid).toBe(true);

    clock = new Date(NOW.getTime() + 30 * 60 * 1_000);
    expect(await service.verify({ token })).toMatchObject({ valid: false, reason: 'TOKEN_EXPIRED' });
  });

  it('refuses to complete an expired token and revokes nothing', async () => {
    const token = await issueToken();
    clock = new Date(NOW.getTime() + 31 * 60 * 1_000);

    const result = await service.complete({ token, ipHash: 'ip-1' });

    expect(result).toMatchObject({ status: 'REFUSED', reason: 'TOKEN_EXPIRED', sessionsRevoked: 0 });
    expect(sessions.revokeAllSessions).not.toHaveBeenCalled();
    expect(sessions.revokeStepUpState).not.toHaveBeenCalled();
  });

  it('revokes every session and every step-up proof on completion', async () => {
    const token = await issueToken();

    const result = await service.complete({ token, ipHash: 'ip-1' });

    expect(result).toMatchObject({
      status: 'RECOVERED',
      sessionsRevoked: 3,
      requiresTwoFactorEnrolment: true,
      reason: null,
    });
    expect(sessions.revokeAllSessions).toHaveBeenCalledWith({
      tenantId: TENANT,
      userId: USER,
      reason: 'ACCOUNT_RECOVERY',
    });
    expect(sessions.revokeStepUpState).toHaveBeenCalledWith({ tenantId: TENANT, userId: USER });
    expect(result.message).toMatch(/signed out/i);
  });

  it('refuses a replayed token', async () => {
    const token = await issueToken();
    await service.complete({ token, ipHash: 'ip-1' });

    const replay = await service.complete({ token, ipHash: 'ip-1' });

    expect(replay).toMatchObject({ status: 'REFUSED', reason: 'TOKEN_ALREADY_USED' });
    // The replay must not revoke anything a second time either.
    expect(sessions.revokeAllSessions).toHaveBeenCalledTimes(1);
  });

  it('burns the token before revoking, so a revocation failure cannot leave it reusable', async () => {
    const token = await issueToken();
    sessions.revokeAllSessions.mockRejectedValueOnce(new Error('session store unavailable'));

    await expect(service.complete({ token, ipHash: 'ip-1' })).rejects.toThrow(/session store unavailable/);

    const retry = await service.complete({ token, ipHash: 'ip-1' });
    expect(retry).toMatchObject({ status: 'REFUSED', reason: 'TOKEN_ALREADY_USED' });
  });

  it('burns every other outstanding token for the account on completion', async () => {
    const first = await issueToken();
    const second = await issueToken();

    await service.complete({ token: first, ipHash: 'ip-1' });

    expect((await service.verify({ token: second })).valid).toBe(false);
    expect(repository.rows.every((row) => row.usedAt !== null)).toBe(true);
  });

  it('cannot be scoped into another tenant by a hint', async () => {
    const token = await issueToken();

    // The hint is ignored for lookup; the token resolves to its own tenant.
    const result = await service.complete({ token, tenantHint: OTHER_TENANT, ipHash: 'ip-1' });

    expect(result.status).toBe('RECOVERED');
    expect(sessions.revokeAllSessions).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, userId: USER }),
    );
  });

  it('audits each stage with the tenant, the user and the address hash', async () => {
    const token = await issueToken();
    await service.complete({ token, ipHash: 'ip-hash-1', requestId: 'req-1' });

    const events = audit.record.mock.calls.map(([entry]) => entry.event);
    expect(events).toEqual(['RECOVERY_REQUESTED', 'RECOVERY_COMPLETED']);
    expect(audit.record).toHaveBeenLastCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        userId: USER,
        ipHash: 'ip-hash-1',
        requestId: 'req-1',
        result: 'SUCCESS',
      }),
    );
  });

  it('records a refusal without a tenant when the token matches nothing', async () => {
    await service.complete({ token: 'made-up-token', ipHash: 'ip-9' });

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'RECOVERY_REFUSED', result: 'FAILURE', tenantId: null }),
    );
  });

  it('binds the token to one tenant in the stored row', async () => {
    await issueToken();

    expect(repository.rows[0].tenantId).toBe(TENANT);
    expect(repository.rows[0].userId).toBe(USER);
  });

  it('refuses to construct without a hash key', () => {
    expect(
      () => new AccountRecoveryService(repository, accounts, sessions, audit, { hashKey: '' }),
    ).toThrow(/hash key/);
  });

  it('hashes the same token differently under another key', async () => {
    const other = new AccountRecoveryService(repository, accounts, sessions, audit, {
      hashKey: 'another-key-0123456789abcdef',
      now: () => clock,
    });

    expect(other.hashToken('abc')).not.toBe(service.hashToken('abc'));
  });
});
