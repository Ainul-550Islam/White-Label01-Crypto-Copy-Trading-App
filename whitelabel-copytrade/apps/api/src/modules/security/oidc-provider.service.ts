import { Injectable, Logger } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import { createLocalJWKSet, decodeProtectedHeader, errors as joseErrors, jwtVerify, type JSONWebKeySet, type JWTPayload } from 'jose';
import type { SealedPayload } from '@wlct/utils';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CryptoService } from '../../infrastructure/crypto/crypto.service';
import { ISsoProvider, SsoProviderMetadata, VerifiedSsoIdentity } from './sso-provider.interface';
import { SsoProvider } from './security.types';
import {
  SSO_ASYMMETRIC_ALGORITHMS,
  SSO_MAX_ID_TOKEN_AGE_SECONDS,
  SsoAuthError,
  SsoReasonCode,
  effectiveClockSkew,
  isAllowedSsoUrl,
} from './sso-flow.types';

/** The subset of an SsoConfiguration row the OIDC provider reads. */
export interface OidcConfigRecord {
  id: string;
  tenantId: string;
  providerType: string;
  state: string;
  isActive: boolean;
  issuer: string | null;
  clientId: string | null;
  audience?: string | null;
  discoveryUrl?: string | null;
  jwksUrl?: string | null;
  ssoUrl?: string | null;
  scopes?: string[] | null;
  clientSecretCiphertext?: unknown;
  tokenEndpointAuthMethod?: string | null;
  redirectUri?: string | null;
  pkceRequired?: boolean | null;
  clockSkewSec?: number | null;
  maxAuthAgeSec?: number | null;
  allowedAlgorithms?: string[] | null;
}

/** Trusted endpoints for one issuer, from its discovery document. */
export interface OidcEndpoints {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  endSessionEndpoint?: string;
  codeChallengeMethods?: string[];
}

export type OidcClientAuthMethod = 'client_secret_basic' | 'client_secret_post' | 'none';
const CLIENT_AUTH_METHODS: readonly OidcClientAuthMethod[] = ['client_secret_basic', 'client_secret_post', 'none'];

/** AAD binding an OIDC client secret ciphertext to its tenant and provider. */
export function ssoClientSecretAad(tenantId: string): string {
  return `${tenantId}:sso:OIDC:client_secret`;
}

/** Thrown by fetchJson/postForm when the network or the server failed (not a protocol refusal). */
export class OidcTransportError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'OidcTransportError';
  }
}

const sha256Hex = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

/**
 * OpenID Connect relying party: authorization-code flow with PKCE.
 *
 * Everything that decides trust comes from server-side configuration (the
 * SsoConfiguration row): issuer, client id, client secret, redirect URI and
 * the discovery URL. Nothing a browser sends can change which IdP is asked,
 * where the code is redeemed or which keys verify the ID token. ID tokens are
 * verified with the `jose` library; no signature code is hand-written here.
 */
@Injectable()
export class OidcProviderService implements ISsoProvider {
  readonly providerType = SsoProvider.OIDC;
  readonly providerName = 'OIDC';
  private readonly logger = new Logger(OidcProviderService.name);

  private static readonly DISCOVERY_TTL_MS = 60 * 60 * 1000;
  private static readonly JWKS_TTL_MS = 10 * 60 * 1000;
  /** Minimum gap between forced JWKS refetches (unknown kid) per URL. */
  private static readonly JWKS_REFETCH_COOLDOWN_MS = 30 * 1000;
  private static readonly HTTP_TIMEOUT_MS = 8000;

  private readonly discoveryCache = new Map<string, { endpoints: OidcEndpoints; fetchedAt: number }>();
  private readonly jwksCache = new Map<string, { jwks: JSONWebKeySet; fetchedAt: number }>();
  private readonly lastForcedRefetch = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  isAvailable(): boolean {
    return true;
  }

