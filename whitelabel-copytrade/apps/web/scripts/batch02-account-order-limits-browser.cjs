// Exercises real Next interactions with an intercepted HTTP boundary, not a live backend.
const { chromium } = require('@playwright/test');
const assert = require('node:assert/strict');
const base = process.env.WEB_BASE_URL || 'http://localhost:3104';
const tenant = '11111111-1111-4111-8111-111111111111', user = '22222222-2222-4222-8222-222222222222';
const accountId = '33333333-3333-4333-8333-333333333333', initialRevision = '44444444-4444-4444-8444-444444444444';
const savedRevision = '55555555-5555-4555-8555-555555555555', changedRevision = '66666666-6666-4666-8666-666666666666';
const account = { id: accountId, label: 'Customer paper', marketType: 'SPOT', tradingMode: 'PAPER', status: 'ACTIVE' };
const root = '/v1/risk-management/my-account-order-limits';
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
    let view = { tenantId: tenant, account, limits: { maxBaseQuantity: '2', maxOrderNotional: '10', notionalCurrency: 'USDT' },
      configured: true, revision: initialRevision, updatedAt: '2026-10-07T10:00:00.000Z', asOf: '2026-10-07T10:05:00.000Z' };
    await page.route('**/api/proxy/**', async (route) => {
      const req = route.request(), url = new URL(req.url()), path = url.pathname.replace('/api/proxy', '');
      const body = req.postData() ? req.postDataJSON() : undefined;
      if (req.method() !== 'GET') writes.push({ path, body, key: req.headers()['idempotency-key'] });
      if (path === '/v1/auth/me') return ok(route, { id: user, tenantId: tenant, email: 'user@example.test', status: 'ACTIVE', isPlatformUser: false,
        twoFactorEnabled: true, emailVerifiedAt: '2026-01-01T00:00:00Z', profile: null, roles: [], permissions: ['portfolio:read', 'execution:submit'] });
      if (path === '/v1/tenants/public-config') return ok(route, { tenantId: tenant, slug: 'test', name: 'Test organisation', status: 'ACTIVE', branding: null, features: {} });
      if (path === root && req.method() === 'GET') return ok(route, { data: [account], total: 1, page: Number(url.searchParams.get('page')), limit: Number(url.searchParams.get('limit')) });
      if (path === `${root}/${accountId}` && req.method() === 'GET') return ok(route, view);
      if (path === '/v1/auth/step-up') return ok(route, { proofId: 'synthetic-proof', action: body.action, method: body.method, expiresAt: new Date(Date.now() + 60000).toISOString(), ttlSeconds: 60 });
      if (path === `${root}/${accountId}` && req.method() === 'PUT') {
        puts++;
        if (puts === 1) return fail(route, 503);
        if (puts === 3) { view = { ...view, limits: { maxBaseQuantity: '4', maxOrderNotional: '10', notionalCurrency: 'USDT' }, revision: changedRevision }; return fail(route, 409); }
        view = { ...view, limits: { maxBaseQuantity: body.maxBaseQuantity, maxOrderNotional: body.maxOrderNotional, notionalCurrency: body.notionalCurrency }, revision: savedRevision };
        return ok(route, view);
      }
      return fail(route, 404);
    });
    await page.goto(`${base}/risk/position-limits`);
    const section = page.locator('section[lang]').filter({ has: page.getByRole('heading', { name: 'Per-account order-size limits' }) });
    const selector = section.getByLabel('Trading account'); await selector.waitFor(); await selector.selectOption(accountId);
    const quantity = section.getByLabel('Maximum base-asset quantity per order');
    const notional = section.getByLabel('Maximum quote notional per order');
    await quantity.waitFor(); assert.equal(await quantity.inputValue(), '2');
    await quantity.fill('0.000000000001'); await notional.fill('1.000000000001');
    await section.getByRole('button', { name: 'Save account limits' }).click();
    const credential = section.getByLabel('Account password'); await credential.waitFor();
    assert.equal(await credential.evaluate((node) => document.activeElement === node), true);
    await credential.fill('synthetic-password'); await section.getByRole('button', { name: 'Verify and save' }).click();
    await section.getByRole('alert').filter({ hasText: 'The change could not be confirmed' }).waitFor();
    assert.equal(await page.getByText('PRIVATE BACKEND DETAIL').count(), 0);
    await credential.fill('synthetic-password'); await section.getByRole('button', { name: 'Verify and save' }).click();
    await section.getByText('Account limits saved and audited.').waitFor();
    const updates = writes.filter((entry) => entry.path === `${root}/${accountId}`);
    assert.equal(updates.length, 2); assert(updates[0].key); assert.equal(updates[0].key, updates[1].key);
    assert.deepEqual(updates[0].body, { expectedRevision: initialRevision, maxBaseQuantity: '0.000000000001', maxOrderNotional: '1.000000000001', notionalCurrency: 'USDT' });
    assert.equal(writes.filter((entry) => entry.path === '/v1/auth/step-up' && entry.body.action === 'USER_ACCOUNT_ORDER_LIMIT_UPDATE').length, 2);
    await quantity.fill('3'); await section.getByRole('button', { name: 'Save account limits' }).click();
    await credential.fill('synthetic-password'); await section.getByRole('button', { name: 'Verify and save' }).click();
    await section.getByRole('alert').filter({ hasText: 'The change could not be confirmed' }).waitFor();
    await section.getByRole('button', { name: 'Refresh settings' }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('input')].some((input) => input.value === '4'));
    const language = section.getByLabel('Language', { exact: true });
    // Anchor by DOM order after translation changes the heading.
    const translated = page.locator('section[lang]').last();
    await language.selectOption('ar'); assert.equal(await translated.getAttribute('dir'), 'rtl');
    for (const code of ['bn', 'es', 'tr', 'en']) {
      await translated.locator('select').first().selectOption(code); assert.equal(await translated.getAttribute('dir'), 'ltr');
    }
    assert.deepEqual(errors, []);
    console.log('PASS: account selection, exact decimals, focused step-up, retry, stale refresh and five locales; HTTP intercepted.');
    await context.close();
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
