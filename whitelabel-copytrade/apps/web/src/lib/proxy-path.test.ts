// # Responsibility: ensures the intentional public fee endpoint is exact-path and GET-only through the API proxy.
import { ANONYMOUS_GET_PATHS, isAnonymousRoute, isExactAnonymousProxyUrl, isUnsafeSegment } from './proxy-path';

describe('anonymous API proxy allowlist', () => {
  it('allows only the public fee schedule GET endpoint without a session', () => {
    expect(ANONYMOUS_GET_PATHS.has('public/fee-schedule')).toBe(true);
    expect(isAnonymousRoute('GET', ['public', 'fee-schedule'], 'v1')).toBe(true);
    expect(isAnonymousRoute('POST', ['public', 'fee-schedule'], 'v1')).toBe(false);
    expect(isAnonymousRoute('GET', ['public', 'fee-schedule', 'tenant-secret'], 'v1')).toBe(false);
  });

  it.each(['HEAD', 'OPTIONS', 'post', 'get'])('requires a session for method %s', (method) => {
    expect(isAnonymousRoute(method, ['public', 'fee-schedule'], 'v1')).toBe(false);
  });

  it.each([
    ['public', 'fee-schedule', ''],
    ['public', '', 'fee-schedule'],
    ['public', 'fee-schedule', '%2e%2e'],
    ['public', 'fee-schedule', '..'],
    ['PUBLIC', 'fee-schedule'],
    ['public', 'FEE-SCHEDULE'],
    ['public/fee-schedule'],
    ['v1', 'v1', 'public', 'fee-schedule'],
  ])('rejects a non-exact path %j', (...segments) => {
    expect(isAnonymousRoute('GET', segments, 'v1')).toBe(false);
  });

  it.each(['..', '%2e%2e', '%252e%252e', '%2F', '%5c', '', 'a/b', 'a\\b'])('rejects unsafe path segment %s', (segment) => {
    expect(isUnsafeSegment(segment)).toBe(true);
  });

  it('requires the original proxy URL to have the exact path spelling', () => {
    expect(isExactAnonymousProxyUrl('https://web.example/api/proxy/public/fee-schedule', 'v1')).toBe(true);
    expect(isExactAnonymousProxyUrl('https://web.example/api/proxy/v1/public/fee-schedule', 'v1')).toBe(true);
    for (const path of ['/api/proxy/public/fee-schedule/', '/api/proxy/public//fee-schedule', '/api/proxy/%70ublic/fee-schedule', '/api/proxy/public/fee-schedule/%2e%2e', '/api/proxy/public/other/%2e%2e/fee-schedule']) {
      expect(isExactAnonymousProxyUrl(`https://web.example${path}`, 'v1')).toBe(false);
    }
  });

  it('accepts a single explicit API version and rejects the previous public-config exception', () => {
    expect(isAnonymousRoute('GET', ['v1', 'public', 'fee-schedule'], 'v1')).toBe(true);
    expect(isAnonymousRoute('GET', ['tenants', 'public-config'], 'v1')).toBe(false);
    expect([...ANONYMOUS_GET_PATHS]).toEqual(['public/fee-schedule']);
  });
});