  async getMetadata(tenantId: string): Promise<SsoProviderMetadata> {
    const config = await this.loadConfig(tenantId);
    if (!config) {
      throw new SsoAuthError(SsoReasonCode.PROVIDER_NOT_CONFIGURED, 'OIDC is not configured for this tenant');
    }
    const endpoints = await this.resolveEndpoints(config);
    return {
      issuer: endpoints.issuer,
      authorizationEndpoint: endpoints.authorizationEndpoint,
      tokenEndpoint: endpoints.tokenEndpoint,
      jwksUri: endpoints.jwksUri,
      endSessionEndpoint: endpoints.endSessionEndpoint,
    };
  }

  /**
   * OpenID Connect RP-Initiated Logout 1.0 URL. With `expectedConfigurationId`
   * the URL is only built when that configuration is still the tenant's
   * active OIDC configuration (a session issued by a replaced or disabled IdP
   * configuration is not sent to whatever IdP is configured now).
   */
  async getLogoutUrl(tenantId: string, redirectUri?: string, expectedConfigurationId?: string): Promise<string> {
    const config = await this.loadConfig(tenantId);
    if (!config || config.state === 'DISABLED') {
      throw new SsoAuthError(SsoReasonCode.PROVIDER_NOT_CONFIGURED, 'OIDC is not configured for this tenant');
    }
    if (expectedConfigurationId !== undefined && config.id !== expectedConfigurationId) {
      throw new SsoAuthError(SsoReasonCode.PROVIDER_NOT_CONFIGURED, 'The configuration that issued this session is no longer active');
    }
    const endpoints = await this.resolveEndpoints(config);
    if (!endpoints.endSessionEndpoint) {
      throw new SsoAuthError(SsoReasonCode.CONFIG_INVALID, 'The IdP does not publish an end_session_endpoint');
    }
    const url = new URL(endpoints.endSessionEndpoint);
    if (config.clientId) url.searchParams.set('client_id', config.clientId);
    if (redirectUri && redirectUri.startsWith('/') && !redirectUri.startsWith('//') && config.redirectUri) {
      url.searchParams.set('post_logout_redirect_uri', new URL(redirectUri, config.redirectUri).toString());
    }
    return url.toString();
  }

  /** Effective client authentication method of a configuration. */
  clientAuthMethod(config: OidcConfigRecord): OidcClientAuthMethod {
    const method = (config.tokenEndpointAuthMethod || 'client_secret_basic') as OidcClientAuthMethod;
    return CLIENT_AUTH_METHODS.includes(method) ? method : 'client_secret_basic';
  }

  /** PKCE is used unless the configuration explicitly turns it off for a confidential client. */
  usesPkce(config: OidcConfigRecord): boolean {
    return config.pkceRequired !== false || this.clientAuthMethod(config) === 'none';
  }

  /**
   * Refuses a configuration that cannot run a secure authorization-code flow.
   * Called before every start and every callback.
   */
  assertConfigUsable(config: OidcConfigRecord): void {
    if (config.providerType !== 'OIDC') {
      throw new SsoAuthError(SsoReasonCode.PROVIDER_MISMATCH, 'Configuration is not an OIDC provider');
    }
    if (!config.isActive || config.state === 'DISABLED') {
      throw new SsoAuthError(SsoReasonCode.PROVIDER_DISABLED, 'OIDC provider is disabled');
    }
    if (!config.issuer || !isAllowedSsoUrl(config.issuer)) {
      throw new SsoAuthError(SsoReasonCode.CONFIG_INVALID, 'OIDC issuer must be an https URL');
    }
    if (!config.clientId) {
      throw new SsoAuthError(SsoReasonCode.CONFIG_INVALID, 'OIDC client id is not configured');
    }
    if (!config.redirectUri || !isAllowedSsoUrl(config.redirectUri)) {
      throw new SsoAuthError(SsoReasonCode.CONFIG_INVALID, 'OIDC redirect URI must be a registered https URL');
    }
    const rawMethod = config.tokenEndpointAuthMethod || 'client_secret_basic';
    if (!CLIENT_AUTH_METHODS.includes(rawMethod as OidcClientAuthMethod)) {
      throw new SsoAuthError(SsoReasonCode.CONFIG_INVALID, 'Unsupported token endpoint auth method');
    }
    if (rawMethod !== 'none' && !config.clientSecretCiphertext) {
      throw new SsoAuthError(SsoReasonCode.CONFIG_INVALID, 'OIDC client secret is not configured');
    }
    for (const url of [config.discoveryUrl, config.jwksUrl, config.ssoUrl]) {
      if (url && !isAllowedSsoUrl(url)) {
        throw new SsoAuthError(SsoReasonCode.CONFIG_INVALID, 'OIDC endpoint overrides must be https URLs');
      }
    }
    const scopes = this.scopes(config);
    if (!scopes.includes('openid')) {
      throw new SsoAuthError(SsoReasonCode.CONFIG_INVALID, 'OIDC scopes must include openid');
    }
    this.algorithms(config);
  }

