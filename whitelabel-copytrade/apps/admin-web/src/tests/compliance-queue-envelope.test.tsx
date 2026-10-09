// # Responsibility: pins the admin compliance page to the envelope the API actually answers with, so the queue cannot silently render empty again while the console reports success.

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }),
}));

jest.mock('../lib/server-api', () => ({
  serverFetch: jest.fn(),
}));

import { serverFetch } from '../lib/server-api';
import ComplianceQueuePage from '../app/(console)/compliance/page';

const serverFetchMock = serverFetch as unknown as jest.Mock;

/**
 * Why this test exists.
 *
 * `GET /v1/compliance/cases` answers with the platform's paged envelope - `{ data, total, page,
 * limit }` from `complianceCase.repository.listTenantCases` - and `GET
 * /v1/compliance/monitoring/signals` answers `{ data, total }`. The page asked for `items` and
 * `cases` instead, so against the real API the compliance queue rendered its empty state and the
 * console reported success: a compliance screen that shows no cases looks exactly like a tenant
 * with no cases. Nothing failed, nothing was logged, and no test existed.
 *
 * These tests are deliberately written against the *envelope*, not the rendered strings alone: the
 * first one fails if the page reads `items` (it would render zero rows and the case id would be
 * absent), and the second fails if a future edit reintroduces a shape the API does not send.
 */
describe('admin compliance queue page', () => {
  const endpointPayloads = () => ({
    cases: {
      data: [
        {
          id: 'case-envelope-1',
          tenantId: 'tenant-1',
          userId: 'user-1',
          caseType: 'KYC_REVIEW',
          state: 'OPEN',
          severity: 'HIGH',
          riskLevel: 'HIGH',
          decision: null,
          assignedTo: null,
          assignedAt: null,
          escalatedAt: null,
          resolvedAt: null,
          closedAt: null,
          idempotencyKey: 'case-envelope-1-key',
          safeSummary: 'Identity document requires manual review.',
          jurisdiction: 'BD',
          policyVersion: 'v1',
          ruleIds: [],
          sourceRefs: [],
          metadata: {},
          createdAt: '2026-10-01T09:00:00.000Z',
          updatedAt: '2026-10-06T09:00:00.000Z',
        },
      ],
      total: 1,
      page: 1,
      limit: 50,
    },
    signals: { data: [{ id: 'signal-1' }], total: 1 },
  });

  beforeEach(() => {
    serverFetchMock.mockReset();
    const payloads = endpointPayloads();
    serverFetchMock.mockImplementation(async (path: string) => {
      if (path === '/compliance/cases') return payloads.cases;
      if (path === '/compliance/monitoring/signals') return payloads.signals;
      throw new Error(`unexpected path ${path}`);
    });
  });

  it('renders a case delivered in the API paged envelope', async () => {
    const html = renderToStaticMarkup(await ComplianceQueuePage());

    expect(html).toContain('Identity document requires manual review.');
    expect(html).toContain('case-envelo');
    expect(html).toContain('compliance-case-queue');
    // One case in the queue, so the "Showing 1 of 1" counter line must not be the empty state.
    expect(html).not.toContain('No compliance cases match filter');
  });

  it('asks for the two endpoints with the query limits the API accepts', async () => {
    await ComplianceQueuePage();

    expect(serverFetchMock).toHaveBeenCalledWith('/compliance/cases', {
      searchParams: { limit: 50 },
    });
    expect(serverFetchMock).toHaveBeenCalledWith('/compliance/monitoring/signals', {
      searchParams: { limit: 25 },
    });
  });

  it('shows the failure notice and no rows when an endpoint fails, rather than inventing cases', async () => {
    serverFetchMock.mockImplementation(async (path: string) => {
      if (path === '/compliance/cases') throw new Error('compliance API unreachable');
      return { data: [], total: 0 };
    });

    const html = renderToStaticMarkup(await ComplianceQueuePage());

    expect(html).toContain('Compliance data partially degraded');
    expect(html).toContain('compliance API unreachable');
    expect(html).toContain('No compliance cases match filter');
  });

  it('does not read an `items` field the API never sends', async () => {
    // The guard against the exact regression: give the page a payload that has `items` populated
    // and `data` empty, and require that nothing is rendered from `items`.
    serverFetchMock.mockImplementation(async (path: string) => {
      if (path === '/compliance/cases') {
        return {
          data: [],
          total: 0,
          page: 1,
          limit: 50,
          // A field from a different API version, or from the shape this page used to guess.
          items: endpointPayloads().cases.data,
        } as unknown;
      }
      return { data: [], total: 0 };
    });

    const html = renderToStaticMarkup(await ComplianceQueuePage());

    expect(html).not.toContain('Identity document requires manual review.');
    expect(html).toContain('No compliance cases match filter');
  });
});
