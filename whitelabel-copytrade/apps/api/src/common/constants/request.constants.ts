/** Keys used to stash request-scoped state on the Express request object. */
export const REQUEST_ID_PROPERTY = 'requestId';
export const REQUEST_START_TIME_PROPERTY = 'startTime';
export const REQUEST_TENANT_PROPERTY = 'tenantContext';
export const REQUEST_ACTOR_PROPERTY = 'actor';
export const REQUEST_LOCALE_PROPERTY = 'locale';
export const REQUEST_IP_HASH_PROPERTY = 'ipHash';

export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
