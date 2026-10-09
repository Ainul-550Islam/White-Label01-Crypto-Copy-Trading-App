// # Responsibility: the real Playwright configuration for the browser E2E suite - three servers (a stub upstream, the customer web app, the admin console), two projects, and failure artefacts a reviewer can open.
//
// What was here before was not a Playwright configuration. It was a hand-written pair of TypeScript
// interfaces with a `config` object exported from a file nothing could load - no `defineConfig`, no
// `@playwright/test` dependency anywhere in the monorepo, no browsers, and nothing that ran the two
// files in `tests/e2e/` it claimed to belong to. The audit's finding (F9) was that "E2E" in this
// repository meant `renderToStaticMarkup` smoke tests; this file is what makes the claim true.
//
// The upstream API is a stub (tests/e2e/browser/support/stub-api.mjs), started here as the first
// webServer. Both applications reach it through their normal code path - `API_BASE_URL` - so the
// proxy route handler, the cookie session, the CSRF check and the server components are all really
// exercised. The stub answers 404 for any route the suite has not declared, and every spec asserts
// that no such request happened.
//
// `next dev` is used rather than a production build so the suite needs no build step and no
// environment beyond the three variables set below; the pages under test are the same components
// either way. A CI job that wants the production server can run `next build` first and set
// `E2E_WEB_COMMAND`/`E2E_ADMIN_COMMAND` to the `start` scripts.

import { defineConfig, devices } from '@playwright/test';

const STUB_PORT = Number(process.env.E2E_STUB_PORT ?? 4600);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3101);
const ADMIN_PORT = Number(process.env.E2E_ADMIN_PORT ?? 3102);

const STUB_URL = `http://127.0.0.1:${STUB_PORT}`;
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
const ADMIN_URL = `http://127.0.0.1:${ADMIN_PORT}`;

// Placeholders, not secrets: the stub issues a constant token and no real platform is reachable
// from this suite. `SESSION_COOKIE_SECRET` is the minimum length the apps' zod schema accepts.
const E2E_ENV = {
  API_BASE_URL: STUB_URL,
  SESSION_COOKIE_SECRET: 'e2e-session-cookie-secret-not-used-anywhere-real',
  NEXT_TELEMETRY_DISABLED: '1',
};

export default defineConfig({
  testDir: './tests/e2e/browser',
  timeout: 45_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list']],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'customer-web',
      use: { ...devices['Desktop Chrome'], baseURL: WEB_URL },
      testMatch: [/trader-discovery\.spec\.ts$/, /copy-trading-lifecycle\.spec\.ts$/],
    },
    {
      name: 'admin-console',
      use: { ...devices['Desktop Chrome'], baseURL: ADMIN_URL },
      testMatch: [/admin-operations\.spec\.ts$/],
    },
  ],
  webServer: [
    {
      command: `node tests/e2e/browser/support/stub-api.mjs --port ${STUB_PORT}`,
      url: `${STUB_URL}/__stub/requests`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: process.env.E2E_WEB_COMMAND ?? 'npm run dev:e2e --workspace @wlct/web',
      url: `${WEB_URL}/login`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: E2E_ENV,
    },
    {
      command: process.env.E2E_ADMIN_COMMAND ?? 'npm run dev:e2e --workspace @wlct/admin-web',
      url: `${ADMIN_URL}/login`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: E2E_ENV,
    },
  ],
});
