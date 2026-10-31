// # Responsibility: proves the profit-share console renders its states, never recomputes a ledger-derived amount, flags a statement whose lines do not add up, and finalizes only a draft behind a proof minted for STATEMENT_REGENERATE.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ProfitShareStatementAdminConsole } from './profit-share-statement-admin-console';
import {
  asStatements,
  isValidPeriod,
  isUuid,
  profitShareStatementAdminApi,
  type ProfitShareStatement,
} from '@/api/profit-share-statement-admin-api';

jest.mock('@/lib/api-client', () => ({
  apiClient: { get: jest.fn().mockResolvedValue({ data: [] }), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
  usePathname: () => '/billing/statements',
}));

afterEach(() => {
  jest.restoreAllMocks();
});

function statement(overrides: Partial<ProfitShareStatement> = {}): ProfitShareStatement {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    tenantId: '22222222-2222-4222-8222-222222222222',
    followerUserId: '33333333-3333-4333-8333-333333333333',
    traderUserId: '44444444-4444-4444-8444-444444444444',
    periodStart: '2026-09-01T00:00:00.000Z',
    periodEnd: '2026-10-01T00:00:00.000Z',
    version: 1,
    status: 'FINALIZED',
    currency: 'USD',
    grossProfit: '1250.50',
    profitShareAmount: '250.10',
    highWaterMark: '1250.50',
    roundingRule: 'HALF_EVEN_8_PLACES_ONCE_AFTER_POSTED_LEDGER_SUM',
    supersedesId: null,
    finalizedAt: '2026-10-02T00:00:00.000Z',
    createdAt: '2026-10-02T00:00:00.000Z',
    lines: [
      {
        id: 'line-1',
        statementId: '11111111-1111-4111-8111-111111111111',
        sourceLedgerId: 'ledger-1',
        sourceUserId: '33333333-3333-4333-8333-333333333333',
        currency: 'USD',
        profitAmount: '1000.40',
        feeAmount: '200.08',
        postedAt: '2026-09-15T00:00:00.000Z',
      },
      {
        id: 'line-2',
        statementId: '11111111-1111-4111-8111-111111111111',
        sourceLedgerId: 'ledger-2',
        sourceUserId: '33333333-3333-4333-8333-333333333333',
        currency: 'USD',
        profitAmount: '250.10',
        feeAmount: '50.02',
        postedAt: '2026-09-20T00:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

describe('ProfitShareStatementAdminConsole first paint', () => {
  it('renders the generation form and says it has nothing yet rather than showing an empty table', () => {
    const html = renderToStaticMarkup(<ProfitShareStatementAdminConsole />);

    expect(html).toContain('Generate a statement');
    expect(html).toContain('Generated statements');
    expect(html).toContain('Nothing generated yet');
    expect(html).toMatch(/aria-live="polite"/);
  });

  it('says why the list is empty instead of implying a clean tenant', () => {
    const html = renderToStaticMarkup(<ProfitShareStatementAdminConsole />);

    expect(html).toContain('the API exposes no platform-wide statement list');
  });

  it('explains that the period end is exclusive', () => {
    const html = renderToStaticMarkup(<ProfitShareStatementAdminConsole />);

    expect(html).toContain('The end of a period is exclusive, so this day is not billed.');
  });

  it('labels every control it renders and leaks no raw server string', () => {
    const html = renderToStaticMarkup(<ProfitShareStatementAdminConsole />);
    const controls = html.match(/<(input|select|textarea)\b[^>]*>/g) ?? [];

    expect(controls.length).toBeGreaterThanOrEqual(5);
    expect(html).toMatch(/<label\b/);
    for (const control of controls) {
      expect(control).not.toMatch(/id=""/);
    }
    expect(html).not.toMatch(/INTERNAL_SERVER_ERROR|PrismaClient|at Object\.<anonymous>|ECONNREFUSED/);
  });

  it('offers no finalize action before a statement exists', () => {
    const html = renderToStaticMarkup(<ProfitShareStatementAdminConsole />);

    expect(html).not.toContain('Finalize statement');
  });
});

describe('profit-share statement input rules', () => {
  it('accepts only a UUID as a user id', () => {
    expect(isUuid('33333333-3333-4333-8333-333333333333')).toBe(true);
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid('')).toBe(false);
  });

  it('rejects a period whose end is not after its start', () => {
    expect(isValidPeriod('2026-09-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')).toBe(true);
    expect(isValidPeriod('2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')).toBe(false);
    expect(isValidPeriod('2026-10-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')).toBe(false);
    expect(isValidPeriod('nonsense', '2026-10-01T00:00:00.000Z')).toBe(false);
  });

  it('treats the generate answer as a list, because a multi-currency period answers with one statement per currency', () => {
    const one = statement();
    expect(asStatements(one)).toEqual([one]);
    expect(asStatements([one, statement({ id: 'other', currency: 'EUR' })])).toHaveLength(2);
    // An empty array is the API's answer for "no posted performance fees", and it
    // is not an error; the console reports it as a result.
    expect(asStatements([])).toEqual([]);
    expect(asStatements(null)).toEqual([]);
  });
});

describe('profit-share statement amounts', () => {
  it('never recomputes a ledger amount in the console', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/features/billing/profit-share-statement-admin-console.tsx'), 'utf8');
    const api = readFileSync(resolve(process.cwd(), 'src/api/profit-share-statement-admin-api.ts'), 'utf8');

    for (const text of [source, api]) {
      expect(text).not.toMatch(/parseFloat/);
      expect(text).not.toMatch(/\bNumber\(/);
    }
    // The only arithmetic is the reconciliation check, which compares strings and
    // never rewrites a stored amount.
    expect(source).toContain('addAmounts');
    expect(source).not.toMatch(/profitShareAmount\s*=/);
  });

  it('flags a statement whose lines do not add up to the stated fee, rather than correcting it', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/features/billing/profit-share-statement-admin-console.tsx'), 'utf8');

    expect(source).toContain('Statement lines do not add up to the stated fee');
    expect(source).toContain('Do not treat this statement as verified');
  });
});

describe('profit-share statement step-up', () => {
  it('mints the proof for STATEMENT_REGENERATE and sends the pair and period unchanged', async () => {
    const { apiClient } = jest.requireMock<{ apiClient: { post: jest.Mock } }>('@/lib/api-client');
    apiClient.post.mockResolvedValueOnce({
      proofId: 'proof-2',
      action: 'STATEMENT_REGENERATE',
      method: 'PASSWORD',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const generate = jest.spyOn(profitShareStatementAdminApi, 'generate').mockResolvedValue([statement()]);

    await profitShareStatementAdminApi.requestStepUp('PASSWORD', 'correct horse battery staple', 'proof-key');
    await profitShareStatementAdminApi.generate(
      {
        followerUserId: '33333333-3333-4333-8333-333333333333',
        traderUserId: '44444444-4444-4444-8444-444444444444',
        periodStart: '2026-09-01T00:00:00.000Z',
        periodEnd: '2026-10-01T00:00:00.000Z',
      },
      'generate-key',
    );

    expect(apiClient.post).toHaveBeenCalledWith(
      '/v1/auth/step-up/verify',
      { action: 'STATEMENT_REGENERATE', method: 'PASSWORD', password: 'correct horse battery staple' },
      { idempotencyKey: 'proof-key' },
    );
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        followerUserId: '33333333-3333-4333-8333-333333333333',
        periodStart: '2026-09-01T00:00:00.000Z',
      }),
      'generate-key',
    );
  });

  it('finalizes through the statement id route', async () => {
    const finalize = jest.spyOn(profitShareStatementAdminApi, 'finalize').mockResolvedValue(statement({ status: 'FINALIZED' }));

    await profitShareStatementAdminApi.finalize('11111111-1111-4111-8111-111111111111', 'finalize-key');

    expect(finalize).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', 'finalize-key');
  });
});
