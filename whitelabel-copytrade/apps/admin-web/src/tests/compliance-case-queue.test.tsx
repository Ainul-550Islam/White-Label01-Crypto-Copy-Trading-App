// # NEW — Verifies compliance case queue rendering and status filtering
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ComplianceCaseQueue,
  type ComplianceCaseQueueItem,
} from '../features/compliance/compliance-case-queue';

const SAMPLE_CASES: ComplianceCaseQueueItem[] = [
  {
    id: 'case-open-101',
    tenantId: 'tenant-1',
    userId: 'user-alpha',
    caseType: 'AML_SANCTIONS_HIT',
    state: 'ESCALATED',
    riskLevel: 'CRITICAL',
    severity: 'CRITICAL',
    safeSummary: 'Potential OFAC watchlist match on withdrawal address',
    assignedTo: 'mlro-1',
    jurisdiction: 'US',
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:05:00.000Z',
  },
  {
    id: 'case-resolved-202',
    tenantId: 'tenant-1',
    userId: 'user-beta',
    caseType: 'VELOCITY_ALERT',
    state: 'RESOLVED',
    riskLevel: 'LOW',
    severity: 'LOW',
    safeSummary: 'Cleared rapid deposit velocity after source-of-funds review',
    assignedTo: 'reviewer-2',
    jurisdiction: 'SG',
    createdAt: '2026-09-29T08:00:00.000Z',
    updatedAt: '2026-09-30T12:00:00.000Z',
  },
];

describe('ComplianceCaseQueue (GAP-31)', () => {
  test('renders all compliance cases with severity, state, and subject user', () => {
    const html = renderToStaticMarkup(<ComplianceCaseQueue cases={SAMPLE_CASES} />);
    expect(html).toContain('data-testid="compliance-case-queue"');
    expect(html).toContain('Potential OFAC watchlist match on withdrawal address');
    expect(html).toContain('Cleared rapid deposit velocity after source-of-funds review');
    expect(html).toContain('Showing 2 of 2 cases');
  });

  test('filters compliance cases by initialStateFilter and initialSeverityFilter', () => {
    const html = renderToStaticMarkup(
      <ComplianceCaseQueue
        cases={SAMPLE_CASES}
        initialStateFilter="ESCALATED"
        initialSeverityFilter="CRITICAL"
      />,
    );
    expect(html).toContain('Potential OFAC watchlist match on withdrawal address');
    expect(html).not.toContain('Cleared rapid deposit velocity after source-of-funds review');
    expect(html).toContain('Showing 1 of 2 cases');
  });
});
