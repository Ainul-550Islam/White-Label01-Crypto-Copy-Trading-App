import { createHash } from 'crypto';
import { SignJWT, exportJWK, generateKeyPair, type JWK, type KeyLike } from 'jose';

import {
  OidcProviderService,
  OidcTransportError,
  ssoClientSecretAad,
  type OidcConfigRecord,
} from '../oidc-provider.service';

/**
 * TEST-ONLY in-process OpenID Provider for the Part 11 specs.
 *
 * It serves a discovery document, a JWKS and a token endpoint through the
 * provider's overridable transport hooks (fetchJson / postForm), and mints
 * ID tokens signed with real RS256 / ES256 keys via `jose`. The provider's
 * verification code runs unmodified against it.
 *
 * (File name matches "*.fixture-spec.ts": excluded from the production build by
 * tsconfig.build.json's "**\/*spec.ts" and not collected by jest's
 * ".spec.ts$" regex.)
 */

export const TEST_TENANT = '11111111-1111-4111-8111-111111111111';
export const OTHER_TENANT = '99999999-9999-4999-8999-999999999999';
export const TEST_CLIENT_ID = 'wlct-client-123';
export const TEST_CLIENT_SECRET = 'client-secret-value-not-logged';
export const TEST_REDIRECT_URI = 'https://acme.app.test/api/auth/sso/callback';

interface TestKey {
  kid: string;
  alg: 'RS256' | 'ES256';
  privateKey: KeyLike;
  publicJwk: JWK;
}

export interface TokenRequest {
  url: string;
  body: URLSearchParams;
  headers: Record<string, string>;
}

export class FakeOidcIdp {
  readonly issuer = 'https://idp.acme.test';
  readonly authorizationEndpoint = 'https://idp.acme.test/authorize';
  readonly tokenEndpoint = 'https://idp.acme.test/token';
  readonly jwksUri = 'https://idp.acme.test/jwks';
  readonly discoveryUrl = 'https://idp.acme.test/.well-known/openid-configuration';

  readonly keys = new Map<string, TestKey>();
  /** kids currently published in the JWKS. */
  published: string[] = [];
  /** Overrides of the discovery document (e.g. a different issuer). */
  discoveryOverrides: Record<string, unknown> = {};
  /** When set, every request fails like an unreachable IdP. */
  down = false;
  /** HTTP status the token endpoint answers with (200 = success). */
  tokenStatus = 200;
  tokenErrorBody: Record<string, unknown> = { error: 'invalid_grant' };
  /** The ID token the token endpoint returns next (set by the test). */
  nextIdToken: string | null = null;
  /** codes the token endpoint accepts, mapped to the ID token they redeem for. */
  readonly codes = new Map<string, { idToken: string; verifier?: string; redirectUri: string }>();

  readonly fetches: string[] = [];
  readonly tokenRequests: TokenRequest[] = [];

  static async create(): Promise<FakeOidcIdp> {
    const idp = new FakeOidcIdp();
    await idp.addKey('k1', 'RS256');
    await idp.addKey('k2', 'RS256');
    idp.published = ['k1', 'k2'];
    return idp;
  }

  async addKey(kid: string, alg: 'RS256' | 'ES256'): Promise<TestKey> {
    const { privateKey, publicKey } = await generateKeyPair(alg);
    const publicJwk = { ...(await exportJWK(publicKey)), kid, alg, use: 'sig' };
    const key = { kid, alg, privateKey, publicJwk };
    this.keys.set(kid, key);
    return key;
  }

  claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const now = Math.floor(Date.now() / 1000);
    return {
      iss: this.issuer,
      aud: TEST_CLIENT_ID,
      sub: 'oidc-subject-alice',
      iat: now,
      exp: now + 300,
      email: 'alice@acme.test',
      email_verified: true,
      given_name: 'Alice',
      family_name: 'Example',
      ...overrides,
    };
  }

  /** Signs claims with a test key. Claims set to undefined are omitted. */
  async sign(
    claims: Record<string, unknown>,
    kid = 'k1',
    headerOverrides: Record<string, unknown> = {},
  ): Promise<string> {
    const key = this.keys.get(kid);
    if (!key) throw new Error(`unknown test kid ${kid}`);
    const clean = Object.fromEntries(Object.entries(claims).filter(([, v]) => v !== undefined));
    return new SignJWT(clean)
      .setProtectedHeader({ alg: key.alg, kid, typ: 'JWT', ...headerOverrides })
      .sign(key.privateKey);
  }

  /** Registers an authorization code (as the IdP would after the user authenticated). */
  issueCode(
    code: string,
    idToken: string,
    redirectUri = TEST_REDIRECT_URI,
    verifier?: string,
  ): void {
    this.codes.set(code, { idToken, verifier, redirectUri });
  }

  async get(url: string): Promise<any> {
    this.fetches.push(url);
    if (this.down) throw new OidcTransportError('GET failed: ConnectTimeoutError');
    if (url === this.discoveryUrl) {
      return {
        issuer: this.issuer,
        authorization_endpoint: this.authorizationEndpoint,
        token_endpoint: this.tokenEndpoint,
        jwks_uri: this.jwksUri,
        code_challenge_methods_supported: ['S256'],
        ...this.discoveryOverrides,
      };
    }
    if (url === this.jwksUri) {
      return { keys: this.published.map((kid) => this.keys.get(kid)!.publicJwk) };
    }
    throw new OidcTransportError('GET returned HTTP 404', 404);
  }

  async post(url: string, body: URLSearchParams, headers: Record<string, string>): Promise<any> {
    this.tokenRequests.push({ url, body, headers });
    if (this.down) throw new OidcTransportError('POST failed: ConnectTimeoutError');
    if (url !== this.tokenEndpoint) throw new OidcTransportError('POST returned HTTP 404', 404);
    if (this.tokenStatus >= 500)
      throw new OidcTransportError(
        `POST returned HTTP ${this.tokenStatus}`,
        this.tokenStatus,
        null,
      );
    if (this.tokenStatus !== 200)
      throw new OidcTransportError(
        `POST returned HTTP ${this.tokenStatus}`,
        this.tokenStatus,
        this.tokenErrorBody,
      );

    const code = body.get('code') ?? '';
    const registered = this.codes.get(code);
    if (registered) {
      // Behave like a real IdP: one-time codes, exact redirect_uri, PKCE S256 check.
      this.codes.delete(code);
      if (body.get('redirect_uri') !== registered.redirectUri) {
        throw new OidcTransportError('POST returned HTTP 400', 400, {
          error: 'invalid_grant',
          error_description: 'redirect_uri mismatch',
        });
      }
      if (registered.verifier !== undefined) {
        const challenge = createHash('sha256')
          .update(body.get('code_verifier') ?? '', 'ascii')
          .digest('base64url');
        if (challenge !== registered.verifier) {
          throw new OidcTransportError('POST returned HTTP 400', 400, {
            error: 'invalid_grant',
            error_description: 'code_verifier invalid',
          });
        }
      }
      return {
        token_type: 'Bearer',
        access_token: 'at-never-used',
        id_token: registered.idToken,
        expires_in: 300,
      };
    }
    if (this.nextIdToken) {
      return {
        token_type: 'Bearer',
        access_token: 'at-never-used',
        id_token: this.nextIdToken,
        expires_in: 300,
      };
    }
    throw new OidcTransportError('POST returned HTTP 400', 400, { error: 'invalid_grant' });
  }
}

/** Decrypts only the fake client-secret envelope, and only with the tenant-bound AAD. */
export function fakeCrypto() {
  return {
    decrypt: (payload: unknown, aad?: string) => {
      const p = payload as { fakeSecret?: string; aad?: string };
      if (!p || p.aad !== aad || aad !== ssoClientSecretAad(TEST_TENANT))
        throw new Error('decrypt failed');
      return String(p.fakeSecret);
    },
  };
}

export function oidcConfig(
  idp: FakeOidcIdp,
  overrides: Partial<OidcConfigRecord> = {},
): OidcConfigRecord {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    tenantId: TEST_TENANT,
    providerType: 'OIDC',
    state: 'ENABLED',
    isActive: true,
    issuer: idp.issuer,
    clientId: TEST_CLIENT_ID,
    audience: null,
    discoveryUrl: null,
    jwksUrl: null,
    ssoUrl: null,
    scopes: ['openid', 'email', 'profile'],
    clientSecretCiphertext: {
      fakeSecret: TEST_CLIENT_SECRET,
      aad: ssoClientSecretAad(TEST_TENANT),
    },
    tokenEndpointAuthMethod: 'client_secret_basic',
    redirectUri: TEST_REDIRECT_URI,
    pkceRequired: true,
    clockSkewSec: 60,
    maxAuthAgeSec: null,
    allowedAlgorithms: [],
    ...overrides,
  };
}

/** The production provider with only its HTTP transport pointed at the fake IdP. */
export class TestableOidcProvider extends OidcProviderService {
  constructor(
    private readonly idp: FakeOidcIdp,
    prisma: unknown = {},
    crypto: unknown = fakeCrypto(),
  ) {
    super(prisma as never, crypto as never);
  }

  protected override async fetchJson(url: string): Promise<any> {
    return this.idp.get(url);
  }

  protected override async postForm(
    url: string,
    body: URLSearchParams,
    headers: Record<string, string>,
  ): Promise<any> {
    return this.idp.post(url, body, headers);
  }
}
