// # Responsibility: the batch-05 operator screens each render their first paint, announce the load, offer no dangerous action before the data that justifies it, and never convert money with a float.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { CopyBudgetAdminConsole } from '@/features/copy-trading/copy-budget-admin-console';
import { FeeScheduleAdminConsole } from '@/features/billing/fee-schedule-admin-console';
import { ProfitShareStatementAdminConsole } from '@/features/billing/profit-share-statement-admin-console';
import { ExchangeKeyHealthConsole } from '@/features/exchanges/exchange-key-health-console';
import { NAV_ITEMS, visibleNavItems } from '@/app/(console)/layout';

// The layout is a Server Component: it imports `server-only`, which throws if the
// module graph is evaluated anywhere else. The navigation table and the visibility
// rule it exports are pure, and the rule is exactly what B13 asserts, so the
// build-time guard is stubbed here rather than the rule being tested through a
// rendered request. Nothing else from the layout is reachable from this file.
jest.mock('server-only', () => ({}));

jest.mock('@/lib/api-client', () => ({
  apiClient: { get: jest.fn().mockResolvedValue({ data: [] }), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
  usePathname: () => '/copy-trading/budget',
}));

/**
 * The same contract the batch-04 guard enforces, for the four screens this batch
 * adds: a live region so a screen reader hears the load, headings an operator can
 * navigate by, no raw server text, no destructive control before data, and one
 * label per control.
 */
const surfaces: Array<{ name: string; element: React.ReactElement; heading: string }> = [
  { name: 'copy budget', element: <CopyBudgetAdminConsole />, heading: 'Tenant copy-budget ceiling' },
  { name: 'fee schedule', element: <FeeScheduleAdminConsole />, heading: 'Effective fee schedule' },
  { name: 'profit-share statements', element: <ProfitShareStatementAdminConsole />, heading: 'Generate a statement' },
  { name: 'exchange key health', element: <ExchangeKeyHealthConsole />, heading: 'Key capability health' },
];

describe('batch 05 console surfaces', () => {
  it.each(surfaces)('renders $name with its heading and a live region', ({ element, heading }) => {
    const html = renderToStaticMarkup(element);

    expect(html).toContain(heading);
    expect(html).toMatch(/aria-live="polite"/);
    expect(html.length).toBeGreaterThan(600);
  });

  it.each(surfaces)('does not leak a raw server string into $name', ({ element }) => {
    const html = renderToStaticMarkup(element);

    expect(html).not.toMatch(/INTERNAL_SERVER_ERROR|PrismaClient|at Object\.<anonymous>|ECONNREFUSED/);
  });

  it('offers no finalize or publish action before the data that would justify it has loaded', () => {
    const budget = renderToStaticMarkup(<CopyBudgetAdminConsole />);
    const statements = renderToStaticMarkup(<ProfitShareStatementAdminConsole />);

    // The dialogs exist only while a pending intent does.
    expect(budget).not.toContain('Verify and continue');
    expect(statements).not.toContain('Finalize statement');
  });

  it('labels every control it renders', () => {
    for (const { element } of surfaces) {
      const html = renderToStaticMarkup(element);
      const controls = html.match(/<(input|select|textarea)\b[^>]*>/g) ?? [];

      if (controls.length > 0) {
        expect(html).toMatch(/<label\b/);
      }
      for (const control of controls) {
        expect(control).not.toMatch(/id=""/);
      }
    }
  });

  it('renders both profit-share and fee-schedule controls as labelled fields, not placeholders', () => {
    const html = renderToStaticMarkup(<FeeScheduleAdminConsole />);

    expect(html).toContain('Management fee rate');
    expect(html).toContain('Profit share rate');
    expect(html).toContain('Effective from');
  });
});

describe('batch 05 sidebar entries', () => {
  const expected: Array<{ href: string; permission: string; platformOnly?: boolean }> = [
    { href: '/copy-trading/budget', permission: 'copy_subscription:read' },
    { href: '/billing/fee-schedule', permission: 'platform:manage', platformOnly: true },
    { href: '/billing/statements', permission: 'platform:manage', platformOnly: true },
    { href: '/exchanges/key-health', permission: 'exchange_account:read' },
  ];

  it.each(expected)('lists $href with the permission the API requires', ({ href, permission, platformOnly }) => {
    const item = NAV_ITEMS.find((entry) => entry.href === href);

    expect(item).toBeDefined();
    expect(item?.permission).toBe(permission);
    expect(item?.platformOnly ?? false).toBe(platformOnly ?? false);
  });

  it('does not duplicate an existing href', () => {
    const hrefs = NAV_ITEMS.map((item) => item.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  // B13: the entry is hidden, not merely declared. Each case asserts the link is
  // absent from what the shell renders for a user who lacks the permission, and
  // present for one who holds exactly it.
  it.each(expected)('hides $href from a user without $permission', ({ href, permission, platformOnly }) => {
    const without = visibleNavItems({ perms: ['dashboard:read'], plat: false });
    expect(without.map((item) => item.href)).not.toContain(href);

    const withPermission = visibleNavItems({ perms: [permission], plat: platformOnly === true });
    expect(withPermission.map((item) => item.href)).toContain(href);
  });

  it('hides a platform-only entry from an organisation admin who holds its permission', () => {
    const orgAdmin = visibleNavItems({ perms: ['platform:manage', 'exchange_account:read'], plat: false });

    expect(orgAdmin.map((item) => item.href)).not.toContain('/billing/fee-schedule');
    expect(orgAdmin.map((item) => item.href)).not.toContain('/billing/statements');
    // The non-platform key-health entry IS visible to the same user.
    expect(orgAdmin.map((item) => item.href)).toContain('/exchanges/key-health');
  });

  it('shows every entry to a wildcard grant except the platform-only ones', () => {
    const platform = visibleNavItems({ perms: ['*'], plat: true }).map((item) => item.href);
    const org = visibleNavItems({ perms: ['*'], plat: false }).map((item) => item.href);

    for (const item of NAV_ITEMS) {
      if (item.platformOnly) {
        expect(platform).toContain(item.href);
        expect(org).not.toContain(item.href);
      } else {
        expect(platform).toContain(item.href);
        expect(org).toContain(item.href);
      }
    }
  });

  it('accepts a resource wildcard for the entries it covers', () => {
    const granted = visibleNavItems({ perms: ['exchange_account:*'], plat: false }).map((item) => item.href);

    expect(granted).toContain('/exchanges/key-health');
  });
});

describe('batch 05 feature sources', () => {
  const sources = [
    'src/features/copy-trading/copy-budget-admin-console.tsx',
    'src/features/billing/fee-schedule-admin-console.tsx',
    'src/features/billing/profit-share-statement-admin-console.tsx',
    'src/features/exchanges/exchange-key-health-console.tsx',
    'src/api/copy-budget-admin-api.ts',
    'src/api/fee-schedule-admin-api.ts',
    'src/api/profit-share-statement-admin-api.ts',
    'src/api/exchange-key-health-admin-api.ts',
  ];

  it.each(sources)('never converts money with parseFloat or Number() in %s', (path) => {
    const source = readFileSync(resolve(process.cwd(), path), 'utf8');
    // Comments are stripped first: several of these files EXPLAIN that they never
    // call `Number()` on money, and a scan that cannot tell the rule from the
    // sentence documenting it punishes the comment instead of the bug.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

    expect(code).not.toMatch(/parseFloat\(/);
    expect(code).not.toMatch(/\bNumber\(/);
  });

  it.each(sources)('carries the responsibility comment on line 1 of %s', (path) => {
    const first = readFileSync(resolve(process.cwd(), path), 'utf8').split('\n')[0] ?? '';

    expect(first.startsWith('// # Responsibility:')).toBe(true);
  });
});