  /**
   * Endpoints from the issuer's discovery document (or the configured
   * discoveryUrl). The document's `issuer` must equal the configured issuer
   * exactly, and every endpoint must be https. Cached for an hour.
   */
  async resolveEndpoints(config: OidcConfigRecord): Promise<OidcEndpoints> {
    const issuer = String(config.issuer);
    const discoveryUrl = config.discoveryUrl || `${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`;
    const cacheKey = `${issuer}|${discoveryUrl}`;
    const cached = this.discoveryCache.get(cacheKey);
    let endpoints: OidcEndpoints;
    if (cached && Date.now() - cached.fetchedAt < OidcProviderService.DISCOVERY_TTL_MS) {
      endpoints = cached.endpoints;
    } else {
      let doc: any;
      try {
        doc = await this.fetchJson(discoveryUrl);
      } catch (error) {
        throw new SsoAuthError(SsoReasonCode.PROVIDER_UNAVAILABLE, `OIDC discovery failed: ${(error as Error).message}`);
      }
      if (!doc || typeof doc !== 'object') {
        throw new SsoAuthError(SsoReasonCode.CONFIG_INVALID, 'OIDC discovery document is not an object');
      }
      if (doc.issuer !== issuer) {
        throw new SsoAuthError(SsoReasonCode.ISSUER_MISMATCH, 'OIDC discovery issuer does not match the configured issuer');
      }
      for (const field of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) {
        if (typeof doc[field] !== 'string' || !isAllowedSsoUrl(doc[field])) {
          throw new SsoAuthError(SsoReasonCode.CONFIG_INVALID, `OIDC discovery ${field} is missing or not https`);
        }
      }
      if (doc.end_session_endpoint !== undefined && (typeof doc.end_session_endpoint !== 'string' || !isAllowedSsoUrl(doc.end_session_endpoint))) {
        throw new SsoAuthError(SsoReasonCode.CONFIG_INVALID, 'OIDC discovery end_session_endpoint is not https');
      }
      endpoints = {
        issuer: doc.issuer,
        authorizationEndpoint: doc.authorization_endpoint,
        tokenEndpoint: doc.token_endpoint,
        jwksUri: doc.jwks_uri,
        endSessionEndpoint: doc.end_session_endpoint,
        codeChallengeMethods: Array.isArray(doc.code_challenge_methods_supported)
          ? doc.code_challenge_methods_supported.filter((m: unknown) => typeof m === 'string')
          : undefined,
      };
      this.discoveryCache.set(cacheKey, { endpoints, fetchedAt: Date.now() });
    }
    // Administrator overrides (validated as https in assertConfigUsable).
    return {
      ...endpoints,
      authorizationEndpoint: config.ssoUrl || endpoints.authorizationEndpoint,
      jwksUri: config.jwksUrl || endpoints.jwksUri,
    };
  }

