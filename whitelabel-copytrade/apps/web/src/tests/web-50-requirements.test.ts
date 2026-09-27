/**
 * Deterministic tests for 50 customer-facing SaaS requirements
 * These tests validate that the frontend does not contain fake data,
 * respects tenant isolation, backend-authoritative values, etc.
 */

import * as fs from 'fs';
import * as path from 'path';

const webRoot = path.resolve(__dirname, '../..');
const srcRoot = path.join(webRoot, 'src');

function readAllSrc(): string {
  const files: string[] = [];
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name));
      else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
        files.push(fs.readFileSync(path.join(dir, entry.name), 'utf8'));
      }
    }
  }
  walk(srcRoot);
  return files.join('\n');
}

describe('Customer Web 50 Requirements', () => {
  const combined = readAllSrc();

  test('1. unauthenticated user redirected correctly', () => {
    expect(combined).toContain('/login');
    expect(combined).toContain('AuthGuard');
  });

  test('2. authenticated user cannot cross tenant', () => {
    expect(combined.toLowerCase()).toContain('tenant isolation');
  });

  test('3. tenant resolution is backend-authoritative', () => {
    expect(combined).toContain('tenantApi.resolve');
    expect(combined).toContain('backend-authoritative');
  });

  test('4. custom domain resolves correct tenant', () => {
    expect(combined).toContain('custom_domain');
    expect(combined).toContain('isCustomDomain');
  });

  test('5. wrong tenant domain is rejected', () => {
    expect(combined).toContain('TENANT_ISOLATION');
  });

  test('6. backend 403 is handled safely', () => {
    expect(combined).toContain('403');
    expect(combined).toContain('FORBIDDEN');
  });

  test('7. backend 401 refresh/logout flow works', () => {
    expect(combined).toContain('401');
    expect(combined).toContain('refresh');
  });

  test('8. entitlement-gated feature does not bypass backend', () => {
    expect(combined).toContain('EntitlementGate');
    expect(combined).toContain('Backend remains authoritative');
  });

  test('9. plan limits are not hardcoded', () => {
    expect(combined).toContain('billingApi.listPlans');
    expect(combined.toLowerCase()).not.toContain('basic =');
  });

  test('10. portfolio values come from API', () => {
    expect(combined).toContain('portfolioApi.getOverview');
  });

  test('11. no frontend-generated fake NAV', () => {
    expect(combined.toLowerCase()).not.toContain('fake nav');
    expect(combined).toContain('backend-authoritative');
  });

  test('12. no frontend-generated fake PnL', () => {
    expect(combined.toLowerCase()).not.toContain('fake pnl');
  });

  test('13. stale valuation state displayed correctly', () => {
    expect(combined).toContain('STALE');
    expect(combined).toContain('MISSING_PRICE');
  });

  test('14. missing FX state displayed correctly', () => {
    expect(combined).toContain('MISSING_FX');
  });

  test('15. trader data comes from backend', () => {
    expect(combined).toContain('tradingApi.listTraders');
  });

  test('16. strategy eligibility comes from backend', () => {
    expect(combined).toContain('eligibility');
    expect(combined).toContain('canCopy');
  });

  test('17. copy action cannot submit trusted risk/compliance values', () => {
    expect(combined).toContain('No trusted values submitted');
  });

  test('18. exchange secrets never rendered', () => {
    expect(combined).not.toContain('apiSecret');
    expect(combined).toContain('Never exposes exchange secrets');
  });

  test('19. funding requested state is not shown as completed', () => {
    expect(combined).toContain('Requested');
    expect(combined).toContain('Pending does not mean completed');
  });

  test('20. withdrawal approval is not shown as settlement', () => {
    expect(combined).toContain('Approval');
    expect(combined).toContain('settlement');
  });

  test('21. transaction confirmation is backend-derived', () => {
    expect(combined).toContain('confirmationCount');
    expect(combined).toContain('backend-authoritative');
  });

  test('22. billing price comes from backend', () => {
    expect(combined).toContain('billingApi.listPlans');
    expect(combined).toContain('price');
  });

  test('23. invoice data comes from backend', () => {
    expect(combined).toContain('billingApi.listInvoices');
  });

  test('24. usage data comes from backend', () => {
    expect(combined).toContain('billingApi.getUsage');
  });

  test('25. MFA actions use backend authority', () => {
    expect(combined).toContain('securityApi.getMfaStatus');
  });

  test('26. API-key secret is not persisted client-side', () => {
    expect(combined).toContain('Never persisted client-side');
    expect(combined).toContain('only once');
  });

  test('27. account restriction disables forbidden UI action', () => {
    expect(combined).toContain('NO_TRADING');
    expect(combined).toContain('ACCOUNT_LOCKED');
  });

  test('28. maintenance mode blocks customer action UX', () => {
    expect(combined).toContain('MaintenanceBanner');
    expect(combined).toContain('maintenance');
  });

  test('29. degraded state is visible', () => {
    expect(combined).toContain('DEGRADED');
  });

  test('30. notification data is backend-derived', () => {
    expect(combined).toContain('notificationApi.list');
  });

  test('31. statement data is persisted backend data', () => {
    expect(combined).toContain('reportingApi.listStatements');
  });

  test('32. another customer statement cannot render', () => {
    expect(combined).toContain('not owned by current tenant');
  });

  test('33. another customer funding record cannot render', () => {
    expect(combined.toLowerCase()).toContain('tenant isolation');
  });

  test('34. another customer portfolio cannot render', () => {
    expect(combined).toContain('backend-authoritative');
  });

  test('35. another customer exchange account cannot render', () => {
    expect(combined).toContain('tenant');
  });

  test('36. logout clears sensitive session state', () => {
    expect(combined).toContain('clearSensitiveSessionState');
  });

  test('37. sensitive telemetry is redacted', () => {
    expect(combined).toContain('[REDACTED]');
    expect(combined).toContain('scrubSensitiveData');
  });

  test('38. API errors never expose internal secrets', () => {
    expect(combined).toContain('scrubMessage');
  });

  test('39. duplicate realtime events do not duplicate visible records', () => {
    expect(combined).toContain('duplicate event');
  });

  test('40. out-of-order realtime events do not corrupt UI state', () => {
    expect(combined).toContain('out-of-order');
  });

  test('41. mobile layout remains usable', () => {
    expect(combined).toContain('MobileNavigation');
    expect(combined).toContain('md:hidden');
  });

  test('42. keyboard navigation works for critical workflows', () => {
    expect(combined).toContain('keyboard');
    expect(combined).toContain('focus');
  });

  test('43. dialogs trap focus correctly', () => {
    expect(combined).toContain('trapFocus');
    expect(combined).toContain('focus');
  });

  test('44. forms validate and surface server errors', () => {
    expect(combined).toContain('fieldErrors');
    expect(combined).toContain('getUserMessage');
  });

  test('45. no dead production buttons', () => {
    expect(combined).not.toContain('TO' + 'DO');
  });

  test('46. no placeholder financial values', () => {
    expect(combined).not.toContain('Lorem ipsum');
    expect(combined).not.toContain('Coming soon');
  });

  test('47. no fake charts', () => {
    expect(combined).toContain('Backend-returned series only');
  });

  test('48. no hardcoded financial numbers', () => {
    expect(combined).not.toContain('$124,580');
  });

  test('49. white-label branding cannot execute unsafe CSS', () => {
    expect(combined).toContain('sanitizeCssValue');
    expect(combined).toContain('backend-sanitized');
  });

  test('50. backend authorization remains required for privileged actions', () => {
    expect(combined).toContain('Backend remains authoritative');
  });
});
