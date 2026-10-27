import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AccountRecoveryPage } from '@/features/security/account-recovery-page';
import { recoveryCopy, type RecoveryLocale } from '@/features/security/recovery-copy';

jest.mock('@/api/security-api', () => ({ accountRecoveryApi: { request: jest.fn(), verify: jest.fn(), complete: jest.fn() } }));

describe('account recovery UI', () => {
  it('renders the anonymous request form without confirming account existence', () => {
    const html = renderToStaticMarkup(<AccountRecoveryPage />);
    expect(html).toContain('Recover your account');
    expect(html).toContain('does not confirm whether an address is registered');
    expect(html).toContain('type="email"');
    expect(html).not.toContain('Account recovered');
  });
  it('masks for a masked recovery code without echoing it as visible text', () => {
    const token = 'A'.repeat(43);
    const html = renderToStaticMarkup(<AccountRecoveryPage initialToken={token} />);
    expect(html).toContain('Recovery code');
    expect(html).toMatch(/type="password"/);
    expect(html).toContain('expires 30 minutes after the request');
  });
  it('supplies all five locales, preserving MFA and neutral recovery wording', () => {
    for (const locale of ['en', 'bn', 'ar', 'es', 'tr'] as RecoveryLocale[]) {
      const copy = recoveryCopy[locale];
      expect(copy.title).toBeTruthy(); expect(copy.accepted).toBeTruthy(); expect(copy.privacy).toBeTruthy();
      expect(copy.mfa).toBeTruthy(); expect(copy.invalid).toBeTruthy(); expect(copy.unavailable).toBeTruthy();
    }
    expect(recoveryCopy.en.mfa).toContain('remain unchanged');
  });
});
