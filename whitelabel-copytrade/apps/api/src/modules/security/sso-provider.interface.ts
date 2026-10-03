import { SsoProvider } from './security.types';

/**
 * Provider-neutral SSO contract.
 *
 * The login flow itself (server-side transaction, state, nonce, PKCE, binding
 * to the starting client, session issuance) lives in
 * modules/auth/sso/sso-login.service.ts. Providers only build the IdP
 * request and cryptographically verify what the IdP returns:
 *
 *  - OIDC (OidcProviderService): authorization URL from trusted discovery
 *    metadata; server-side authorization-code redemption with the configured
 *    redirect URI and the PKCE verifier; ID-token verification against the
 *    IdP's JWKS with the `jose` library (signature, alg allow-list, iss, aud,
 *    azp, nonce, exp, iat, auth_time, clock skew).
 *  - SAML (SamlProviderService): AuthnRequest via @node-saml/node-saml;
 *    XML-DSig verification against the configured IdP certificate(s),
 *    issuer, audience, InResponseTo, time conditions, Recipient / Destination
 *    and assertion-ID replay. Disabled unless SSO_SAML_ENABLED=true and the
 *    configuration is complete.
 *
 * Raw tokens and assertions are never returned to clients, logged or stored.
 */

/** An identity whose authenticity has been cryptographically verified. */
export interface VerifiedSsoIdentity {
  providerType: SsoProvider;
  /** IdP issuer (OIDC `iss`, SAML Issuer); exact value from the verified token/assertion. */
  issuer: string;
  /** Stable subject at that issuer (OIDC `sub`, SAML NameID). The login key. */
  subject: string;
  /** Lower-cased email if the IdP asserted one. */
  email: string | null;
  /** True only when the IdP vouches for the email (OIDC email_verified; SAML: tenant IdP). */
  emailVerified: boolean;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  groups?: string[];
}

export interface SsoProviderMetadata {
  issuer: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  jwksUri?: string;
  endSessionEndpoint?: string;
  entityId?: string;
  ssoUrl?: string;
  acsUrl?: string;
  certificate?: string;
  supportedScopes?: string[];
}

export interface ISsoProvider {
  readonly providerType: SsoProvider;
  readonly providerName: string;

  /** False when the provider cannot be used at all (e.g. SAML not enabled for this deployment). */
  isAvailable(): boolean;

  getMetadata(tenantId: string): Promise<SsoProviderMetadata>;

  getLogoutUrl?(tenantId: string, redirectUri?: string): Promise<string>;
}

export interface SsoProviderConfig {
  tenantId: string;
  providerType: SsoProvider;
  issuer: string;
  audience: string;
  clientId?: string;
  metadataUrl?: string;
  entityId?: string;
  certificate?: string;
  allowedDomains: string[];
  enforced: boolean;
  jitEnabled: boolean;
  discoveryUrl?: string;
  jwksUrl?: string;
  redirectUri?: string;
  tokenEndpointAuthMethod?: 'client_secret_basic' | 'client_secret_post' | 'none';
  pkceRequired?: boolean;
  clockSkewSec?: number;
  maxAuthAgeSec?: number | null;
  allowedAlgorithms?: string[];
}
