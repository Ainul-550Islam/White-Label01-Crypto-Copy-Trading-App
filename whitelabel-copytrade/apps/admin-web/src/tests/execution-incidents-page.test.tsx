// # NEW — Verifies admin execution incident console and kill-switch actions
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExecutionIncidentTable } from '../features/execution/execution-incident-table';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }),
}));

describe('ExecutionIncidentTable (GAP-26)', () => {
  test('renders execution incidents, severity badges, and kill-switch controls', () => {
    const html = renderToStaticMarkup(
      <ExecutionIncidentTable
        incidents={[
          {
            id: 'inc-101',
            accountId: 'acct-1',
            orderId: 'ord-1',
            clientOrderId: 'oms12345',
            incidentType: 'UNKNOWN_ORDER_RESULT',
            severity: 'CRITICAL',
            venue: 'BINANCE',
            symbol: 'BTC-USDT',
            errorCode: 'TIMEOUT',
            summary: 'Order submit timed out waiting for venue acknowledgement',
            details: {},
            occurredAtMicros: '1700000000000000',
            resolvedAt: null,
            resolvedBy: null,
            resolutionNote: null,
            createdAt: '2026-10-01T10:00:00.000Z',
          },
        ]}
        killSwitches={[
          {
            id: 'ks-1',
            scope: 'EXCHANGE',
            target: 'BINANCE',
            isEngaged: true,
            reason: 'Elevated timeout rate on Binance spot',
            engagedAt: '2026-10-01T10:01:00.000Z',
            releasedAt: null,
          },
        ]}
      />,
    );

    expect(html).toContain('data-testid="execution-incident-console"');
    expect(html).toContain('data-testid="execution-kill-switch-form"');
    expect(html).toContain('UNKNOWN_ORDER_RESULT');
    expect(html).toContain('Order submit timed out waiting for venue acknowledgement');
    expect(html).toContain('EXCHANGE:BINANCE');
  });
});
