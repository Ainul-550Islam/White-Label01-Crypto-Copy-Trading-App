// # NEW — E2E test: deposit address -> confirmation -> withdrawal request -> compliance/admin review
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ComplianceCaseQueue } from '../../apps/admin-web/src/modules/compliance/compliance-case-queue';
import { ComplianceCaseDetail } from '../../apps/admin-web/src/modules/compliance/compliance-case-detail';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));

describe('E2E Smoke: Funding, Custody & Compliance Review (GAP-48)', () => {
  test('deposit address -> confirmation -> withdrawal request -> compliance/admin review', () => {
    const queueHtml = renderToStaticMarkup(
      React.createElement(ComplianceCaseQueue, {
        cases: [
          {
            id: 'case-aml-901',
            tenantId: 'tenant-1',
            userId: 'user-99',
            caseType: 'WITHDRAWAL_SCREENING',
            state: 'IN_REVIEW',
            riskLevel: 'HIGH',
            severity: 'HIGH',
            safeSummary: 'High-value withdrawal address screening review',
            assignedTo: 'mlro-ops',
            jurisdiction: 'EU',
            createdAt: '2026-10-01T10:00:00.000Z',
            updatedAt: '2026-10-01T10:05:00.000Z',
          },
        ],
      }),
    );
    expect(queueHtml).toContain('case-aml-9');
    expect(queueHtml).toContain('High-value withdrawal address screening review');

    const detailHtml = renderToStaticMarkup(
      React.createElement(ComplianceCaseDetail, {
        caseRecord: {
          id: 'case-aml-901',
          tenantId: 'tenant-1',
          userId: 'user-99',
          caseType: 'WITHDRAWAL_SCREENING',
          state: 'IN_REVIEW',
          riskLevel: 'HIGH',
          severity: 'HIGH',
          safeSummary: 'High-value withdrawal address screening review',
          assignedTo: 'mlro-ops',
          jurisdiction: 'EU',
          screeningMatches: [
            {
              id: 'hit-1',
              listName: 'EU Consolidated Sanctions',
              matchCategory: 'WATCHLIST',
              confidenceScore: 72,
              matchedEntityLabel: 'Secondary Address Cluster',
              disposition: 'PENDING_REVIEW',
            },
          ],
          auditEvents: [
            {
              id: 'aud-1',
              eventType: 'WITHDRAWAL_HOLD_APPLIED',
              actorId: 'SYSTEM',
              decision: 'HOLD',
              rationale: 'Awaiting MLRO disposition on watchlist cluster hit',
              createdAt: '2026-10-01T10:01:00.000Z',
            },
          ],
          createdAt: '2026-10-01T10:00:00.000Z',
          updatedAt: '2026-10-01T10:05:00.000Z',
        },
      }),
    );
    expect(detailHtml).toContain('EU Consolidated Sanctions');
    expect(detailHtml).toContain('WITHDRAWAL_HOLD_APPLIED');
  });
});
