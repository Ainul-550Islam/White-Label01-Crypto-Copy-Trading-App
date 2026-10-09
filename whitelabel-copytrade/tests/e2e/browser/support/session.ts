// # Responsibility: the shared browser-session and stub-control helpers every E2E spec uses - sign in through the real login form, then read or steer the stub upstream.
//
// Signing in through the form is deliberate. The alternative - injecting the session cookie into the
// browser context - would skip the login route handler, the upstream `/auth/login` call, the cookie
// attributes and the CSRF cookie that every mutation later depends on. Every one of those is part
// of what a buyer is paying for, and it is exactly the path that broke silently in the past
// (`getTraderExposure` called a route no controller mounted, so both panels rendered "unavailable"
// and nothing failed).

import { expect, type Page } from '@playwright/test';

export const STUB_BASE_URL = process.env.E2E_STUB_URL ?? 'http://127.0.0.1:4600';
export const E2E_EMAIL = 'e2e-follower@example.test';
export const E2E_PASSWORD = 'e2e-password-not-used-by-the-stub';

export interface SignInOptions {
  email?: string;
  password?: string;
}

/** Signs in through `/login` and waits until the app leaves the login route. */
export async function signIn(page: Page, options: SignInOptions = {}): Promise<void> {
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(options.email ?? E2E_EMAIL);
  await page.locator('input[type="password"]').fill(options.password ?? E2E_PASSWORD);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
}

export interface StubRequestEntry {
  method: string;
  path: string;
  query: Record<string, string>;
  authorized: boolean;
}

export interface StubLog {
  requests: StubRequestEntry[];
  unmatched: StubRequestEntry[];
  mode: Record<string, boolean>;
}

/** Reads the stub's request log. The spec asserts on traffic, not only on pixels. */
export async function readStubLog(page: Page): Promise<StubLog> {
  const response = await page.request.get(`${STUB_BASE_URL}/__stub/requests`);
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { data: StubLog };
  return payload.data;
}

/** Flips a stub mode switch (for example an unavailable ranking window). */
export async function setStubMode(page: Page, mode: Record<string, boolean>): Promise<void> {
  const response = await page.request.post(`${STUB_BASE_URL}/__stub/mode`, { data: mode });
  expect(response.ok()).toBeTruthy();
}

/** Clears the stub's request log and mode. Called before each spec so logs do not leak across tests. */
export async function resetStub(page: Page): Promise<void> {
  const response = await page.request.post(`${STUB_BASE_URL}/__stub/reset`, { data: {} });
  expect(response.ok()).toBeTruthy();
}

/**
 * The invariant every spec ends with: the applications only talked to routes the suite declared.
 *
 * A page that starts calling a new endpoint - or an endpoint the suite forgot - fails here, with
 * the path in the message, rather than rendering an empty state that a weaker assertion would
 * accept as success.
 */
export async function expectNoUnmatchedTraffic(page: Page): Promise<void> {
  const log = await readStubLog(page);
  expect(
    log.unmatched.map((entry) => `${entry.method} ${entry.path}`),
    'every request must hit a route declared in tests/e2e/browser/support/stub-api.mjs',
  ).toEqual([]);
}