  /** The IdP authorization URL for one transaction. Every parameter comes from config or the transaction. */
  buildAuthorizationUrl(
    config: OidcConfigRecord,
    endpoints: OidcEndpoints,
    input: { state: string; nonce: string; codeChallenge?: string },
  ): string {
    if (this.usesPkce(config)) {
      if (!input.codeChallenge) {
        throw new SsoAuthError(SsoReasonCode.PKCE_FAILED, 'PKCE challenge missing for a PKCE configuration');
      }
      if (endpoints.codeChallengeMethods && !endpoints.codeChallengeMethods.includes('S256')) {
        throw new SsoAuthError(SsoReasonCode.CONFIG_INVALID, 'The IdP does not support PKCE S256');
      }
    }
    const url = new URL(endpoints.authorizationEndpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', String(config.clientId));
    url.searchParams.set('redirect_uri', String(config.redirectUri));
    url.searchParams.set('scope', this.scopes(config).join(' '));
    url.searchParams.set('state', input.state);
    url.searchParams.set('nonce', input.nonce);
    if (this.usesPkce(config) && input.codeChallenge) {
      url.searchParams.set('code_challenge', input.codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
    }
    if (typeof config.maxAuthAgeSec === 'number' && config.maxAuthAgeSec >= 0) {
      url.searchParams.set('max_age', String(Math.trunc(config.maxAuthAgeSec)));
    }
    return url.toString();
  }

  /**
   * Redeems an authorization code at the token endpoint and returns the raw
   * ID token. `redirectUri` is the value stored on the transaction at start
   * (copied from configuration), never a request value. Access and refresh
   * tokens in the response are discarded unread.
   */
  async redeemCode(
    config: OidcConfigRecord,
    endpoints: OidcEndpoints,
    input: { code: string; redirectUri: string; codeVerifier?: string | null },
  ): Promise<string> {
    if (!input.code) {
      throw new SsoAuthError(SsoReasonCode.CODE_MISSING, 'Authorization code missing');
    }
    if (input.redirectUri !== config.redirectUri) {
      // The configuration changed between start and callback; the IdP would
      // reject the mismatch anyway, so refuse before sending anything.
      throw new SsoAuthError(SsoReasonCode.CONFIG_INVALID, 'Redirect URI changed during the login');
    }
    if (this.usesPkce(config) && !input.codeVerifier) {
      throw new SsoAuthError(SsoReasonCode.PKCE_FAILED, 'PKCE verifier missing');
    }

    const body = new URLSearchParams();
    body.set('grant_type', 'authorization_code');
    body.set('code', input.code);
    body.set('redirect_uri', input.redirectUri);
    if (input.codeVerifier) body.set('code_verifier', input.codeVerifier);

    const headers: Record<string, string> = {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    };
    const method = this.clientAuthMethod(config);
    const clientId = String(config.clientId);
    if (method === 'none') {
      body.set('client_id', clientId);
    } else {
      const secret = this.clientSecret(config);
      if (method === 'client_secret_basic') {
        const user = encodeURIComponent(clientId);
        const pass = encodeURIComponent(secret);
        headers.authorization = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
      } else {
        body.set('client_id', clientId);
        body.set('client_secret', secret);
      }
    }

    let response: any;
    try {
      response = await this.postForm(endpoints.tokenEndpoint, body, headers);
    } catch (error) {
      if (error instanceof OidcTransportError && error.status !== undefined && error.status >= 400 && error.status < 500) {
        const err = error.body && typeof error.body === 'object' ? (error.body as Record<string, unknown>) : {};
        const description = `${String(err.error ?? '')} ${String(err.error_description ?? '')}`.toLowerCase();
        if (description.includes('code_verifier') || description.includes('pkce') || description.includes('code challenge')) {
          throw new SsoAuthError(SsoReasonCode.PKCE_FAILED, 'Token endpoint rejected the PKCE verifier');
        }
        throw new SsoAuthError(SsoReasonCode.TOKEN_EXCHANGE_FAILED, `Token endpoint refused the code (HTTP ${error.status})`);
      }
      throw new SsoAuthError(SsoReasonCode.PROVIDER_UNAVAILABLE, `Token endpoint unavailable: ${(error as Error).message}`);
    }

    if (!response || typeof response !== 'object') {
      throw new SsoAuthError(SsoReasonCode.TOKEN_EXCHANGE_FAILED, 'Token endpoint returned no JSON object');
    }
    if (response.token_type !== undefined && String(response.token_type).toLowerCase() !== 'bearer') {
      throw new SsoAuthError(SsoReasonCode.TOKEN_EXCHANGE_FAILED, 'Token endpoint returned an unexpected token_type');
    }
    if (typeof response.id_token !== 'string' || response.id_token.length === 0) {
      throw new SsoAuthError(SsoReasonCode.ID_TOKEN_MISSING, 'Token response has no id_token');
    }
    return response.id_token;
  }

  /**
   * Verifies an ID token: header algorithm on the asymmetric allow-list,
   * signature by a key from the IdP's JWKS (selected by kid, refetched once
   * on an unknown kid, rate-limited), then iss / aud / exp / iat (with the
   * configured clock skew), azp, nonce (against the transaction's hash) and
   * auth_time when max_age is configured.
   */
  async verifyIdToken(
    config: OidcConfigRecord,
    endpoints: OidcEndpoints,
    idToken: string,
    expected: { nonceHash: string | null },
  ): Promise<VerifiedSsoIdentity> {
    let header: { alg?: string; kid?: string };
    try {
      header = decodeProtectedHeader(idToken);
    } catch {
      throw new SsoAuthError(SsoReasonCode.ID_TOKEN_MALFORMED, 'ID token is not a compact JWS');
    }
    const algorithms = this.algorithms(config);
    if (!header.alg || !algorithms.includes(header.alg)) {
      throw new SsoAuthError(SsoReasonCode.ALGORITHM_REJECTED, `ID token algorithm ${String(header.alg)} is not allowed`);
    }

    const skew = effectiveClockSkew(config.clockSkewSec);
    const clientId = String(config.clientId);
    const verify = async (jwks: JSONWebKeySet): Promise<JWTPayload> => {
      const { payload } = await jwtVerify(idToken, createLocalJWKSet(jwks), {
        issuer: endpoints.issuer,
        audience: clientId,
        algorithms,
        clockTolerance: skew,
        maxTokenAge: SSO_MAX_ID_TOKEN_AGE_SECONDS,
        requiredClaims: ['iss', 'sub', 'aud', 'exp', 'iat'],
      });
      return payload;
    };

    let payload: JWTPayload;
    try {
      const jwks = await this.loadJwks(endpoints.jwksUri, false);
      try {
        payload = await verify(jwks);
      } catch (error) {
        if (error instanceof joseErrors.JWKSNoMatchingKey && this.mayForceRefetch(endpoints.jwksUri)) {
          // Key rotation: the IdP may have published a new key since we cached.
          payload = await verify(await this.loadJwks(endpoints.jwksUri, true));
        } else {
          throw error;
        }
      }
    } catch (error) {
      throw this.mapJoseError(error);
    }

    // azp: required when there are several audiences; must be our client when present.
    const aud = payload.aud;
    const azp = (payload as Record<string, unknown>).azp;
    if (Array.isArray(aud) && aud.length > 1 && azp === undefined) {
      throw new SsoAuthError(SsoReasonCode.AZP_MISMATCH, 'ID token with several audiences has no azp');
    }
    if (azp !== undefined && azp !== clientId) {
      throw new SsoAuthError(SsoReasonCode.AZP_MISMATCH, 'ID token azp is not this client');
    }

    // nonce: must equal the transaction's nonce (stored as a SHA-256 hash).
    const nonce = (payload as Record<string, unknown>).nonce;
    if (!expected.nonceHash || typeof nonce !== 'string' || nonce.length === 0) {
      throw new SsoAuthError(SsoReasonCode.NONCE_MISMATCH, 'ID token nonce missing');
    }
    const got = Buffer.from(sha256Hex(nonce), 'hex');
    const want = Buffer.from(expected.nonceHash, 'hex');
    if (got.length !== want.length || !timingSafeEqual(got, want)) {
      throw new SsoAuthError(SsoReasonCode.NONCE_MISMATCH, 'ID token nonce does not match this login');
    }

    // auth_time: enforced when max_age is configured.
    if (typeof config.maxAuthAgeSec === 'number' && config.maxAuthAgeSec >= 0) {
      const authTime = (payload as Record<string, unknown>).auth_time;
      const nowSec = Math.floor(Date.now() / 1000);
      if (typeof authTime !== 'number') {
        throw new SsoAuthError(SsoReasonCode.CLAIMS_MISSING, 'ID token has no auth_time although max_age was requested');
      }
      if (authTime > nowSec + skew) {
        throw new SsoAuthError(SsoReasonCode.TOKEN_TIME_INVALID, 'ID token auth_time is in the future');
      }
      if (nowSec - authTime > config.maxAuthAgeSec + skew) {
        throw new SsoAuthError(SsoReasonCode.AUTH_TIME_TOO_OLD, 'IdP authentication is older than max_age');
      }
    }

    if (typeof payload.sub !== 'string' || payload.sub.length === 0 || payload.sub.length > 512) {
      throw new SsoAuthError(SsoReasonCode.CLAIMS_MISSING, 'ID token subject is missing or too long');
    }

    const claims = payload as Record<string, unknown>;
    const email = typeof claims.email === 'string' && claims.email.includes('@') ? claims.email.trim().toLowerCase() : null;
    const emailVerified = claims.email_verified === true || claims.email_verified === 'true';
    const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v.slice(0, 200) : undefined);
    const groups = Array.isArray(claims.groups) ? claims.groups.filter((g): g is string => typeof g === 'string').slice(0, 100) : undefined;

    this.logger.log(`OIDC ID token verified tenant=${config.tenantId} kid=${header.kid ?? 'none'} alg=${header.alg}`);

    return {
      providerType: SsoProvider.OIDC,
      issuer: String(payload.iss),
      subject: payload.sub,
      email,
      emailVerified: email !== null && emailVerified,
      displayName: str(claims.name),
      firstName: str(claims.given_name),
      lastName: str(claims.family_name),
      groups,
    };
  }

  /** GET a JSON document (discovery / JWKS). Overridable in tests. */
  protected async fetchJson(url: string): Promise<any> {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(OidcProviderService.HTTP_TIMEOUT_MS),
      });
    } catch (error) {
      throw new OidcTransportError(`GET failed: ${(error as Error).name}`);
    }
    if (!res.ok) throw new OidcTransportError(`GET returned HTTP ${res.status}`, res.status);
    return res.json();
  }

  /** POST a form to the token endpoint. Overridable in tests. Never logs the body. */
  protected async postForm(url: string, body: URLSearchParams, headers: Record<string, string>): Promise<any> {
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers,
        body: body.toString(),
        redirect: 'error',
        signal: AbortSignal.timeout(OidcProviderService.HTTP_TIMEOUT_MS),
      });
    } catch (error) {
      throw new OidcTransportError(`POST failed: ${(error as Error).name}`);
    }
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
    if (!res.ok) throw new OidcTransportError(`POST returned HTTP ${res.status}`, res.status, parsed);
    return parsed;
  }

  private async loadConfig(tenantId: string): Promise<OidcConfigRecord | null> {
    return (await this.prisma.ssoConfiguration.findFirst({
      where: { tenantId, providerType: 'OIDC', isActive: true },
    })) as OidcConfigRecord | null;
  }

  private scopes(config: OidcConfigRecord): string[] {
    const configured = Array.isArray(config.scopes) && config.scopes.length > 0 ? config.scopes : ['openid', 'email', 'profile'];
    return [...new Set(configured.map((s) => s.trim()).filter(Boolean))];
  }

  /** Allowed algorithms: configured ones that are asymmetric, else the full asymmetric list. */
  private algorithms(config: OidcConfigRecord): string[] {
    const configured = Array.isArray(config.allowedAlgorithms) ? config.allowedAlgorithms : [];
    if (configured.length === 0) return [...SSO_ASYMMETRIC_ALGORITHMS];
    const rejected = configured.filter((alg) => !SSO_ASYMMETRIC_ALGORITHMS.includes(alg));
    if (rejected.length > 0) {
      throw new SsoAuthError(SsoReasonCode.CONFIG_INVALID, 'Only asymmetric ID-token algorithms may be configured');
    }
    return [...configured];
  }

  private clientSecret(config: OidcConfigRecord): string {
    if (!config.clientSecretCiphertext) {
      throw new SsoAuthError(SsoReasonCode.CONFIG_INVALID, 'OIDC client secret is not configured');
    }
    try {
      return this.crypto.decrypt(config.clientSecretCiphertext as SealedPayload, ssoClientSecretAad(config.tenantId));
    } catch {
      throw new SsoAuthError(SsoReasonCode.CONFIG_INVALID, 'OIDC client secret cannot be decrypted');
    }
  }

  private async loadJwks(url: string, forceRefresh: boolean): Promise<JSONWebKeySet> {
    const cached = this.jwksCache.get(url);
    if (!forceRefresh && cached && Date.now() - cached.fetchedAt < OidcProviderService.JWKS_TTL_MS) return cached.jwks;
    if (forceRefresh) this.lastForcedRefetch.set(url, Date.now());
    let body: any;
    try {
      body = await this.fetchJson(url);
    } catch (error) {
      throw new SsoAuthError(SsoReasonCode.PROVIDER_UNAVAILABLE, `JWKS unavailable: ${(error as Error).message}`);
    }
    if (!body || !Array.isArray(body.keys)) {
      throw new SsoAuthError(SsoReasonCode.CONFIG_INVALID, 'JWKS response has no keys array');
    }
    // Symmetric keys never verify ID tokens here.
    const keys = body.keys.filter((k: any) => k && typeof k === 'object' && k.kty !== 'oct');
    const jwks: JSONWebKeySet = { keys };
    this.jwksCache.set(url, { jwks, fetchedAt: Date.now() });
    return jwks;
  }

  private mayForceRefetch(url: string): boolean {
    const last = this.lastForcedRefetch.get(url);
    return last === undefined || Date.now() - last >= OidcProviderService.JWKS_REFETCH_COOLDOWN_MS;
  }

  private mapJoseError(error: unknown): SsoAuthError {
    if (error instanceof SsoAuthError) return error;
    if (error instanceof joseErrors.JWTExpired) {
      return error.claim === 'exp'
        ? new SsoAuthError(SsoReasonCode.TOKEN_EXPIRED, 'ID token expired')
        : new SsoAuthError(SsoReasonCode.TOKEN_TIME_INVALID, `ID token ${error.claim} check failed`);
    }
    if (error instanceof joseErrors.JWTClaimValidationFailed) {
      if (error.reason === 'missing') return new SsoAuthError(SsoReasonCode.CLAIMS_MISSING, `ID token claim ${error.claim} missing`);
      if (error.claim === 'iss') return new SsoAuthError(SsoReasonCode.ISSUER_MISMATCH, 'ID token issuer mismatch');
      if (error.claim === 'aud') return new SsoAuthError(SsoReasonCode.AUDIENCE_MISMATCH, 'ID token audience mismatch');
      if (error.claim === 'iat' || error.claim === 'nbf') return new SsoAuthError(SsoReasonCode.TOKEN_TIME_INVALID, `ID token ${error.claim} check failed`);
      return new SsoAuthError(SsoReasonCode.CLAIMS_MISSING, `ID token claim ${error.claim} invalid`);
    }
    if (error instanceof joseErrors.JWSSignatureVerificationFailed) {
      return new SsoAuthError(SsoReasonCode.SIGNATURE_INVALID, 'ID token signature verification failed');
    }
    if (error instanceof joseErrors.JOSEAlgNotAllowed || error instanceof joseErrors.JOSENotSupported) {
      return new SsoAuthError(SsoReasonCode.ALGORITHM_REJECTED, 'ID token algorithm rejected');
    }
    if (error instanceof joseErrors.JWKSNoMatchingKey) {
      return new SsoAuthError(SsoReasonCode.KEY_NOT_FOUND, 'No IdP key matches the ID token kid');
    }
    if (error instanceof joseErrors.JWKSMultipleMatchingKeys) {
      return new SsoAuthError(SsoReasonCode.SIGNATURE_INVALID, 'Several IdP keys match and none verified the token');
    }
    if (error instanceof joseErrors.JWSInvalid || error instanceof joseErrors.JWTInvalid || error instanceof joseErrors.JWKSInvalid) {
      return new SsoAuthError(SsoReasonCode.ID_TOKEN_MALFORMED, 'ID token is malformed');
    }
    return new SsoAuthError(SsoReasonCode.SIGNATURE_INVALID, `ID token verification failed: ${(error as Error)?.name ?? 'unknown'}`);
  }
}
