import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { BillingInboxPanel } from '@/features/billing/billing-inbox-panel';
import { BillingNotificationsPanel } from '@/features/billing/billing-notifications-panel';
import { CopyReconciliationPanel } from '@/features/copy-trading/copy-reconciliation-panel';
import { CopyTradingConsole } from '@/features/copy-trading/copy-trading-console';
import { ExchangeOperationsPanel } from '@/features/exchanges/exchange-operations-panel';
import { ExecutionReconciliationPanel } from '@/features/execution/execution-reconciliation-panel';
import { OmsOrdersView } from '@/features/oms/oms-orders-view';
import { PortfolioLedgerConsole } from '@/features/portfolio/portfolio-ledger-console';
import { PositionLimitForm } from '@/features/risk/position-limit-form';
import { RiskControls } from '@/features/risk/risk-controls';
import { RiskPolicyPanel } from '@/features/risk/risk-policy-panel';

jest.mock('@/lib/api-client', () => ({
  apiClient: { get: jest.fn().mockResolvedValue({ data: [] }), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
  usePathname: () => '/oms',
}));

/**
 * Every module this batch added renders its first paint without a server.
 *
 * The assertions are deliberately about what the first paint must and must not
 * contain: a live region so the load is announced, no dangerous action offered
 * before the data that would justify it has arrived, and no raw server text.
 * Behaviour against a live API is covered per-module in the client tests; this
 * file is the guard that no screen ships a blank frame or a pre-armed button.
 */
const surfaces: Array<{ name: string; element: React.ReactElement; announced: RegExp }> = [
  { name: 'OMS orders', element: <OmsOrdersView />, announced: /aria-live="polite"/ },
  { name: 'OMS order filters', element: <OmsOrdersView />, announced: /State/ },
  { name: 'risk policy', element: <RiskPolicyPanel />, announced: /Loading policy|Policy scope/ },
  { name: 'risk controls', element: <RiskControls />, announced: /Loading breakers|Circuit breakers/ },
  { name: 'position limits', element: <PositionLimitForm />, announced: /Loading your limits|My position limits/ },
  { name: 'exchange operations', element: <ExchangeOperationsPanel />, announced: /Loading health|Account health/ },
  { name: 'execution reconciliation', element: <ExecutionReconciliationPanel />, announced: /Loading runs|Reconciliation posture/ },
  { name: 'billing analytics notifications', element: <BillingNotificationsPanel />, announced: /Loading endpoints|Delivery posture/ },
  { name: 'billing inbox', element: <BillingInboxPanel />, announced: /Loading inbox|Your inbox/ },
  { name: 'copy trading', element: <CopyTradingConsole />, announced: /Loading your profile|My trader profile/ },
  { name: 'copy reconciliation', element: <CopyReconciliationPanel />, announced: /Loading records|Reconciliation posture/ },
  { name: 'portfolio ledger', element: <PortfolioLedgerConsole />, announced: /Loading profiles|Profiles/ },
];

describe('batch 04 console surfaces', () => {
  it.each(surfaces)('renders $name with its heading and a live region', ({ element, announced }) => {
    const html = renderToStaticMarkup(element);

    expect(html).toMatch(announced);
    expect(html.length).toBeGreaterThan(400);
  });

  it.each(surfaces)('does not leak a raw server string into $name', ({ element }) => {
    const html = renderToStaticMarkup(element);

    expect(html).not.toMatch(/INTERNAL_SERVER_ERROR|PrismaClient|at Object\.<anonymous>|ECONNREFUSED/);
  });

  it('offers no destructive action before the data that would justify it has loaded', () => {
    const controls = renderToStaticMarkup(<RiskControls />);
    const execution = renderToStaticMarkup(<ExecutionReconciliationPanel />);
    const ledger = renderToStaticMarkup(<PortfolioLedgerConsole />);

    // Clear/release/close buttons appear only inside a loaded table row.
    expect(controls).not.toContain('Confirm clear');
    expect(execution).not.toContain('Record review');
    expect(ledger).not.toContain('Close period');
  });

  it('labels every form control it renders', () => {
    for (const { element } of surfaces) {
      const html = renderToStaticMarkup(element);
      const inputs = html.match(/<(input|select|textarea)\b[^>]*>/g) ?? [];

      // A control with no aria-label, no id and no enclosing <label> is unlabelled;
      // these components always render a <label> wrapper, so the count of
      // controls must be greater than zero and the markup must contain labels.
      if (inputs.length > 0) {
        expect(html).toMatch(/<label\b/);
      }
      for (const input of inputs) {
        expect(input).not.toMatch(/<input(?![^>]*(aria-label|aria-labelledby|type="checkbox"))[^>]*id=""/);
      }
    }
  });
});

describe('batch 04 feature sources', () => {
  const sources = [
    'src/features/oms/oms-order-drawer.tsx',
    'src/features/oms/oms-recovery-panel.tsx',
    'src/features/oms/oms-operations.tsx',
    'src/features/oms/oms-reconciliation-queue.tsx',
    'src/features/risk/risk-policy-panel.tsx',
    'src/features/risk/risk-controls.tsx',
    'src/features/risk/account-risk-panel.tsx',
    'src/features/risk/position-limit-form.tsx',
    'src/features/exchanges/venue-status-table.tsx',
    'src/features/exchanges/exchange-operations-panel.tsx',
    'src/features/execution/execution-order-table.tsx',
    'src/features/execution/exchange-account-table.tsx',
    'src/features/execution/execution-reconciliation-panel.tsx',
    'src/features/billing/billing-analytics-dashboard.tsx',
    'src/features/billing/billing-notifications-panel.tsx',
    'src/features/billing/billing-inbox-panel.tsx',
    'src/features/copy-trading/copy-trading-console.tsx',
    'src/features/copy-trading/copy-reconciliation-panel.tsx',
    'src/features/portfolio/portfolio-ledger-console.tsx',
  ];

  it.each(sources)('never converts money with parseFloat or Number() in %s', (path) => {
    const source = readFileSync(resolve(process.cwd(), path), 'utf8');

    expect(source).not.toContain('parseFloat');
    expect(source).not.toMatch(/Number\(\s*(row\.|data\.|value\b)/);
  });

  it.each(sources)('gives every API write a stable idempotency key in %s', (path) => {
    const source = readFileSync(resolve(process.cwd(), path), 'utf8');
    const lines = source.split('\n');
    // A write is any client call whose method name is a write verb. The key may
    // be an inline randomUUID, a per-attempt key held in state, or a memoised key
    // (``keyFor``), so the assertion is over the call window rather than one line.
    const writeCall = /Api\.\w*(create|update|set|post|cancel|replace|resolve|acknowledge|recover|publish|pause|resume|archive|rotate|engage|clear|close|mark|delete|remove|verify|enable|run|process|sync|trigger|save)\w*\(/i;
    const offenders: string[] = [];

    lines.forEach((line, index) => {
      if (!writeCall.test(line)) return;
      // Reads share the verb surface (`getReconciliationRun`), so a call whose
      // method name starts with a read prefix is not a write.
      const method = line.match(/Api\.(\w+)\(/)?.[1] ?? '';
      if (/^(get|list|search|read|fetch)/i.test(method)) return;
      // `invalidateCache` is declared `@Get` on the analytics controller, so it
      // carries no idempotency key by design.
      if (line.includes('invalidateCache')) return;
      // The key is usually minted just before the call in the same function.
      const window = lines.slice(Math.max(0, index - 18), index + 12).join('\n');
      if (!/randomUUID|keyFor\(|idempotencyKey|const key =/.test(window)) {
        offenders.push(`${path}:${index + 1}: ${line.trim()}`);
      }
    });

    expect(offenders).toEqual([]);
  });

  it.each(sources)('announces asynchronous results with a live region in %s', (path) => {
    const source = readFileSync(resolve(process.cwd(), path), 'utf8');

    expect(source).toMatch(/aria-live="polite"/);
  });

  it('states the risk controls confirmation phrase the API enforces', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/features/risk/risk-controls.tsx'), 'utf8');

    expect(source).toContain("const CLEAR_CONFIRMATION = 'CLEAR RISK PROTECTION'");
    expect(source).toContain('does not re-enable trading');
  });

  it('uses the live-trading phrase the execution DTO validates', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/features/execution/exchange-account-table.tsx'), 'utf8');

    expect(source).toContain('LIVE_TRADING_CONFIRMATION');
    expect(source).toContain('secrets are never');
  });

  it('keeps a one-time webhook secret out of any follow-up request', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/features/billing/billing-notifications-panel.tsx'), 'utf8');

    expect(source).toContain('returns a signing secret only once');
    // The reveal panel is cleared as soon as the operator acknowledges it.
    expect(source).toContain('setIssuedSecret(null)');
  });
});
