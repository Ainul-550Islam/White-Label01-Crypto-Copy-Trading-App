jest.mock('server-only', () => ({}));
const serverFetch = jest.fn();
jest.mock('@/lib/server-api', () => ({ serverFetch: (...args: unknown[]) => serverFetch(...args) }));

import { POST as requestRecovery } from '@/app/api/auth/recovery/request/route';
import { POST as verifyRecovery } from '@/app/api/auth/recovery/verify/route';
import { POST as completeRecovery } from '@/app/api/auth/recovery/complete/route';
import { ApiError } from '@wlct/utils/api-error';
import type { NextRequest } from 'next/server';

const host = 'acme.example.test';
function make(body: unknown, extra: Record<string, string> = {}): NextRequest {
  return new Request(`https://${host}/api/auth/recovery/request`, { method: 'POST', headers: {
    host, origin: `https://${host}`, 'content-type': 'application/json', 'idempotency-key': 'test-recovery-key', ...extra,
  }, body: JSON.stringify(body) }) as NextRequest;
}

describe('fixed anonymous recovery BFF', () => {
  beforeEach(() => serverFetch.mockReset());
  it('forwards an idempotent tenant-bound request and returns only neutral fields', async () => {
    serverFetch.mockResolvedValue({ accepted: true, message: 'internal message', token: 'do-not-return' });
    const response = await requestRecovery(make({ email: 'person@example.test' }));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: true, message: 'If an eligible account matches, recovery instructions may be sent.' });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(serverFetch).toHaveBeenCalledWith('/auth/recovery/request', expect.objectContaining({
      method: 'POST', authenticated: false, host, idempotencyKey: 'test-recovery-key', body: { email: 'person@example.test' },
    }));
  });
  it('rejects cross-origin, oversized, stray-field and missing-key requests before the backend', async () => {
    expect((await requestRecovery(make({ email: 'person@example.test' }, { origin: 'https://evil.test' }))).status).toBe(403);
    expect((await requestRecovery(make({ email: 'person@example.test', tenantId: 'other' }))).status).toBe(400);
    expect((await requestRecovery(make({ email: 'person@example.test' }, { 'idempotency-key': '' }))).status).toBe(400);
    expect((await requestRecovery(make({ email: 'x'.repeat(5000) }))).status).toBe(413);
    expect(serverFetch).not.toHaveBeenCalled();
  });
  it('accepts only well-formed verify and completion responses and never forwards extra data', async () => {
    const token = 'A'.repeat(43);
    serverFetch.mockResolvedValueOnce({ valid: true, reason: null, message: 'secret' });
    const verified = await verifyRecovery(make({ token }));
    expect(await verified.json()).toEqual({ valid: true, reason: null, message: 'Recovery link confirmed.' });
    serverFetch.mockResolvedValueOnce({ status: 'RECOVERED', reason: null, sessionsRevoked: 2, requiresTwoFactorEnrolment: false, secret: 'private' });
    const completed = await completeRecovery(make({ token, newPassword: 'Strong#Pass789' }));
    expect(await completed.json()).toEqual({ status: 'RECOVERED', reason: null, sessionsRevoked: 2, requiresTwoFactorEnrolment: false,
      message: 'Your password was changed and your existing sessions were signed out.' });
    serverFetch.mockResolvedValueOnce({ status: 'RECOVERED', sessionsRevoked: '2' });
    expect((await completeRecovery(make({ token, newPassword: 'Strong#Pass789' }))).status).toBe(503);
  });
  it('maps backend failures to safe generic text', async () => {
    serverFetch.mockRejectedValue(new ApiError(503, 'SECRET_INTERNAL', 'token=secret database details'));
    const response = await requestRecovery(make({ email: 'person@example.test' }));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toMatch(/token|database|SECRET_INTERNAL/i);
  });
});
