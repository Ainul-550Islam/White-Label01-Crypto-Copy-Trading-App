// # Responsibility: ensures the intentional public fee endpoint is exact-path and GET-only through the API proxy.
import { ANONYMOUS_GET_PATHS, isAnonymousRoute } from './proxy-path';

describe('anonymous API proxy allowlist', () => {
  it('allows only the public fee schedule GET endpoint without a session', () => {
    expect(ANONYMOUS_GET_PATHS.has('public/fee-schedule')).toBe(true);
    expect(isAnonymousRoute('GET', ['public', 'fee-schedule'], 'v1')).toBe(true);
    expect(isAnonymousRoute('POST', ['public', 'fee-schedule'], 'v1')).toBe(false);
    expect(isAnonymousRoute('GET', ['public', 'fee-schedule', 'tenant-secret'], 'v1')).toBe(false);
  });
});
