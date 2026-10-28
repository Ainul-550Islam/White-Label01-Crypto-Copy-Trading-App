// Real Next interactions with an intercepted HTTP boundary; this is not a live risk-engine test.
const { chromium } = require('@playwright/test');
const assert = require('node:assert/strict');
const base = process.env.WEB_BASE_URL || 'http://localhost:3104';
const tenant = '11111111-1111-4111-8111-111111111111';
const user = '22222222-2222-4222-8222-222222222222';
const version = '2026-10-07T10:00:00.000Z';
const ok = (route, data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ success: status < 400, data }) });
const fail = (route, status) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code: 'UNAVAILABLE', message: 'PRIVATE BACKEND DETAIL' } }) });
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ locale: 'en' });
    await context.addCookies([{ name: 'wlct_at', value: 'synthetic-session', url: base }, { name: 'wlct_csrf', value: 'synthetic-csrf', url: base }]);
    const page = await context.newPage(), errors = [], writes = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let puts = 0;
    let view = { tenantId: tenant, limits: { maxConcurrentPositions: 3, maxOpenOrders: 8 }, configured: true, updatedAt: version,
      usage: { ownedAccountCount: 2, openPositionSlots: 1, openOrderCount: 2 }, usageState: 'CURRENT',
      accountScope: 'USER_OWNED_NON_DELETED_ACCOUNTS_INCLUDING_PAPER_AND_LIVE', asOf: '2026-10-07T10:05:00.000Z' };
    await page.route('**/api/proxy/**', async (route) => {
      const req = route.request(), path = new URL(req.url()).pathname.replace('/api/proxy', '');
      const body = req.postData() ? req.postDataJSON() : undefined;
      if (req.method() !== 'GET') writes.push({ path, body, key: req.headers()['idempotency-key'] });
      if (path === '/v1/auth/me') return ok(route, { id: user, tenantId: tenant, email: 'user@example.test', status: 'ACTIVE', isPlatformUser: false,
        twoFactorEnabled: true, emailVerifiedAt: '2026-01-01T00:00:00Z', profile: null, roles: [], permissions: ['portfolio:read', 'execution:submit'] });
      if (path === '/v1/tenants/public-config') return ok(route, { tenantId: tenant, slug: 'test', name: 'Test organisation', status: 'ACTIVE', branding: null, features: {} });
      if (path === '/v1/risk-management/my-position-limits' && req.method() === 'GET') return ok(route, view);
      if (path === '/v1/auth/step-up') return ok(route, { proofId: 'synthetic-proof', action: body.action, method: body.method, expiresAt: new Date(Date.now() + 60000).toISOString(), ttlSeconds: 60 });
      if (path === '/v1/risk-management/my-position-limits' && req.method() === 'PUT') {
        puts++;
        if (puts === 1) return fail(route, 503);
        if (puts === 3) { view = { ...view, limits: { maxConcurrentPositions: 5, maxOpenOrders: 8 }, updatedAt: '2026-10-07T10:00:00.002Z' }; return fail(route, 409); }
        view = { ...view, limits: { maxConcurrentPositions: body.maxConcurrentPositions, maxOpenOrders: body.maxOpenOrders }, updatedAt: '2026-10-07T10:00:00.001Z' };
        return ok(route, view);
      }
      return fail(route, 404);
    });
    await page.goto(`${base}/risk/position-limits`);
    const positions = page.getByLabel('Maximum concurrent position slots'), orders = page.getByLabel('Maximum open orders');
    await positions.waitFor();
    assert.equal(await positions.inputValue(), '3'); assert.equal(await orders.inputValue(), '8');
    await positions.fill('4');
    await page.getByRole('button', { name: 'Save limits' }).click();
    const credential = page.getByLabel('Account password');
    await credential.waitFor(); assert.equal(await credential.evaluate((node) => document.activeElement === node), true);
    await credential.fill('synthetic-password'); await page.getByRole('button', { name: 'Verify and save' }).click();
    await page.getByRole('alert').filter({ hasText: 'The change could not be confirmed' }).waitFor();
    assert.equal(await page.getByText('PRIVATE BACKEND DETAIL').count(), 0);
    await credential.fill('synthetic-password'); await page.getByRole('button', { name: 'Verify and save' }).click();
    await page.getByText('Limits saved and audited.').waitFor();
    assert.equal(await positions.inputValue(), '4'); assert.equal(await orders.inputValue(), '8');
    const updates = writes.filter((entry) => entry.path === '/v1/risk-management/my-position-limits');
    assert.equal(updates.length, 2); assert(updates[0].key); assert.equal(updates[0].key, updates[1].key);
    assert.deepEqual(updates[0].body, { maxConcurrentPositions: 4, maxOpenOrders: 8, expectedUpdatedAt: version });
    assert.equal(writes.filter((entry) => entry.path === '/v1/auth/step-up' && entry.body.action === 'USER_POSITION_LIMIT_UPDATE').length, 2);
    await positions.fill('6'); await page.getByRole('button', { name: 'Save limits' }).click();
    await credential.fill('synthetic-password'); await page.getByRole('button', { name: 'Verify and save' }).click();
    await page.getByRole('alert').filter({ hasText: 'The change could not be confirmed' }).waitFor();
    await page.getByRole('button', { name: 'Refresh settings' }).click();
    await page.waitForFunction(() => document.querySelector('input[type=number]')?.value === '5');
    const positionSection = page.locator('section[lang]').first();
    const language = positionSection.getByLabel('Language', { exact: true });
    await language.selectOption('ar');
    assert.equal(await positionSection.getAttribute('dir'), 'rtl');
    for (const code of ['bn', 'es', 'tr', 'en']) {
      await positionSection.locator('select').first().selectOption(code);
      assert.equal(await positionSection.getAttribute('dir'), 'ltr');
    }
    assert.deepEqual(errors, []);
    console.log('PASS: real settings interactions, single-use step-up, preserved values, retry key, stale-version refresh and five locales; HTTP intercepted.');
    await context.close();
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
