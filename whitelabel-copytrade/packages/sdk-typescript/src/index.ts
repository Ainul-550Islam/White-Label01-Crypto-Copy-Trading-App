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

export { DEVELOPER_EVENT_TYPES } from './generated/event-types';
export type { DeveloperEventType } from './generated/event-types';
export type { components, operations, paths } from './generated/schema';
