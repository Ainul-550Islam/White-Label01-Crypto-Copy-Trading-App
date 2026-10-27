/** Display machine policy grants without exposing raw keys or inventing values. */
const developerLabels: Record<string, string> = {
  developer_applications: 'Developer applications',
  developer_credentials_per_app: 'API keys per application',
  developer_redirect_uris: 'OAuth redirect URIs per application',
  developer_webhook_subscriptions: 'Webhook subscriptions',
  developer_webhook_endpoints_per_app: 'Webhook endpoints per application',
  developer_rate_burst_per_minute: 'Developer API burst per minute',
  developer_rate_sustained_per_minute: 'Developer API sustained rate per minute',
  developer_pkce_required: 'OAuth PKCE',
  developer_reactivation_review: 'Application reactivation review',
  developer_feature_portfolio_read: 'Developer profile and portfolio read',
  developer_feature_webhooks: 'Developer webhooks',
  developer_feature_reporting: 'Developer reporting',
  developer_feature_billing: 'Developer billing read',
};

export function displayPlanLimit(key: string, value: unknown): { label: string; value: string } | null {
  if (value === null || value === undefined) return null;
  const isDeveloper = key.startsWith('developer_');
  if (typeof value === 'boolean' && !isDeveloper) return null;
  if (typeof value !== 'boolean' && typeof value !== 'number' && typeof value !== 'string') return null;
  const label = developerLabels[key] ?? (isDeveloper
    ? key.replace(/^developer_/, 'Developer ').replace(/_/g, ' ')
    : key.replace(/([A-Z])/g, ' $1'));
  // Interactive OAuth enforces PKCE even for historical plans that stored 0.
  if (key === 'developer_pkce_required') return { label, value: 'Required' };
  if (key === 'developer_reactivation_review') {
    if (value === 1 || value === true) return { label, value: 'Required' };
    if (value === 0 || value === false) return { label, value: 'Not required' };
  }
  return { label, value: typeof value === 'boolean' ? (value ? 'Included' : 'Not included') : String(value) };
}
