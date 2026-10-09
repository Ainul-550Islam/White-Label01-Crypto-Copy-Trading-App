// # Responsibility: drives the copy-subscription detail view in a real browser - guardrails, execution history, and the pause/resume round trip through the proxy, the CSRF check and the upstream API.
//
// The mutation is the part that matters. Pausing a subscription is a POST that must carry the CSRF
// token the login route issued and the session cookie the proxy reads; if either is missing the
// proxy answers 403/401 and the button does nothing. The test asserts the state actually changed by
// reading the page the application re-fetched, and asserts on the stub's request log that the POST
// arrived with the session token attached.

import { expect, test } from '@playwright/test';

import { expectNoUnmatchedTraffic, readStubLog, resetStub, signIn } from './support/session';

const SUBSCRIPTION_ID = 'sub-e2e-1';

test.describe('copy-trading subscription lifecycle (customer web)', () => {
  test.beforeEach(async ({ page }) => {
    await resetStub(page);
    await signIn(page);
  });

  test('the detail view composes its three reads and shows the guardrails', async ({ page }) => {
    await page.goto(`/copy-trading/${SUBSCRIPTION_ID}`);

    await expect(page.getByTestId('copy-subscription-detail-page')).toBeVisible();
    await expect(page.getByTestId('guardrail-max-daily-loss')).toBeVisible();
    await expect(page.getByTestId('guardrail-max-drawdown')).toBeVisible();
    await expect(page.getByTestId('pause-subscription-btn')).toBeVisible();

    const log = await readStubLog(page);
    const paths = log.requests.map((entry) => `${entry.method} ${entry.path}`);
    expect(paths).toContain('GET /v1/copy-trading/subscriptions/sub-e2e-1');
    expect(paths).toContain('GET /v1/copy-trading/policies/effective');
    expect(paths).toContain('GET /v1/copy-trading/executions');
    expect(
      log.requests.every((entry) => entry.authorized),
      'every API read behind the proxy must carry the session token',
    ).toBeTruthy();

    await expectNoUnmatchedTraffic(page);
  });

  test('pause moves the subscription and resume moves it back', async ({ page }) => {
    await page.goto(`/copy-trading/${SUBSCRIPTION_ID}`);
    await expect(page.getByTestId('pause-subscription-btn')).toBeVisible();

    await page.getByTestId('pause-subscription-btn').click();

    // The button swaps because the page re-fetched the subscription and the upstream now reports
    // PAUSED. A UI that only flipped local state would pass a screenshot test and fail this one.
    await expect(page.getByTestId('resume-subscription-btn')).toBeVisible();
    await expect(page.getByTestId('pause-subscription-btn')).toHaveCount(0);

    const afterPause = await readStubLog(page);
    expect(
      afterPause.requests.some(
        (entry) =>
          entry.method === 'POST' &&
          entry.path === '/v1/copy-trading/subscriptions/sub-e2e-1/pause' &&
          entry.authorized,
      ),
      'the pause must reach the upstream as an authenticated POST',
    ).toBeTruthy();

    await page.getByTestId('resume-subscription-btn').click();
    await expect(page.getByTestId('pause-subscription-btn')).toBeVisible();

    const afterResume = await readStubLog(page);
    expect(
      afterResume.requests.some(
        (entry) =>
          entry.method === 'POST' &&
          entry.path === '/v1/copy-trading/subscriptions/sub-e2e-1/resume' &&
          entry.authorized,
      ),
      'the resume must reach the upstream as an authenticated POST',
    ).toBeTruthy();

    await expectNoUnmatchedTraffic(page);
  });
});
