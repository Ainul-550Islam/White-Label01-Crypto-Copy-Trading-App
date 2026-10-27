import { checkoutDestination, isAcknowledgedPlanChange } from '@/modules/billing/portal/plan-change-outcome';

const acknowledged = { action: 'CHANGE_PLAN', requiresCheckout: false, subscriptionId: 'subscription', status: 'ACTIVE', effectiveAt: '2026-10-27T00:00:00Z' };
test('a plan change is acknowledged only with a valid completed backend response', () => {
  expect(isAcknowledgedPlanChange(acknowledged)).toBe(true);
  expect(isAcknowledgedPlanChange({ ...acknowledged, requiresCheckout: true })).toBe(false);
  expect(isAcknowledgedPlanChange({ ...acknowledged, status: 'PENDING_CHECKOUT' })).toBe(false);
  expect(isAcknowledgedPlanChange({ ...acknowledged, subscriptionId: '' })).toBe(false);
  expect(isAcknowledgedPlanChange({ ...acknowledged, effectiveAt: 'not-a-date' })).toBe(false);
  expect(isAcknowledgedPlanChange(null)).toBe(false);
});

test('checkout redirects require the requested plan and a real HTTPS destination', () => {
  const response = { planId: 'plan', checkoutId: 'checkout', checkoutUrl: 'https://checkout.example.test/start' };
  expect(checkoutDestination(response, 'plan')).toBe('https://checkout.example.test/start');
  for (const invalid of [
    { ...response, planId: 'other' }, { ...response, checkoutId: '' },
    { ...response, checkoutUrl: 'http://checkout.example.test/' },
    { ...response, checkoutUrl: 'https://user:password@checkout.example.test/' },
    { ...response, checkoutUrl: 'javascript:alert(1)' },
  ]) expect(() => checkoutDestination(invalid, 'plan')).toThrow('Invalid checkout response');
});
