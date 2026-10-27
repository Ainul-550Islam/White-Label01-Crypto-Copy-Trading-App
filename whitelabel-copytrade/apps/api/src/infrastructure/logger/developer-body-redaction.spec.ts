import { REDACTED_PLACEHOLDER } from '@wlct/config';
import { requestBodyForLog } from './request-body-redaction';

describe('sensitive body logging', () => {
  it.each([
    '/api/v1/developer-platform/oauth/token',
    '/custom/v1/developer-platform/oauth/revoke?debug=1',
    '/api/v1/auth/step-up/verify',
  ])('never serializes auth or developer payload for %s', (url) => {
    const body = { token: 'private-token', code: 'private-code', clientSecret: 'private-secret' };
    expect(JSON.stringify(requestBodyForLog(url, body))).not.toContain('private-');
  });
  it('preserves ordinary body logging behavior', () => {
    expect(requestBodyForLog('/api/v1/public/lookup', { type: 'example' })).toEqual({ type: 'example' });
  });
  it('redacts push registration tokens', () => {
    expect(requestBodyForLog('/v1/notifications/push-devices', { token: 'device-secret' })).toBe(REDACTED_PLACEHOLDER);
  });
  it.each(['/v1/client-lifecycle/funding', '/v1/client-lifecycle/withdrawal-destination-check', '/v1/client-lifecycle/withdrawals', '/v1/custody/destinations'])('redacts sensitive funding and destination bodies at %s', (url) => {
    expect(requestBodyForLog(url, { address: 'private-address' })).toBe(REDACTED_PLACEHOLDER);
  });
});
