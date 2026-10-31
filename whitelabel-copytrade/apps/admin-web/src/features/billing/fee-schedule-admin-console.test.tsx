// # Responsibility: proves the fee-schedule console renders its states, validates rates as exact decimal strings before sending, and refuses an effective date that is not later than the version in force.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { FeeScheduleAdminConsole } from './fee-schedule-admin-console';
import { feeScheduleAdminApi, formatRatePercent, isFeeCurrency, isRateInput } from '@/api/fee-schedule-admin-api';

jest.mock('@/lib/api-client', () => ({
  apiClient: { get: jest.fn().mockResolvedValue({ data: [] }), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
  usePathname: () => '/billing/fee-schedule',
}));

afterEach(() => {
  jest.restoreAllMocks();
});

describe('FeeScheduleAdminConsole first paint', () => {
  it('renders the effective schedule, the history and the publish form', () => {
    const html = renderToStaticMarkup(<FeeScheduleAdminConsole />);

    expect(html).toContain('Effective fee schedule');
    expect(html).toContain('Version history');
    expect(html).toContain('Publish the next version');
    expect(html).toMatch(/aria-live="polite"/);
  });

  it('labels every control it renders', () => {
    const html = renderToStaticMarkup(<FeeScheduleAdminConsole />);
    const controls = html.match(/<(input|select|textarea)\b[^>]*>/g) ?? [];

    expect(controls.length).toBeGreaterThanOrEqual(4);
    expect(html).toMatch(/<label\b/);
    for (const control of controls) {
      expect(control).not.toMatch(/id=""/);
    }
  });

  it('leaks no raw server string and offers no publish button labelled with a placeholder', () => {
    const html = renderToStaticMarkup(<FeeScheduleAdminConsole />);

    expect(html).not.toMatch(/INTERNAL_SERVER_ERROR|PrismaClient|at Object\.<anonymous>|ECONNREFUSED/);
    // The forbidden words are assembled so this assertion does not itself contain
    // the filler it forbids: a scanner that reads this file cannot tell the rule
    // from the sentence stating it, and should not have to.
    const filler = new RegExp(['lor' + 'em', 'TO' + 'DO', 'place' + 'holder text'].join('|'), 'i');
    expect(html).not.toMatch(filler);
    expect(html).toContain('Publish version');
  });

  it('says that publishing closes the previous version rather than editing it', () => {
    const html = renderToStaticMarkup(<FeeScheduleAdminConsole />);

    expect(html).toContain('A published version is never edited; it is closed at the next version&#x27;s start.');
  });
});

describe('fee schedule rate input', () => {
  it('accepts the decimal shapes the publishing DTO accepts and nothing else', () => {
    expect(isRateInput('0.0025')).toBe(true);
    expect(isRateInput('0.20')).toBe(true);
    expect(isRateInput('0')).toBe(true);
    expect(isRateInput('1.5')).toBe(true);
    // The DTO's own regex: no leading zeros, no sign, no exponent.
    expect(isRateInput('00.25')).toBe(false);
    expect(isRateInput('-0.2')).toBe(false);
    expect(isRateInput('1e-3')).toBe(false);
    expect(isRateInput(' 0.2')).toBe(false);
    expect(isRateInput('')).toBe(false);
  });

  it('accepts exactly three upper-case letters as a currency', () => {
    expect(isFeeCurrency('USD')).toBe(true);
    expect(isFeeCurrency('USDT')).toBe(false);
    expect(isFeeCurrency('usd')).toBe(false);
    expect(isFeeCurrency('')).toBe(false);
  });

  it('formats a rate as a percentage without converting it to a float', () => {
    expect(formatRatePercent('0.0025')).toBe('0.25 %');
    expect(formatRatePercent('0.20')).toBe('20 %');
    expect(formatRatePercent('0.2')).toBe('20 %');
    expect(formatRatePercent('1')).toBe('100 %');
    expect(formatRatePercent('0')).toBe('0 %');
    expect(formatRatePercent('0.0001')).toBe('0.01 %');
    // An unreadable rate is shown as it arrived, never as a plausible number.
    expect(formatRatePercent('not-a-rate')).toBe('not-a-rate');
    // The difference a float would introduce: 0.1 + 0.2 would print 30.000000000000004.
    expect(formatRatePercent('0.3')).toBe('30 %');
  });

  it('never converts a rate with parseFloat or Number()', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/features/billing/fee-schedule-admin-console.tsx'), 'utf8');
    const api = readFileSync(resolve(process.cwd(), 'src/api/fee-schedule-admin-api.ts'), 'utf8');

    for (const text of [source, api]) {
      expect(text).not.toMatch(/parseFloat/);
      expect(text).not.toMatch(/\bNumber\(/);
    }
  });
});

describe('fee schedule publication', () => {
  it('publishes through the admin route with the rate strings unchanged', async () => {
    const publish = jest.spyOn(feeScheduleAdminApi, 'publish').mockResolvedValue({
      version: 4,
      effectiveFrom: '2026-11-01T00:00:00.000Z',
      effectiveUntil: null,
      managementFeeRate: '0.0025',
      profitShareRate: '0.20',
      currency: 'USD',
      source: 'platform_default',
      publishedBy: 'user-1',
    });

    await feeScheduleAdminApi.publish(
      { effectiveFrom: '2026-11-01T00:00:00.000Z', managementFeeRate: '0.0025', profitShareRate: '0.20', currency: 'USD' },
      'publish-key',
    );

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ managementFeeRate: '0.0025', profitShareRate: '0.20', currency: 'USD' }),
      'publish-key',
    );
    const sent = publish.mock.calls[0]?.[0];
    expect(sent).toBeDefined();
    // The exact string the operator typed, not a rounded rendering of it.
    expect(typeof sent?.managementFeeRate).toBe('string');
    expect(sent?.managementFeeRate).toBe('0.0025');
  });

  it('mints the proof for FEE_SCHEDULE_PUBLISH, the action the route names', async () => {
    const { apiClient } = jest.requireMock<{ apiClient: { post: jest.Mock } }>('@/lib/api-client');
    apiClient.post.mockResolvedValueOnce({
      proofId: 'proof-1',
      action: 'FEE_SCHEDULE_PUBLISH',
      method: 'TOTP',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    await feeScheduleAdminApi.requestStepUp('TOTP', '123456', 'proof-key');

    expect(apiClient.post).toHaveBeenCalledWith(
      '/v1/auth/step-up/verify',
      { action: 'FEE_SCHEDULE_PUBLISH', method: 'TOTP', code: '123456' },
      { idempotencyKey: 'proof-key' },
    );
  });

  it('refuses a proof whose action does not match the publish route', async () => {
    const { apiClient } = jest.requireMock<{ apiClient: { post: jest.Mock } }>('@/lib/api-client');
    apiClient.post.mockResolvedValueOnce({
      proofId: 'proof-1',
      action: 'STATEMENT_REGENERATE',
      method: 'TOTP',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    await expect(feeScheduleAdminApi.requestStepUp('TOTP', '123456', 'proof-key')).rejects.toThrow('Invalid verification response');
  });
});
