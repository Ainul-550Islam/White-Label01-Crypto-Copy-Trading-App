// # NEW — Verifies compliance audit timeline rendering
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ComplianceAuditTimeline } from '../modules/compliance/compliance-audit-timeline';

describe('ComplianceAuditTimeline (GAP-34)', () => {
  test('renders chronological compliance audit events with actor and rationale', () => {
    const html = renderToStaticMarkup(
      <ComplianceAuditTimeline
        events={[
          {
            id: 'ev-2',
            eventType: 'CASE_DECISION_RECORDED',
            actorId: 'mlro-1',
            decision: 'HOLD',
            rationale: 'Account withdrawals placed on hold pending secondary OFAC verification',
            createdAt: '2026-10-01T11:00:00.000Z',
          },
          {
            id: 'ev-1',
            eventType: 'CASE_OPENED',
            actorId: 'SYSTEM',
            decision: null,
            rationale: 'Auto-opened by transaction monitoring rule STRUCTURING_24H',
            createdAt: '2026-10-01T10:00:00.000Z',
          },
        ]}
      />,
    );

    expect(html).toContain('data-testid="compliance-audit-timeline"');
    expect(html).toContain('CASE_OPENED');
    expect(html).toContain('CASE_DECISION_RECORDED');
    expect(html).toContain('Account withdrawals placed on hold pending secondary OFAC verification');
    // Chronological order: ev-1 appears before ev-2
    expect(html.indexOf('ev-1')).toBeLessThan(html.indexOf('ev-2'));
  });
});
