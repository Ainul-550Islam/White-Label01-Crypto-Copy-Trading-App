import { displayPlanLimit } from '@/modules/billing/portal/plan-limit-labels';

test('developer machine limits remain visible with meaningful labels and exact values', () => {
  expect(displayPlanLimit('developer_applications', 5)).toEqual({ label: 'Developer applications', value: '5' });
  expect(displayPlanLimit('developer_pkce_required', 1)).toEqual({ label: 'OAuth PKCE', value: 'Required' });
  expect(displayPlanLimit('developer_pkce_required', 0)).toEqual({ label: 'OAuth PKCE', value: 'Required' });
  expect(displayPlanLimit('developer_feature_webhooks', true)).toEqual({ label: 'Developer webhooks', value: 'Included' });
  expect(displayPlanLimit('developer_feature_reporting', false)).toEqual({ label: 'Developer reporting', value: 'Not included' });
  expect(displayPlanLimit('developer_future_limit', 7)).toEqual({ label: 'Developer future limit', value: '7' });
  expect(displayPlanLimit('customDomain', true)).toBeNull();
});
