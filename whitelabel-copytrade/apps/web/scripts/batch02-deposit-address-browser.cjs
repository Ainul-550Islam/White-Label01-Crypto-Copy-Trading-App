// Real Next UI with an intercepted network boundary. This does not test Fireblocks.
const { chromium } = require('@playwright/test');
const assert = require('node:assert/strict');
const base = process.env.WEB_BASE_URL || 'http://localhost:3104';
const tenant = '11111111-1111-4111-8111-111111111111';
const account = '22222222-2222-4222-8222-222222222222';
const funding = '77777777-7777-4777-8777-777777777777';
const address = '0x' + 'a'.repeat(40);
const transactionHash = '0x' + 'c'.repeat(64);
const asset = { assetId: 'ETH', networkId: 'ethereum', currency: 'ETH', networkName: 'Ethereum', tokenStandard: null, contractAddress: null };
const addressView = { fundingRequestId: funding, accountId: account, assetId: 'ETH', networkId: 'ethereum', currency: 'ETH', address,
  status: 'ADDRESS_VERIFIED', settlementStatus: 'NOT_CONFIRMED', monitoringStatus: 'NOT_CONNECTED', verifiedAt: '2026-10-27T00:00:00Z' };
const ok = (route, data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ success: status < 400, data }) });
const fail = (route, status, message) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code: 'UNAVAILABLE', message } }) });
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ locale: 'en' });
    await context.addCookies([{ name: 'wlct_at', value: 'test-session', url: base }, { name: 'wlct_csrf', value: 'test-csrf', url: base }]);
    await context.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }));
    const page = await context.newPage(); const errors = [], writes = [];
    page.on('pageerror', (e) => errors.push(e.message));
    let issued = 0, lookups = 0;
    await page.route('**/api/proxy/**', async (route) => {
      const req = route.request(), url = new URL(req.url()), path = url.pathname.replace('/api/proxy', '');
      const body = req.postData() ? req.postDataJSON() : undefined;
      if (req.method() !== 'GET') writes.push({ path, body, key: req.headers()['idempotency-key'] });
      if (path === '/v1/auth/me') return ok(route, { id: 'user', tenantId: tenant, email: 'user@example.test', status: 'ACTIVE', isPlatformUser: false,
        twoFactorEnabled: true, emailVerifiedAt: '2026-01-01T00:00:00Z', profile: null, roles: [], permissions: ['portfolio:read'] });
      if (path === '/v1/tenants/public-config') return ok(route, { tenantId: tenant, slug: 'test', name: 'Test organisation', status: 'ACTIVE', branding: null, features: {} });
      if (path === '/v1/client-lifecycle/accounts') return ok(route, { data: [{ id: account, displayName: 'Main', accountType: 'CASH', state: 'ACTIVE', isFundingEnabled: true }] });
      if (path === '/v1/client-lifecycle/funding' && req.method() === 'POST') return ok(route, { id: funding, accountId: account,
        requestedAmount: body.requestedAmount, currency: body.currency, state: 'REQUESTED' });
      if (path === `/v1/client-lifecycle/funding/${funding}/deposit-address/assets`) return ok(route, [asset]);
      if (path === `/v1/client-lifecycle/funding/${funding}/deposit-address` && req.method() === 'GET') return fail(route, 404, 'no address');
      if (path === `/v1/client-lifecycle/funding/${funding}/deposit-address/transactions/${transactionHash}` && req.method() === 'GET') {
        lookups++;
        assert.equal(url.searchParams.get('assetId'), 'ETH'); assert.equal(url.searchParams.get('networkId'), 'ethereum');
        return lookups === 1 ? fail(route, 404, 'PRIVATE NOT FOUND DETAIL') : ok(route, { status: 'OBSERVED', fundingRequestId: funding,
          assetId: 'ETH', currency: 'ETH', transactionHash, destinationAddress: address, amount: '1.000000000000000001',
          rawUnits: '1000000000000000001', confirmationCount: 40, logIndex: null, amountEvidence: 'PROVIDER_REPORTED',
          settlementStatus: 'NOT_CONFIRMED', monitoringStatus: 'LOOKUP_ONLY', complianceStatus: 'NOT_EVALUATED' });
      }
      if (path === '/v1/auth/step-up') return ok(route, { proofId: 'synthetic-proof', action: body.action, method: body.method,
        expiresAt: new Date(Date.now() + 60000).toISOString(), ttlSeconds: 60 });
      if (path === `/v1/client-lifecycle/funding/${funding}/deposit-address` && req.method() === 'POST') {
        issued++;
        return issued === 1 ? fail(route, 503, 'PRIVATE BACKEND DETAIL') : ok(route, addressView);
      }
      return fail(route, 404, 'not found');
    });
    await page.goto(`${base}/funding/deposit`);
    await page.getByLabel('Amount').fill('1.00000001');
    await page.getByLabel('Currency').fill('ETH');
    await page.getByLabel('Transfer reference (required)').fill('test-ref');
    await page.getByRole('button', { name: 'Request deposit' }).click();
    await page.getByRole('button', { name: 'Deposit address' }).click();
    await page.getByText('Automatic deposit monitoring and credit are not connected', { exact: false }).waitFor();
    await page.getByLabel('Asset and network').selectOption('ETH');
    await page.getByRole('button', { name: 'Verify identity and issue address' }).click();
    await page.getByLabel('Account password').fill('synthetic-password');
    await page.getByRole('button', { name: 'Verify and continue' }).click();
    await page.getByRole('alert').filter({ hasText: 'Verification or issuance could not be confirmed' }).waitFor();
    assert.equal(await page.getByText('PRIVATE BACKEND DETAIL').count(), 0);
    await page.getByLabel('Account password').fill('synthetic-password');
    await page.getByRole('button', { name: 'Verify and continue' }).click();
    await page.getByText(address).waitFor();
    await page.getByRole('button', { name: 'Copy address' }).click();
    await page.getByText('Could not copy. Select the address to copy it.').waitFor();
    const lookup = page.getByRole('button', { name: 'Look up transfer' });
    assert(await lookup.isDisabled());
    await page.getByLabel('Ethereum transaction hash').fill(transactionHash);
    await lookup.click();
    await page.getByText('No completed transfer observation is available', { exact: false }).waitFor();
    assert.equal(await page.getByText('PRIVATE NOT FOUND DETAIL').count(), 0);
    await lookup.click();
    await page.getByText('Transfer observed', { exact: true }).waitFor();
    assert(await page.getByText('1.000000000000000001 ETH', { exact: false }).count());
    assert(await page.getByText('Compliance, settlement and account credit are not confirmed', { exact: false }).count());
    assert(await page.getByText('receipt does not independently verify the native value', { exact: false }).count());
    const requests = writes.filter((entry) => entry.path.endsWith('/deposit-address'));
    assert.equal(requests.length, 2); assert(requests[0].key); assert.equal(requests[0].key, requests[1].key);
    assert.equal(writes.filter((entry) => entry.path === '/v1/auth/step-up' && entry.body.action === 'CUSTODY_ADDRESS_ISSUE').length, 2);
    const language = page.getByLabel('Language', { exact: true });
    await language.selectOption('ar');
    assert.equal(await page.locator('section[lang="ar"]').getAttribute('dir'), 'rtl');
    assert(await page.getByText('المراقبة التلقائية للإيداع والقيد غير متصلة بهذا العنوان.', { exact: false }).count());
    for (const code of ['bn', 'es', 'tr', 'en']) {
      await page.locator('section[lang] select').first().selectOption(code);
      assert.equal(await page.locator(`section[lang="${code}"]`).getAttribute('dir'), 'ltr');
    }
    assert.deepEqual(errors, []);
    console.log('PASS: real web interactions, action-bound verification, retry key, explicit no-credit warning, unavailable clipboard, five locales and RTL; network boundary intercepted.');
    await context.close();
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
