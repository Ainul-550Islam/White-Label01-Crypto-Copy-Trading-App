/** Reflector metadata keys. Centralised to avoid typo-driven security holes. */
export const IS_PUBLIC_KEY = 'auth:isPublic';
export const PERMISSIONS_KEY = 'auth:permissions';
export const PERMISSIONS_MODE_KEY = 'auth:permissionsMode';
export const ROLES_KEY = 'auth:roles';
export const PLATFORM_ONLY_KEY = 'auth:platformOnly';
export const SKIP_TENANT_KEY = 'tenant:skipResolution';
export const FEATURE_FLAG_KEY = 'feature:flag';
export const AUDIT_ACTION_KEY = 'audit:action';
export const SKIP_RESPONSE_TRANSFORM_KEY = 'response:skipTransform';
export const REQUEST_TIMEOUT_KEY = 'request:timeoutMs';
export const IDEMPOTENT_KEY = 'request:idempotent';
export const REQUIRE_FRESH_AUTH_KEY = 'auth:requireFresh';
