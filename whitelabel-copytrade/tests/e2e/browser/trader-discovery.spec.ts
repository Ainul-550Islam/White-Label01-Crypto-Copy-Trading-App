// # Responsibility: drives the customer web app in a real browser through trader discovery - sign in, browse, filter, open the comparison route and the performance view - against the stub upstream.
//
// This replaces the `renderToStaticMarkup` spec that used to sit in this directory and call itself
// end-to-end. That spec primed a react-query cache by hand and asserted on an HTML string: it never
// signed in, never issued a request, never rendered in a browser and could not have failed if the
// proxy, the session or the routing were broken. This one fails when any of those are.

import { expect, test } from '@playwright/test';

import { expectNoUnmatchedTraffic, resetStub, setStubMode, signIn } from './support/session';

test.describe('trader discovery (customer web)', () => {
  test.beforeEach(async ({ page }) => {
    await resetStub(page);
    await signIn(page);
  });

  test('browse, filter, compare and view performance', async ({ page }) => {
    await page.goto('/traders');

    await expect(page.getByTestId('trader-discovery-filters')).toBeVisible();
    await expect(page.getByTestId('trader-card-trader-alpha')).toBeVisible();
    await expect(page.getByTestId('trader-card-trader-beta')).toBeVisible();

    // The comparison route is reachable from the directory, which is what the old smoke test
    // asserted as a substring of static HTML.
    await expect(page.locator('a[href="/traders/compare"]').first()).toBeVisible();

    // Filtering goes through the API: the page asks the upstream with `search=` and renders what
    // comes back. Asserting the narrowed page proves the request carried the parameter.
    await page.getByLabel('Search traders').fill('Alpha');
    await expect(page.getByTestId('trader-card-trader-alpha')).toBeVisible();
    await expect(page.getByTestId('trader-card-trader-beta')).toHaveCount(0);

    const afterFilter = await page.request.get(
      `${process.env.E2E_STUB_URL ?? 'http://127.0.0.1:4600'}/__stub/requests`,
    );
    const log = (await afterFilter.json()) as {
      data: { requests: { method: string; path: string; query: Record<string, string> }[] };
    };
    expect(
      log.data.requests.some(
        (entry) =>
          entry.path === '/v1/copy-trading/traders' && entry.query.search === 'Alpha',
      ),
      'the search box must reach the API as a query parameter',
    ).toBeTruthy();

    // The performance view is a separate route and a separate endpoint.
    await page.goto('/traders/trader-alpha/performance');
    await expect(page.getByTestId('performance-methodology')).toBeVisible();

    const performanceLog = await page.request.get(
      `${process.env.E2E_STUB_URL ?? 'http://127.0.0.1:4600'}/__stub/requests`,
    );
    const performancePayload = (await performanceLog.json()) as {
      data: { requests: { path: string }[] };
    };
    expect(
      performancePayload.data.requests.some(
        (entry) => entry.path === '/v1/copy-trading/traders/trader-alpha/performance',
      ),
      'the performance route must read the trader performance endpoint',
    ).toBeTruthy();

    await expectNoUnmatchedTraffic(page);
  });

  test('an unavailable ranking window is shown as unavailable rather than as an empty leaderboard', async ({
    page,
  }) => {
    await setStubMode(page, { rankingUnavailable: true });
    await page.goto('/traders');

    // Fail-closed, in the browser: the API said the window cannot be ranked, so the page must say
    // so. It must not render the traders as if they had simply not qualified.
    await expect(page.getByTestId('ranking-unavailable')).toBeVisible();
    await expect(page.getByTestId('trader-card-trader-alpha')).toBeVisible();

    await expectNoUnmatchedTraffic(page);
  });
});
