// # NEW — Playwright configuration for web and admin-web E2E suite
export interface PlaywrightProjectConfig {
  name: string;
  baseURL: string;
  testDir: string;
}

export interface PlaywrightConfig {
  testDir: string;
  timeout: number;
  fullyParallel: boolean;
  retries: number;
  use: {
    trace: 'on-first-retry' | 'off';
    screenshot: 'only-on-failure' | 'off';
  };
  projects: PlaywrightProjectConfig[];
}

const config: PlaywrightConfig = {
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'customer-web',
      baseURL: process.env.WEB_BASE_URL ?? 'http://localhost:3001',
      testDir: './tests/e2e',
    },
    {
      name: 'admin-web',
      baseURL: process.env.ADMIN_WEB_BASE_URL ?? 'http://localhost:3000',
      testDir: './tests/e2e',
    },
  ],
};

export default config;
