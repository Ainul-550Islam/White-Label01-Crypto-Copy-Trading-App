// # Responsibility: drives the admin console in a real browser - the compliance case queue and the custody reconciliation view - which are server components whose data never passes through the browser.
//
// This is the spec that `page.route()` could never have written. The console's data path is
// `serverFetch` inside a server component: the request is made by the Next.js server, not by the
// browser, so browser-level interception would have tested nothing at all. The stub upstream is
// therefore the only honest place to stand, and this test proves the console's server-side session
// handling, its fetches and its rendering together.

import { expect, test } from '@playwright/test';

import { expectNoUnmatchedTraffic, readStubLog, resetStub, signIn } from './support/session';

test.describe('admin console operations', () => {
  test.beforeEach(async ({ page }) => {
    await resetStub(page);
    await signIn(page);
  });

  test('the compliance queue renders the case and its signals', async ({ page }) => {
    await page.goto('/compliance');

    await expect(page.getByText('Identity document requires manual review.')).toBeVisible();
    await expect(page.getByText('KYC_REVIEW')).toBeVisible();

    const log = await readStubLog(page);
    const paths = log.requests.map((entry) => `${entry.method} ${entry.path}`);
    expect(paths).toContain('GET /v1/compliance/cases');
    expect(paths).toContain('GET /v1/compliance/monitoring/signals');
    expect(
      log.requests.every((entry) => entry.authorized),
      'server components must attach the console session token to every read',
    ).toBeTruthy();

    await expectNoUnmatchedTraffic(page);
  });

  test('the custody reconciliation view renders the finding it was given', async ({ page }) => {
    await page.goto('/funding-reconciliation');

    await expect(page.getByText('finding-e2e-1')).toBeVisible({ timeout: 15_000 });

    const log = await readStubLog(page);
    expect(
      log.requests.some((entry) => entry.path === '/v1/custody/reconciliation/findings'),
      'the reconciliation view must read the findings endpoint',
    ).toBeTruthy();

    await expectNoUnmatchedTraffic(page);
  });
});
