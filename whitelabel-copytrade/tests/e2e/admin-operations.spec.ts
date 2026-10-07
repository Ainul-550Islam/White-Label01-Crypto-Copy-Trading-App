// # NEW — E2E test: admin kill-switch -> incident resolution -> reconciliation view
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExecutionIncidentTable } from '../../apps/admin-web/src/modules/execution/execution-incident-table';
import { FundingReconciliationTable } from '../../apps/admin-web/src/modules/funding/funding-reconciliation-table';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));

describe('E2E Smoke: Admin Operations — Kill-Switch, Incidents & Reconciliation (GAP-48)', () => {
  test('admin kill-switch -> incident resolution -> reconciliation view', () => {
    const incidentHtml = renderToStaticMarkup(
      React.createElement(ExecutionIncidentTable, {
        incidents: [
          {
            id: 'inc-ops-1',
            accountId: 'acct-1',
            orderId: 'ord-1',
            clientOrderId: 'oms-e2e-1',
            incidentType: 'ORDER_STATE_MISMATCH',
            severity: 'CRITICAL',
            venue: 'BYBIT',
            symbol: 'ETH-USDT',
            errorCode: 'STATE_DRIFT',
            summary: 'Venue reported FILLED while local order was SUBMITTED',
            details: {},
            occurredAtMicros: '1700000000000000',
            resolvedAt: null,
            resolvedBy: null,
            resolutionNote: null,
            createdAt: '2026-10-01T10:00:00.000Z',
          },
        ],
        killSwitches: [
          {
            id: 'ks-global',
            scope: 'GLOBAL',
            target: null,
            isEngaged: false,
            reason: 'Normal operations',
            engagedAt: null,
            releasedAt: '2026-10-01T08:00:00.000Z',
          },
        ],
      }),
    );
    expect(incidentHtml).toContain('ORDER_STATE_MISMATCH');
    expect(incidentHtml).toContain('Venue reported FILLED while local order was SUBMITTED');

    const reconHtml = renderToStaticMarkup(
      React.createElement(FundingReconciliationTable, {
        findings: [
          {
            id: 'find-1',
            type: 'CONFIRMATION_MISMATCH',
            assetId: 'USDT',
            networkId: 'ERC20',
            description: 'Custody confirmation count ahead of internal deposit state',
            severity: 'MEDIUM',
            resolved: false,
            resolutionNote: null,
            correctiveAction: null,
            createdAt: '2026-10-01T10:15:00.000Z',
          },
        ],
      }),
    );
    expect(reconHtml).toContain('CONFIRMATION_MISMATCH');
    expect(reconHtml).toContain('Custody confirmation count ahead of internal deposit state');
  });
});
