import { NormalizedSsoIdentity, SsoProvider } from './security.types';

/**
 * Provider-neutral SSO contract for SAML/OIDC discovery, authorization, assertion/token validation, logout, and normalized identity results.
 * Never expose raw tokens/assertions to clients.
 */

export interface SsoAuthorizationRequest {
  tenantId: string;
  providerType: SsoProvider;
  state: string;
  nonce?: string;
  redirectUri: string;
  scopes?: string[];
  ipHash?: string;
  requestId?: string;
}

export interface SsoAuthorizationResult {
  url: string;
  state: string;
  nonce?: string;
  provider: SsoProvider;
  expiresAt: string;
}

export interface SsoCallbackInput {
  tenantId: string;
  providerType: SsoProvider;
  state: string;
  code?: string;
  samlResponse?: string;
  idToken?: string;
  nonce?: string;
  ipHash?: string;
  requestId?: string;
}

export interface SsoProviderMetadata {
  issuer: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  jwksUri?: string;
  entityId?: string;
  ssoUrl?: string;
  acsUrl?: string;
  certificate?: string;
  supportedScopes?: string[];
}

export interface ISsoProvider {
  readonly providerType: SsoProvider;
  readonly providerName: string;

  isAvailable(): boolean;

  getMetadata(tenantId: string): Promise<SsoProviderMetadata>;

  createAuthorizationRequest(input: SsoAuthorizationRequest): Promise<SsoAuthorizationResult>;

  validateCallback(input: SsoCallbackInput): Promise<NormalizedSsoIdentity>;

  validateAssertion?(samlResponse: string, tenantId: string): Promise<NormalizedSsoIdentity>;

  validateToken?(idToken: string, tenantId: string, nonce?: string): Promise<NormalizedSsoIdentity>;

  getLogoutUrl?(tenantId: string, redirectUri?: string): Promise<string>;
}

export interface SsoProviderConfig {
  tenantId: string;
  providerType: SsoProvider;
  issuer: string;
  audience: string;
  clientId?: string;
  clientSecret?: string;
  metadataUrl?: string;
  entityId?: string;
  certificate?: string;
  allowedDomains: string[];
  enforced: boolean;
  jitEnabled: boolean;
  discoveryUrl?: string;
  jwksUrl?: string;
}
