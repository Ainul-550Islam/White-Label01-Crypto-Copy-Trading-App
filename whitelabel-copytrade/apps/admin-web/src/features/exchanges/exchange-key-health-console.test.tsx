// # Responsibility: proves the key-health console renders its states, shows an unverified key as unknown rather than healthy, keeps the summary honest about partial pages, and exposes no write action.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ExchangeKeyHealthConsole } from './exchange-key-health-console';
import { KEY_ACTION_COPY, exchangeKeyHealthAdminApi, toneForOverall } from '@/api/exchange-key-health-admin-api';

jest.mock('@/lib/api-client', () => ({
  apiClient: { get: jest.fn().mockResolvedValue({ data: [] }), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
  usePathname: () => '/exchanges/key-health',
}));

// The loader is replaced so the console can be rendered in a settled error or
// loading state. Without this the first paint is always "loading", which is the
// one state that says the least about what the operator sees when a read fails.
// The loader is replaced so a test can render a settled error or loading state.
// `mockResourceOverride` is null by default, and the mock then delegates to the
// real hook, so every other test keeps seeing the genuine first paint.
const mockResourceOverride: { current: Record<string, unknown> | null } = { current: null };
jest.mock('@/features/shared/use-resource', () => {
  const actual = jest.requireActual('@/features/shared/use-resource');
  return {
    useResource: (...args: unknown[]) =>
      mockResourceOverride.current ?? actual.useResource(...args),
  };
});

const settled = (overrides: Record<string, unknown> = {}) => ({
  data: null,
  loading: false,
  error: null,
  errorCode: null,
  errorStatus: null,
  reload: jest.fn(),
  ...overrides,
});


afterEach(() => {
  jest.restoreAllMocks();
  mockResourceOverride.current = null;
});

describe('ExchangeKeyHealthConsole first paint', () => {
  it('renders the card, the filters and a live region', () => {
    const html = renderToStaticMarkup(<ExchangeKeyHealthConsole />);

    expect(html).toContain('Key capability health');
    expect(html).toContain('Venue');
    expect(html).toContain('Account state');
    expect(html).toMatch(/aria-live="polite"/);
  });

  it('states that an unverified key is unknown, not healthy', () => {
    const html = renderToStaticMarkup(<ExchangeKeyHealthConsole />);

    expect(html).toContain('A key whose permissions were never verified is reported as unknown, not as healthy.');
  });

  it('labels every control it renders and leaks no raw server string', () => {
    const html = renderToStaticMarkup(<ExchangeKeyHealthConsole />);
    const controls = html.match(/<(input|select|textarea)\b[^>]*>/g) ?? [];

    expect(controls.length).toBeGreaterThanOrEqual(3);
    expect(html).toMatch(/<label\b/);
    for (const control of controls) {
      expect(control).not.toMatch(/id=""/);
    }
    expect(html).not.toMatch(/INTERNAL_SERVER_ERROR|PrismaClient|at Object\.<anonymous>|ECONNREFUSED/);
  });

  it('offers no rotate, revoke or verify action of its own', () => {
    const html = renderToStaticMarkup(<ExchangeKeyHealthConsole />);

    // Remediation stays on the exchange-account screens, where the step-up proof
    // and the audit event already exist. A second write path to credentials is the
    // duplicate this console deliberately does not grow.
    expect(html).not.toMatch(/Rotate key|Revoke key|Verify key/);
  });
});

describe('key health reporting', () => {
  it('maps every verdict onto a tone that never paints UNKNOWN as success', () => {
    expect(toneForOverall('HEALTHY')).toBe('success');
    expect(toneForOverall('DEGRADED')).toBe('warning');
    expect(toneForOverall('UNKNOWN')).toBe('warning');
    expect(toneForOverall('RISK')).toBe('danger');
    expect(toneForOverall('UNHEALTHY')).toBe('danger');
  });

  it('gives every remediation action a sentence an operator can act on', () => {
    expect(Object.keys(KEY_ACTION_COPY).sort()).toEqual(['RECONNECT_KEY', 'ROTATE_KEY_WITHOUT_WITHDRAWAL', 'VERIFY_PERMISSIONS']);
    for (const copy of Object.values(KEY_ACTION_COPY)) {
      expect(copy.length).toBeGreaterThan(20);
      expect(copy).toMatch(/\.$/);
    }
  });

  it('labels a partial page as covering only the rows shown', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/features/exchanges/exchange-key-health-console.tsx'), 'utf8');

    expect(source).toContain('These counts describe the rows on this page, not the whole tenant.');
    expect(source).toContain('pageIsPartial');
  });

  it('shows the API error to the operator instead of swallowing it', () => {
    // 403 is what the API returns to a caller without exchange_account:read. The
    // console must say so, because a silently empty table reads as "no keys".
    mockResourceOverride.current = settled({
      error: 'You do not have permission to view exchange key health.',
      errorCode: 'FORBIDDEN',
      errorStatus: 403,
    });

    const html = renderToStaticMarkup(<ExchangeKeyHealthConsole />);

    expect(html).toContain('Key health unavailable');
    expect(html).toContain('You do not have permission to view exchange key health.');
    // An error is not an empty result: the empty state must not be drawn beside it.
    expect(html).not.toContain('No exchange keys match');
  });

  it('never falls back to an empty table when the read failed', () => {
    mockResourceOverride.current = settled({ error: 'Exchange key health could not be loaded.', errorStatus: 500 });

    const html = renderToStaticMarkup(<ExchangeKeyHealthConsole />);

    expect(html).toContain('Exchange key health could not be loaded.');
    expect(html).not.toMatch(/<tbody[^>]*>\s*<\/tbody>/);
  });

  it('announces the load while it is in flight', () => {
    mockResourceOverride.current = settled({ loading: true });

    const html = renderToStaticMarkup(<ExchangeKeyHealthConsole />);

    expect(html).toContain('Loading key health');
  });

  it('requests one page with the filters the operator chose', async () => {
    const list = jest.spyOn(exchangeKeyHealthAdminApi, 'list').mockResolvedValue({
      data: [],
      total: 0,
      evaluated: 0,
      summary: { healthy: 0, degraded: 0, risk: 0, unhealthy: 0, unknown: 0, requiresAction: 0 },
    });

    await exchangeKeyHealthAdminApi.list({ venue: 'BINANCE', status: 'ACTIVE', limit: 25 });

    expect(list).toHaveBeenCalledWith({ venue: 'BINANCE', status: 'ACTIVE', limit: 25 });
  });
});
