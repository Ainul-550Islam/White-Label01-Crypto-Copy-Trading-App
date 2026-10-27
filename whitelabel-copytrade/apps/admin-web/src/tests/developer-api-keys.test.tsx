import { renderToStaticMarkup } from 'react-dom/server';
import { credentialStatus } from '@/features/developer/api-key-table';
import { SecretReveal } from '@/features/developer/secret-reveal';
import type { Credential } from '@/api/developer-platform-api';

const credential: Credential = {
  id: 'row', applicationId: 'app', keyId: 'devkey_example', label: 'Production', kind: 'API_KEY',
  scopes: ['profile:read'], expiresAt: null, revokedAt: null, createdAt: '2026-01-01T00:00:00Z',
};

test('credential statuses distinguish revoked, expired, active and malformed expiry', () => {
  const now = Date.parse('2026-02-01T00:00:00Z');
  expect(credentialStatus(credential, now)).toBe('active');
  expect(credentialStatus({ ...credential, expiresAt: '2026-01-01T00:00:00Z' }, now)).toBe('expired');
  expect(credentialStatus({ ...credential, revokedAt: '2026-01-02', expiresAt: null }, now)).toBe('revoked');
  expect(credentialStatus({ ...credential, expiresAt: 'invalid' }, now)).toBe('unknown');
});

test('one-time secret presentation warns, escapes content and offers copy and dismissal', () => {
  const html = renderToStaticMarkup(<SecretReveal secret={'<secret-value>'} keyId="key-id" onClose={() => undefined} />);
  expect(html).toContain('&lt;secret-value&gt;');
  expect(html).not.toContain('<secret-value>');
  expect(html).toContain('will not be shown again');
  expect(html).toContain('Copy secret');
  expect(html).toContain('I have saved the secret');
  expect(html).toContain('role="alert"');
  expect(html).not.toMatch(/localStorage|sessionStorage/);
});
