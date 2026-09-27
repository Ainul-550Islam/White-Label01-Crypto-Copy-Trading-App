/**
 * Public entrypoint of the developer-platform TypeScript SDK.
 * Exports the typed client, errors, pagination and webhook verification.
 */

export {
  DeveloperPlatformClient,
  DeveloperApiError,
  verifyWebhook,
} from './client';

export type {
  ApiVersion,
  SdkOptions,
  DeveloperAuth,
  DeveloperCredentials,
  DeveloperKeyCredentials,
  Paginated,
  DeveloperApplicationView,
  IssuedCredential,
  ApplicationLifecycleInput,
  WebhookSubscriptionInput,
  WebhookSubscriptionView,
  UsageRollup,
} from './client';

/** Application lifecycle states as enforced by the backend. */
export const APPLICATION_STATES = [
  'PENDING',
  'ACTIVE',
  'SUSPENDED',
  'REACTIVATION_REVIEW',
  'REVOKED',
] as const;

/** The 16 backend-authoritative scopes; the SDK never invents extra ones. */
export const DEVELOPER_SCOPES = [
  'profile:read',
  'account:read',
  'portfolio:read',
  'portfolio:write',
  'trading:read',
  'trading:execute',
  'copy:read',
  'copy:manage',
  'billing:read',
  'billing:manage',
  'funding:read',
  'funding:request',
  'statements:read',
  'reports:read',
  'webhooks:manage',
  'developer:manage',
] as const;

/** The 23 authoritative event types mirrored from the platform catalog. */
export const DEVELOPER_EVENT_TYPES = [
  'customer.created',
  'customer.updated',
  'subscription.created',
  'subscription.changed',
  'subscription.cancelled',
  'payment.succeeded',
  'payment.failed',
  'invoice.created',
  'invoice.paid',
  'funding.requested',
  'funding.confirmed',
  'withdrawal.requested',
  'withdrawal.confirmed',
  'copy.subscription.created',
  'copy.subscription.cancelled',
  'order.created',
  'order.acknowledged',
  'order.filled',
  'order.rejected',
  'portfolio.snapshot.created',
  'statement.generated',
  'compliance.review.required',
  'security.event',
] as const;
