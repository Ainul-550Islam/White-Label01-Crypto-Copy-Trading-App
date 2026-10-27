// Browser checks with an intercepted HTTP boundary. Run against a separately
// started web build: WEB_BASE_URL=http://127.0.0.1:3001 node scripts/batch02-browser.cjs
const { chromium } = require('@playwright/test');
const assert = require('node:assert/strict');
const BASE = process.env.WEB_BASE_URL || 'http://127.0.0.1:3001';
const tenant = '11111111-1111-4111-8111-111111111111';
const account = '22222222-2222-4222-8222-222222222222';
const grant = '33333333-3333-4333-8333-333333333333';
const active = '44444444-4444-4444-8444-444444444444';
const pending = '55555555-5555-4555-8555-555555555555';
const callback = 'https://client.example/callback';
const state = 'state-0123456789abcdef';
const authQuery = new URLSearchParams({ response_type: 'code', client_id: 'dev_' + 'a'.repeat(32), redirect_uri: callback,
  scope: 'profile:read', state, code_challenge: 'A'.repeat(43), code_challenge_method: 'S256' });
const respond = (route, data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ success: status < 400, data }) });

async function scenario(browser, permissions) {
  const context = await browser.newContext();
  await context.addCookies([{ name: 'wlct_at', value: 'test-session', url: BASE }, { name: 'wlct_csrf', value: 'test-csrf', url: BASE }]);
  const page = await context.newPage();
  const sent = [], pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  let consentMismatch = false, revoked = false, withdrawalAttempts = 0, depositAttempts = 0, preferenceAttempts = 0;
  let preferences = { locale: 'en', displayCurrency: 'USD', timezone: 'UTC', dateFormat: 'ISO' };
  await page.route('https://client.example/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Callback</h1>' }));
  await page.route('**/api/proxy/**', async (route) => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname.replace('/api/proxy', ''), method = req.method();
    const data = req.postData() ? req.postDataJSON() : undefined;
    if (method !== 'GET') sent.push({ path, method, data, key: req.headers()['idempotency-key'] });
    if (path === '/v1/auth/me') return respond(route, { id: 'user', tenantId: tenant, email: 'user@example.test', status: 'ACTIVE',
      isPlatformUser: false, twoFactorEnabled: true, emailVerifiedAt: '2026-01-01T00:00:00Z', profile: null, roles: [], permissions });
    if (path === '/v1/tenants/public-config') return respond(route, { tenantId: tenant, slug: 'test', name: 'Test organisation', status: 'ACTIVE', branding: null, features: {} });
    if (path === '/v1/users/me/preferences') {
      if (method === 'GET') return respond(route, preferences);
      if (method === 'PUT') {
        preferenceAttempts++;
        if (preferenceAttempts === 1) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, error: { message: 'private preference detail' } }) });
        preferences = data; return respond(route, preferences);
      }
    }
    if (path === '/v1/developer-platform/oauth/authorize') return respond(route, { grantId: grant, redirectTo: callback, clientName: 'Verified client', environment: 'SANDBOX', consentedScopes: ['profile:read'] });
    if (path === '/v1/developer-platform/oauth/consent') return respond(route, { grantId: consentMismatch ? 'other' : grant, state: data.decision }, 202);
    if (path === '/v1/developer-platform/oauth/code') return respond(route, { code: 'one-time-code', redirectTo: callback, state });
    if (path === '/v1/developer-platform/oauth/grants' && method === 'GET') return respond(route, { rows: revoked ? [] : [{ id: grant, clientName: 'Verified client', environment: 'SANDBOX', scopes: ['profile:read'], createdAt: '2026-01-01T00:00:00Z' }], nextCursor: null });
    if (path === `/v1/developer-platform/oauth/grants/${grant}/revoke`) { revoked = true; return route.fulfill({ status: 204 }); }
    if (path === '/v1/client-lifecycle/accounts') return respond(route, { data: [{ id: account, displayName: 'Main', accountType: 'CASH', state: 'ACTIVE', isFundingEnabled: true, isWithdrawalEnabled: true }] });
    if (path === '/v1/custody/destinations' && method === 'GET') return respond(route, { data: [
      { id: active, network: 'ETHEREUM', address: '0x1111111111111111111111111111111111111111', label: 'Approved', status: 'ACTIVE', activatesAt: '2026-01-01T00:00:00Z', revokedAt: null, createdAt: '2026-01-01T00:00:00Z', remainingCooldownMs: 0 },
      { id: pending, network: 'ETHEREUM', address: '0x2222222222222222222222222222222222222222', label: 'Waiting', status: 'PENDING', activatesAt: '2030-01-01T00:00:00Z', revokedAt: null, createdAt: '2026-01-01T00:00:00Z', remainingCooldownMs: 1000 },
    ], total: 2 });
    if (path === '/v1/auth/step-up') return respond(route, { proofId: 'proof', action: data.action, method: data.method, expiresAt: new Date(Date.now() + 60_000).toISOString(), ttlSeconds: 60 });
    if (path === '/v1/client-lifecycle/funding' && method === 'POST') {
      depositAttempts++;
      if (depositAttempts === 1) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, error: { message: 'private deposit detail' } }) });
      return respond(route, { id: '77777777-7777-4777-8777-777777777777', accountId: account,
        requestedAmount: depositAttempts === 2 ? '999' : data.requestedAmount, currency: data.currency, state: 'REQUESTED' });
    }
    if (path === '/v1/client-lifecycle/withdrawals' && method === 'POST') {
      withdrawalAttempts++;
      if (withdrawalAttempts === 1) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, error: { message: 'private backend detail' } }) });
      return respond(route, { id: '66666666-6666-4666-8666-666666666666', accountId: account, requestedAmount: data.requestedAmount, currency: data.currency, state: 'REQUESTED' });
    }
    return respond(route, {}, 404);
  });
  return { context, page, sent, pageErrors, setMismatch: (value) => { consentMismatch = value; } };
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const s = await scenario(browser, ['payout:manage']); const { page, sent } = s;
    await page.goto(`${BASE}/oauth/authorize?${authQuery}`);
    await page.getByText('Verified client').waitFor();
    assert(await page.getByText('This allows the application to read your basic account profile.').count());
    await page.getByRole('button', { name: 'Allow access' }).click();
    await page.waitForURL('https://client.example/callback**');
    const result = new URL(page.url()); assert.equal(result.searchParams.get('state'), state); assert.equal(result.searchParams.get('code'), 'one-time-code');
    for (const path of ['/oauth/authorize', '/oauth/consent', '/oauth/code']) assert(sent.some((x) => x.path.endsWith(path) && x.key));

    s.setMismatch(true);
    const before = sent.filter((x) => x.path.endsWith('/oauth/code')).length;
    await page.goto(`${BASE}/oauth/authorize?${authQuery}`); await page.getByText('Verified client').waitFor();
    await page.getByRole('button', { name: 'Allow access' }).click();
    await page.getByRole('alert').filter({ hasText: 'could not be completed' }).waitFor();
    assert.equal(sent.filter((x) => x.path.endsWith('/oauth/code')).length, before);
    s.setMismatch(false);

    await page.goto(`${BASE}/oauth/authorize?${authQuery}`); await page.getByText('Verified client').waitFor();
    await page.getByRole('button', { name: 'Deny access' }).click(); await page.waitForURL('https://client.example/callback**');
    assert.equal(new URL(page.url()).searchParams.get('error'), 'access_denied');
    assert.equal(new URL(page.url()).searchParams.get('state'), state);

    await page.goto(`${BASE}/settings/connected-apps`); await page.getByText('Verified client').waitFor();
    page.once('dialog', (dialog) => dialog.accept()); await page.getByRole('button', { name: 'Revoke access: Verified client' }).click();
    await page.getByText('Access revoked.').waitFor(); await page.getByText('No applications are connected.').waitFor();
    assert(sent.some((x) => x.path.endsWith(`/grants/${grant}/revoke`) && x.key));

    await page.goto(`${BASE}/settings/localization`);
    await page.getByLabel('Language', { exact: true }).selectOption('ar');
    assert.equal(await page.locator('section[aria-labelledby="localization-title"]').getAttribute('dir'), 'rtl');
    await page.locator('#timezone').fill('Asia/Dhaka');
    await page.getByRole('button', { name: 'حفظ التفضيلات' }).click();
    await page.getByRole('alert').filter({ hasText: 'تعذر حفظ التفضيلات' }).waitFor();
    assert.equal(await page.getByText('private preference detail').count(), 0);
    await page.getByRole('button', { name: 'حفظ التفضيلات' }).click();
    await page.getByRole('status').filter({ hasText: 'تم حفظ التفضيلات' }).waitFor();
    const preferenceWrites = sent.filter((x) => x.path === '/v1/users/me/preferences' && x.method === 'PUT');
    assert.equal(preferenceWrites.length, 2); assert(preferenceWrites[0].key);
    assert.equal(preferenceWrites[0].key, preferenceWrites[1].key);
    assert.deepEqual(preferenceWrites[1].data, { locale: 'ar', displayCurrency: 'USD', timezone: 'Asia/Dhaka', dateFormat: 'ISO' });
    await page.reload(); await page.getByRole('heading', { name: 'اللغة والعملة والوقت' }).waitFor();
    assert.equal(await page.locator('#timezone').inputValue(), 'Asia/Dhaka');
    await page.locator('#locale').selectOption('es');
    assert.equal(await page.locator('section[aria-labelledby="localization-title"]').getAttribute('dir'), 'ltr');
    assert(await page.getByText('Ejemplo de formato, no un saldo').count());

    await page.goto(`${BASE}/funding/deposit`);
    await page.getByLabel('Amount').fill('10.000001');
    const depositButton = page.getByRole('button', { name: 'Request deposit' });
    assert(await depositButton.isDisabled());
    await page.getByLabel('Transfer reference (required)').fill('bank-ref');
    await depositButton.click();
    await page.getByRole('alert').filter({ hasText: 'could not be confirmed' }).waitFor();
    assert.equal(await page.getByText('private deposit detail').count(), 0);
    const malformedReply = page.waitForResponse((response) => response.url().includes('/v1/client-lifecycle/funding') && response.request().method() === 'POST');
    await depositButton.click();
    await malformedReply;
    await page.getByRole('alert').filter({ hasText: 'could not be confirmed' }).waitFor();
    assert.equal(await page.getByRole('status').filter({ hasText: 'Reference' }).count(), 0);
    await depositButton.click();
    await page.getByRole('status').filter({ hasText: 'Reference' }).waitFor();
    const deposits = sent.filter((x) => x.path === '/v1/client-lifecycle/funding' && x.method === 'POST');
    assert.equal(deposits.length, 3); assert(deposits[0].key);
    assert(deposits.every((x) => x.key === deposits[0].key && x.data.requestedAmount === '10.000001' && x.data.externalReference === 'bank-ref'));

    await page.goto(`${BASE}/funding/withdraw`); await page.getByRole('option', { name: /Approved/ }).waitFor({ state: 'attached' });
    assert.equal(await page.locator('select').filter({ has: page.getByRole('option', { name: /Approved/ }) }).getByRole('option', { name: /Waiting/ }).count(), 0);
    await page.getByLabel('Amount').fill('10.000001'); await page.getByLabel('Approved withdrawal address').selectOption(active);
    const requestButton = page.getByRole('button', { name: 'Request withdrawal' });
    await requestButton.click();
    let dialog = page.getByRole('dialog'); await dialog.waitFor();
    assert.equal(await dialog.getByRole('tab', { name: 'Password' }).count(), 0);
    await dialog.getByLabel('6-digit code').fill('123456'); await dialog.getByRole('button', { name: 'Verify', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'could not be confirmed' }).waitFor();
    assert.equal(await page.getByText('private backend detail').count(), 0);
    await requestButton.click(); dialog = page.getByRole('dialog'); await dialog.getByLabel('6-digit code').fill('123456'); await dialog.getByRole('button', { name: 'Verify', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'is requested' }).waitFor();
    const withdrawals = sent.filter((x) => x.path === '/v1/client-lifecycle/withdrawals' && x.method === 'POST');
    assert.equal(withdrawals.length, 2); assert(withdrawals[0].key); assert.equal(withdrawals[0].key, withdrawals[1].key);
    assert.equal(withdrawals[1].data.requestedAmount, '10.000001');
    assert(sent.filter((x) => x.path === '/v1/auth/step-up').every((x) => x.data.action === 'PAYOUT_CREATE' && x.data.method === 'TOTP'));
    assert.deepEqual(s.pageErrors, []);
    await s.context.close();

    const denied = await scenario(browser, []); await denied.page.goto(`${BASE}/funding/withdraw`);
    await denied.page.getByText('Withdrawal requests require payout management permission.').waitFor();
    assert(await denied.page.getByRole('button', { name: 'Request withdrawal' }).isDisabled());
    await denied.context.close();
    console.log('PASS: OAuth consent/deny/revoke; five-locale preferences, RTL and retry; deposit and withdrawal validation, safe errors, exact decimals and stable retry keys; withdrawal permission, active destination and MFA (intercepted HTTP).');
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
