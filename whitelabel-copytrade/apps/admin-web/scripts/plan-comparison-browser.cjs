// Browser check with intercepted HTTP. Run against a separately started admin build.
const { chromium } = require('@playwright/test');
const assert = require('node:assert/strict');
const BASE = process.env.ADMIN_BASE_URL || 'http://127.0.0.1:3000';
const plan = '22222222-2222-4222-8222-222222222222';
const token = 'e30.' + Buffer.from(JSON.stringify({ sub: 'fixture', tid: '11111111-1111-4111-8111-111111111111', roles: [], perms: ['subscription:read', 'subscription:manage'], plat: false, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url') + '.test';

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext();
    await context.addCookies([{ name: 'wlct_at', value: token, url: BASE }, { name: 'wlct_csrf', value: 'csrf', url: BASE }]);
    const page = await context.newPage(), sent = [], errors = [];
    let mode = 'checkout'; page.on('pageerror', (error) => errors.push(error.message));
    const ok = (route, data) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
    await page.route('**/api/proxy/billing/portal/**', (route) => {
      const req = route.request(), path = new URL(req.url()).pathname;
      const data = req.postData() ? req.postDataJSON() : undefined;
      if (req.method() !== 'GET') sent.push({ path, data });
      if (path.endsWith('/plans/comparison')) return ok(route, { plans: [{ id: plan, name: 'Growth', price: '10', currency: 'USD', interval: 'MONTHLY', limits: { developer_pkce_required: 0 }, features: [], upgradeEligible: true, isCurrent: false }], featuresMatrix: [], limitsMatrix: [] });
      if (path.endsWith('/subscription/change-plan')) return ok(route, mode === 'checkout'
        ? { action: 'CHANGE_PLAN', requiresCheckout: true, status: 'PENDING_CHECKOUT' }
        : mode === 'malformed' ? { action: 'CHANGE_PLAN', requiresCheckout: false, subscriptionId: 'sub', status: 'PENDING_CHECKOUT', effectiveAt: '2026-01-01T00:00:00Z' }
        : { action: 'CHANGE_PLAN', requiresCheckout: false, subscriptionId: 'sub', status: 'ACTIVE', effectiveAt: '2026-01-01T00:00:00Z' });
      if (path.endsWith('/checkout')) return ok(route, { planId: plan, checkoutId: 'checkout', checkoutUrl: null });
      throw new Error(`Unexpected request: ${path}`);
    });
    await page.goto(`${BASE}/billing/plans`); await page.getByText('OAuth PKCE').waitFor();
    assert.equal(await page.getByText('Required', { exact: true }).count(), 1);
    const upgrade = page.getByRole('button', { name: 'Upgrade' });
    await upgrade.click(); await page.getByText('The plan change could not be confirmed.').waitFor();
    await upgrade.click(); await page.getByText('The plan change could not be confirmed.').waitFor();
    const checkouts = sent.filter((x) => x.path.endsWith('/checkout'));
    assert.equal(checkouts.length, 2); assert(checkouts[0].data.idempotencyKey); assert.equal(checkouts[0].data.idempotencyKey, checkouts[1].data.idempotencyKey);
    mode = 'malformed'; await upgrade.click(); await page.getByText('The plan change could not be confirmed.').waitFor();
    assert.equal(await page.getByText(/Plan change accepted/).count(), 0);
    mode = 'success'; await upgrade.click(); await page.getByText('Plan change accepted. Review the current plan below.').waitFor();
    assert.deepEqual(errors, []);
    console.log('PASS: enforced PKCE label, missing checkout URL, stable checkout retry key, malformed acknowledgement and valid plan change (intercepted HTTP).');
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
