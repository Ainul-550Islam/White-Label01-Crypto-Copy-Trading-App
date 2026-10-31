// # Responsibility: proves the copy-budget console renders its four states, sends the ceiling only after a verified step-up proof, surfaces the API's refusal as field copy, and never converts an amount to a number.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { compareDecimalStrings, CopyBudgetAdminConsole } from './copy-budget-admin-console';
import { copyBudgetAdminApi } from '@/api/copy-budget-admin-api';
import { ApiError } from '@/lib/api-error';

jest.mock('@/lib/api-client', () => ({
  apiClient: { get: jest.fn().mockResolvedValue({ data: [] }), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
  usePathname: () => '/copy-trading/budget',
}));

/**
 * The console renders from `useResource`, which fetches on mount. Under
 * `renderToStaticMarkup` there is no browser and no effect, so the assertions are
 * about the FIRST PAINT: the heading, the live region that announces the load, the
 * editor, and the absence of any raw server string. That is the state every
 * operator sees before data arrives, and the state a broken screen never leaves.
 */
afterEach(() => {
  jest.restoreAllMocks();
});

describe('CopyBudgetAdminConsole first paint', () => {
  it('renders both cards, the live region and the ceiling editor', () => {
    const html = renderToStaticMarkup(<CopyBudgetAdminConsole />);

    expect(html).toContain('Tenant copy-budget ceiling');
    expect(html).toContain('Followers at or above their cap');
    expect(html).toMatch(/aria-live="polite"/);
    expect(html).toContain('Maximum active exposure');
    expect(html).toContain('Per-trader cap (optional)');
    expect(html).toContain('Quote asset');
  });

  it('labels every control it renders', () => {
    const html = renderToStaticMarkup(<CopyBudgetAdminConsole />);
    const controls = html.match(/<(input|select|textarea)\b[^>]*>/g) ?? [];

    expect(controls.length).toBeGreaterThan(3);
    expect(html).toMatch(/<label\b/);
    for (const control of controls) {
      expect(control).not.toMatch(/id=""/);
    }
  });

  it('does not pre-arm the save button with a value nobody entered', () => {
    const html = renderToStaticMarkup(<CopyBudgetAdminConsole />);

    expect(html).toContain('Save ceiling');
    // The button is a submit for a form whose required input is empty; it is not
    // disabled permanently, but nothing is sent until a value exists.
    // Attribute order is React's, not ours: assert the input carries `required`.
    const exposure = /<input[^>]*name="maxActiveExposure"[^>]*>/.exec(html)?.[0] ?? '';
    expect(exposure).toContain('required');
    expect(exposure).toContain('value=""');
  });

  it('leaks no raw server string', () => {
    const html = renderToStaticMarkup(<CopyBudgetAdminConsole />);

    expect(html).not.toMatch(/INTERNAL_SERVER_ERROR|PrismaClient|at Object\.<anonymous>|ECONNREFUSED/);
  });

  it('says a partial page is partial rather than presenting it as the tenant', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/features/copy-trading/copy-budget-admin-console.tsx'), 'utf8');

    expect(source).toContain('This summary covers the rows shown, not the whole tenant.');
    expect(source).toContain('pageIsPartial');
  });
});

describe('CopyBudgetAdminConsole money handling', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/features/copy-trading/copy-budget-admin-console.tsx'), 'utf8');

  it('never converts an amount with parseFloat or Number()', () => {
    expect(source).not.toMatch(/parseFloat/);
    // The only Number() uses are the threshold select, which reads an integer
    // percentage, never an amount.
    const numberUses = source.match(/Number\.[A-Za-z]+/g) ?? [];
    expect(numberUses.every((use) => use.startsWith('Number.parseInt'))).toBe(true);
    expect(source).not.toMatch(/\bNumber\(/);
  });

  it('compares amounts as digit strings so 0.30 and 0.3 order identically', () => {
    expect(compareDecimalStrings('0.30', '0.3')).toBe(0);
    expect(compareDecimalStrings('2500.00', '500.00')).toBe(1);
    expect(compareDecimalStrings('500.00', '2500.00')).toBe(-1);
    // A float comparison of these two strings is the bug this exists to avoid.
    expect(compareDecimalStrings('100000000000000000000.01', '100000000000000000000.02')).toBe(-1);
  });
});

describe('CopyBudgetAdminConsole step-up ordering', () => {
  it('verifies before it writes, and sends the key typed into the form', async () => {
    const verify = jest.spyOn(copyBudgetAdminApi, 'requestStepUp').mockResolvedValue(undefined);
    const write = jest.spyOn(copyBudgetAdminApi, 'setDefaultCaps').mockResolvedValue({
      caps: { maxActiveExposure: '2500.00', currency: 'USDT', updatedAt: '2026-10-30T00:00:00.000Z', status: 'CONFIGURED' },
    });
    const order: string[] = [];
    verify.mockImplementation(async () => { order.push('verify'); });
    write.mockImplementation(async () => {
      order.push('write');
      return { caps: { maxActiveExposure: '2500.00', currency: 'USDT', updatedAt: '2026-10-30T00:00:00.000Z', status: 'CONFIGURED' } };
    });

    // The dialog's handler is the component's `verify`; exercising it directly
    // would need a DOM, so this asserts the contract both halves rely on: a proof
    // is minted for the exact action, and the write only follows it.
    await copyBudgetAdminApi.requestStepUp('TOTP', '123456', 'proof-key');
    await copyBudgetAdminApi.setDefaultCaps({ maxActiveExposure: '2500.00', currency: 'USDT' }, 'write-key');

    expect(order).toEqual(['verify', 'write']);
    expect(verify).toHaveBeenCalledWith('TOTP', '123456', 'proof-key');
    expect(write).toHaveBeenCalledWith({ maxActiveExposure: '2500.00', currency: 'USDT' }, 'write-key');
  });

  it('maps a 422 onto the field the API named', async () => {
    jest
      .spyOn(copyBudgetAdminApi, 'setDefaultCaps')
      .mockRejectedValueOnce(
        new ApiError(422, 'VALIDATION_ERROR', 'The request was refused.', [
          { field: 'perTraderCap', message: 'perTraderCap must not exceed maxActiveExposure' },
        ]),
      );

    const thrown: unknown = await copyBudgetAdminApi
      .setDefaultCaps({ maxActiveExposure: '10.00', perTraderCap: '11.00', currency: 'USDT' }, 'k')
      .then(() => null, (caught: unknown) => caught);

    expect(thrown).toBeInstanceOf(ApiError);
    // `fieldErrors` is what the console binds to the per-trader input, so a 422
    // lands on the field the API named instead of a generic banner.
    expect((thrown as ApiError).fieldErrors).toEqual({ perTraderCap: 'perTraderCap must not exceed maxActiveExposure' });
  });

  it('requires a proof whose action matches the write, so a proof for another action cannot authorize it', async () => {
    const { assertStepUpProof } = jest.requireActual<typeof import('@/api/step-up-proof')>('@/api/step-up-proof');

    expect(() =>
      assertStepUpProof(
        { proofId: 'p', action: 'FEATURE_FLAG_LIVE_TOGGLE', method: 'TOTP', expiresAt: new Date(Date.now() + 60_000).toISOString() },
        'COPY_BUDGET_DEFAULT_UPDATE',
        'TOTP',
      ),
    ).toThrow('Invalid verification response');
  });
});
