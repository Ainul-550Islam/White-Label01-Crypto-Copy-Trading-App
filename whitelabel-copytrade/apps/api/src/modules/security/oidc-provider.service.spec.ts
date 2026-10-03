import { createHash } from 'crypto';
import { SignJWT } from 'jose';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SsoAuthError, SsoReasonCode } from './sso-flow.types';
import {
  FakeOidcIdp,
  TEST_CLIENT_ID,
  TEST_CLIENT_SECRET,
  TEST_REDIRECT_URI,
  TestableOidcProvider,
  oidcConfig,
} from './__fixtures__/oidc-test-idp.fixture-spec';
import { SsoCallbackDto, SsoStartDto } from '../auth/dto/sso-login.dto';

/**
 * Part 11 - OIDC relying party. ID tokens are signed with real keys and
 * verified by the production code (jose); only HTTP is redirected to an
 * in-process IdP.
 */

const sha256Hex = (v: string) => createHash('sha256').update(v, 'utf8').digest('hex');
const NONCE = 'nonce-value-for-this-transaction-0001';
const NONCE_HASH = sha256Hex(NONCE);

async function expectReason(promise: Promise<unknown>, reason: SsoReasonCode): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(SsoAuthError);
  expect((caught as SsoAuthError).reason).toBe(reason);
}

const b64url = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');

describe('OidcProviderService (Part 11, real JOSE verification)', () => {
  let idp: FakeOidcIdp;
  let oidc: TestableOidcProvider;

  beforeEach(async () => {
    idp = await FakeOidcIdp.create();
    oidc = new TestableOidcProvider(idp);
  });

  async function verify(
    token: string,
    configOverrides = {},
    nonceHash: string | null = NONCE_HASH,
  ) {
    const config = oidcConfig(idp, configOverrides);
    const endpoints = await oidc.resolveEndpoints(config);
    return oidc.verifyIdToken(config, endpoints, token, { nonceHash });
  }

  it('verifies a correctly signed ID token and returns the verified identity (baseline)', async () => {
    const identity = await verify(await idp.sign(idp.claims({ nonce: NONCE })));
    expect(identity).toMatchObject({
      issuer: idp.issuer,
      subject: 'oidc-subject-alice',
      email: 'alice@acme.test',
      emailVerified: true,
    });
  });

  it('[3] builds an authorization URL with state, nonce, S256 PKCE challenge and the CONFIGURED redirect URI', async () => {
    const config = oidcConfig(idp);
    const url = new URL(
      oidc.buildAuthorizationUrl(config, await oidc.resolveEndpoints(config), {
        state: 's1',
        nonce: 'n1',
        codeChallenge: 'c1',
      }),
    );
    expect(url.origin + url.pathname).toBe(idp.authorizationEndpoint);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: 'code',
      client_id: TEST_CLIENT_ID,
      redirect_uri: TEST_REDIRECT_URI,
      state: 's1',
      nonce: 'n1',
      code_challenge: 'c1',
      code_challenge_method: 'S256',
    });
    expect(() =>
      oidc.buildAuthorizationUrl(
        config,
        {
          issuer: idp.issuer,
          authorizationEndpoint: idp.authorizationEndpoint,
          tokenEndpoint: idp.tokenEndpoint,
          jwksUri: idp.jwksUri,
        },
        { state: 's', nonce: 'n' },
      ),
    ).toThrow(SsoAuthError);
  });

  it('[10] redeems the authorization code server-side at the discovered token endpoint with client auth and the PKCE verifier', async () => {
    const config = oidcConfig(idp);
    const endpoints = await oidc.resolveEndpoints(config);
    idp.nextIdToken = 'id-token-from-idp';
    const idToken = await oidc.redeemCode(config, endpoints, {
      code: 'auth-code-1',
      redirectUri: TEST_REDIRECT_URI,
      codeVerifier: 'verifier-1',
    });
    expect(idToken).toBe('id-token-from-idp');
    expect(idp.tokenRequests).toHaveLength(1);
    const request = idp.tokenRequests[0];
    expect(request.url).toBe(idp.tokenEndpoint);
    expect(Object.fromEntries(request.body)).toEqual({
      grant_type: 'authorization_code',
      code: 'auth-code-1',
      redirect_uri: TEST_REDIRECT_URI,
      code_verifier: 'verifier-1',
    });
    expect(request.headers.authorization).toBe(
      `Basic ${Buffer.from(`${TEST_CLIENT_ID}:${TEST_CLIENT_SECRET}`).toString('base64')}`,
    );
    // client_secret_post sends the secret in the body instead.
    const post = oidcConfig(idp, { tokenEndpointAuthMethod: 'client_secret_post' });
    await oidc.redeemCode(post, endpoints, {
      code: 'auth-code-2',
      redirectUri: TEST_REDIRECT_URI,
      codeVerifier: 'v',
    });
    expect(idp.tokenRequests[1].body.get('client_secret')).toBe(TEST_CLIENT_SECRET);
    expect(idp.tokenRequests[1].headers.authorization).toBeUndefined();
  });

  it('[11] the client cannot supply the redirect URI used for code redemption', async () => {
    const config = oidcConfig(idp);
    const endpoints = await oidc.resolveEndpoints(config);
    idp.nextIdToken = 'x';
    await expectReason(
      oidc.redeemCode(config, endpoints, {
        code: 'c',
        redirectUri: 'https://evil.example/cb',
        codeVerifier: 'v',
      }),
      SsoReasonCode.CONFIG_INVALID,
    );
    expect(idp.tokenRequests).toHaveLength(0);
    // The public DTOs have no redirect URI field; the global whitelist pipe rejects one.
    for (const [Dto, body] of [
      [
        SsoStartDto,
        {
          providerType: 'OIDC',
          deviceId: 'web-device-0001',
          redirectUri: 'https://evil.example/cb',
        },
      ],
      [
        SsoCallbackDto,
        {
          state: 'a'.repeat(43),
          code: 'c',
          bindingToken: 'b'.repeat(43),
          deviceId: 'web-device-0001',
          redirectUri: 'https://evil.example/cb',
        },
      ],
    ] as const) {
      const errors = await validate(plainToInstance(Dto as never, body) as object, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
      expect(errors.map((e) => e.property)).toContain('redirectUri');
    }
  });

  it('[12] an ID token with an invalid signature is rejected', async () => {
    const forger = await FakeOidcIdp.create(); // different private keys, same kid names
    const token = await forger.sign(idp.claims({ nonce: NONCE }), 'k1');
    await expectReason(verify(token), SsoReasonCode.SIGNATURE_INVALID);
    const genuine = await idp.sign(idp.claims({ nonce: NONCE }));
    const [h, , s] = genuine.split('.');
    const tampered = `${h}.${b64url(idp.claims({ nonce: NONCE, sub: 'oidc-subject-admin' }))}.${s}`;
    await expectReason(verify(tampered), SsoReasonCode.SIGNATURE_INVALID);
  });

  it('[13] an unsupported algorithm is rejected (HS256 with any secret; ES256 when only RS256 is configured)', async () => {
    const hs = await new SignJWT(idp.claims({ nonce: NONCE }))
      .setProtectedHeader({ alg: 'HS256', kid: 'k1' })
      .sign(new TextEncoder().encode(TEST_CLIENT_SECRET));
    await expectReason(verify(hs), SsoReasonCode.ALGORITHM_REJECTED);
    await idp.addKey('ec1', 'ES256');
    idp.published.push('ec1');
    const es = await idp.sign(idp.claims({ nonce: NONCE }), 'ec1');
    await expect(verify(es)).resolves.toBeDefined();
    await expectReason(
      verify(es, { allowedAlgorithms: ['RS256'] }),
      SsoReasonCode.ALGORITHM_REJECTED,
    );
    await expectReason(verify(es, { allowedAlgorithms: ['HS256'] }), SsoReasonCode.CONFIG_INVALID);
  });

  it('[14] alg "none" is rejected', async () => {
    const unsigned = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url(idp.claims({ nonce: NONCE }))}.`;
    await expectReason(verify(unsigned), SsoReasonCode.ALGORITHM_REJECTED);
    const noneWithKid = `${b64url({ alg: 'none', kid: 'k1' })}.${b64url(idp.claims({ nonce: NONCE }))}.`;
    await expectReason(verify(noneWithKid), SsoReasonCode.ALGORITHM_REJECTED);
  });

  it('[15] a wrong issuer is rejected (in the token, and in the discovery document)', async () => {
    await expectReason(
      verify(await idp.sign(idp.claims({ nonce: NONCE, iss: 'https://evil.example' }))),
      SsoReasonCode.ISSUER_MISMATCH,
    );
    // A fresh provider (no cached discovery) must refuse a document naming another issuer.
    idp.discoveryOverrides = { issuer: 'https://evil.example' };
    const fresh = new TestableOidcProvider(idp);
    await expectReason(
      fresh.resolveEndpoints(
        oidcConfig(idp, { issuer: idp.issuer, discoveryUrl: idp.discoveryUrl }),
      ),
      SsoReasonCode.ISSUER_MISMATCH,
    );
  });

  it('[16] a wrong audience is rejected', async () => {
    await expectReason(
      verify(await idp.sign(idp.claims({ nonce: NONCE, aud: 'another-client' }))),
      SsoReasonCode.AUDIENCE_MISMATCH,
    );
  });

  it('[17] a wrong or missing nonce is rejected', async () => {
    await expectReason(
      verify(await idp.sign(idp.claims({ nonce: 'nonce-of-another-transaction' }))),
      SsoReasonCode.NONCE_MISMATCH,
    );
    await expectReason(
      verify(await idp.sign(idp.claims({ nonce: undefined }))),
      SsoReasonCode.NONCE_MISMATCH,
    );
    await expectReason(
      verify(await idp.sign(idp.claims({ nonce: NONCE })), {}, null),
      SsoReasonCode.NONCE_MISMATCH,
    );
  });

  it('[18] an expired ID token is rejected', async () => {
    const now = Math.floor(Date.now() / 1000);
    await expectReason(
      verify(await idp.sign(idp.claims({ nonce: NONCE, iat: now - 900, exp: now - 600 }))),
      SsoReasonCode.TOKEN_EXPIRED,
    );
  });

  it('[19] clock skew is tolerated only up to the configured limit', async () => {
    const now = Math.floor(Date.now() / 1000);
    // exp 30s ago: inside the 60s skew -> accepted.
    await expect(
      verify(await idp.sign(idp.claims({ nonce: NONCE, iat: now - 200, exp: now - 30 }))),
    ).resolves.toBeDefined();
    // exp 120s ago: outside the 60s skew -> rejected.
    await expectReason(
      verify(await idp.sign(idp.claims({ nonce: NONCE, iat: now - 300, exp: now - 120 }))),
      SsoReasonCode.TOKEN_EXPIRED,
    );
    // iat far in the future -> rejected.
    await expectReason(
      verify(await idp.sign(idp.claims({ nonce: NONCE, iat: now + 600, exp: now + 900 }))),
      SsoReasonCode.TOKEN_TIME_INVALID,
    );
    // nbf beyond skew -> rejected.
    await expectReason(
      verify(await idp.sign(idp.claims({ nonce: NONCE, nbf: now + 600 }))),
      SsoReasonCode.TOKEN_TIME_INVALID,
    );
    // A configured skew above the 300s cap is clamped: exp 400s ago still fails.
    await expectReason(
      verify(await idp.sign(idp.claims({ nonce: NONCE, iat: now - 500, exp: now - 400 })), {
        clockSkewSec: 3600,
      }),
      SsoReasonCode.TOKEN_EXPIRED,
    );
  });

  it('[20] azp must be this client when present, and is required with several audiences', async () => {
    await expectReason(
      verify(await idp.sign(idp.claims({ nonce: NONCE, azp: 'another-client' }))),
      SsoReasonCode.AZP_MISMATCH,
    );
    await expectReason(
      verify(await idp.sign(idp.claims({ nonce: NONCE, aud: [TEST_CLIENT_ID, 'api://other'] }))),
      SsoReasonCode.AZP_MISMATCH,
    );
    await expect(
      verify(
        await idp.sign(
          idp.claims({ nonce: NONCE, aud: [TEST_CLIENT_ID, 'api://other'], azp: TEST_CLIENT_ID }),
        ),
      ),
    ).resolves.toBeDefined();
  });

  it('[21] the JWKS key is selected by kid', async () => {
    await expect(verify(await idp.sign(idp.claims({ nonce: NONCE }), 'k2'))).resolves.toBeDefined();
    // kid k2 header but signed with k1's private key -> the k2 key does not verify it.
    const k1Key = idp.keys.get('k1')!;
    const mislabeled = await new SignJWT(idp.claims({ nonce: NONCE }))
      .setProtectedHeader({ alg: 'RS256', kid: 'k2' })
      .sign(k1Key.privateKey);
    await expectReason(verify(mislabeled), SsoReasonCode.SIGNATURE_INVALID);
  });

  it('[22] an unknown kid fails safely, with at most one rate-limited JWKS refetch', async () => {
    await idp.addKey('k-unpublished', 'RS256');
    const token = await idp.sign(idp.claims({ nonce: NONCE }), 'k-unpublished');
    await expectReason(verify(token), SsoReasonCode.KEY_NOT_FOUND);
    const jwksFetches = () => idp.fetches.filter((u) => u === idp.jwksUri).length;
    expect(jwksFetches()).toBe(2); // initial + one forced refetch
    await expectReason(verify(token), SsoReasonCode.KEY_NOT_FOUND);
    expect(jwksFetches()).toBe(2); // cooldown: no refetch storm
  });

  it('[23] key rotation: a token signed with a newly published key verifies after one refetch; a retired key stops verifying', async () => {
    await expect(verify(await idp.sign(idp.claims({ nonce: NONCE }), 'k1'))).resolves.toBeDefined(); // caches {k1,k2}
    await idp.addKey('k3', 'RS256');
    idp.published = ['k2', 'k3']; // k1 retired, k3 introduced
    await expect(verify(await idp.sign(idp.claims({ nonce: NONCE }), 'k3'))).resolves.toBeDefined();
    await expectReason(
      verify(await idp.sign(idp.claims({ nonce: NONCE }), 'k1')),
      SsoReasonCode.KEY_NOT_FOUND,
    );
  });

  it('auth_time is enforced when max_age is configured', async () => {
    const now = Math.floor(Date.now() / 1000);
    await expectReason(
      verify(await idp.sign(idp.claims({ nonce: NONCE, auth_time: now - 7200 })), {
        maxAuthAgeSec: 600,
      }),
      SsoReasonCode.AUTH_TIME_TOO_OLD,
    );
    await expectReason(
      verify(await idp.sign(idp.claims({ nonce: NONCE })), { maxAuthAgeSec: 600 }),
      SsoReasonCode.CLAIMS_MISSING,
    );
    await expect(
      verify(await idp.sign(idp.claims({ nonce: NONCE, auth_time: now - 60 })), {
        maxAuthAgeSec: 600,
      }),
    ).resolves.toBeDefined();
  });

  it('[49] IdP outages and refusals become specific failures, never success', async () => {
    const config = oidcConfig(idp);
    const endpoints = await oidc.resolveEndpoints(config);
    idp.tokenStatus = 503;
    await expectReason(
      oidc.redeemCode(config, endpoints, {
        code: 'c',
        redirectUri: TEST_REDIRECT_URI,
        codeVerifier: 'v',
      }),
      SsoReasonCode.PROVIDER_UNAVAILABLE,
    );
    idp.tokenStatus = 400;
    await expectReason(
      oidc.redeemCode(config, endpoints, {
        code: 'c',
        redirectUri: TEST_REDIRECT_URI,
        codeVerifier: 'v',
      }),
      SsoReasonCode.TOKEN_EXCHANGE_FAILED,
    );
    idp.tokenErrorBody = {
      error: 'invalid_grant',
      error_description: 'PKCE code_verifier mismatch',
    };
    await expectReason(
      oidc.redeemCode(config, endpoints, {
        code: 'c',
        redirectUri: TEST_REDIRECT_URI,
        codeVerifier: 'v',
      }),
      SsoReasonCode.PKCE_FAILED,
    );
    idp.tokenStatus = 200;
    await expectReason(
      oidc.redeemCode(config, endpoints, {
        code: 'c',
        redirectUri: TEST_REDIRECT_URI,
        codeVerifier: null,
      }),
      SsoReasonCode.PKCE_FAILED,
    );
    idp.down = true;
    const fresh = new TestableOidcProvider(idp);
    await expectReason(fresh.resolveEndpoints(config), SsoReasonCode.PROVIDER_UNAVAILABLE);
    await expectReason(
      oidc.redeemCode(config, endpoints, {
        code: 'c',
        redirectUri: TEST_REDIRECT_URI,
        codeVerifier: 'v',
      }),
      SsoReasonCode.PROVIDER_UNAVAILABLE,
    );
    const tokenForNewKid = await idp.sign(idp.claims({ nonce: NONCE }), 'k2');
    await expectReason(
      fresh.verifyIdToken(config, endpoints, tokenForNewKid, { nonceHash: NONCE_HASH }),
      SsoReasonCode.PROVIDER_UNAVAILABLE,
    );
  });

  it('refuses unusable configurations (http issuer, missing secret, no openid scope, public client without PKCE)', () => {
    expect(() =>
      oidc.assertConfigUsable(oidcConfig(idp, { issuer: 'http://idp.acme.test' })),
    ).toThrow(SsoAuthError);
    expect(() =>
      oidc.assertConfigUsable(oidcConfig(idp, { clientSecretCiphertext: null })),
    ).toThrow(SsoAuthError);
    expect(() => oidc.assertConfigUsable(oidcConfig(idp, { scopes: ['email'] }))).toThrow(
      SsoAuthError,
    );
    expect(() => oidc.assertConfigUsable(oidcConfig(idp, { redirectUri: null }))).toThrow(
      SsoAuthError,
    );
    expect(() => oidc.assertConfigUsable(oidcConfig(idp, { state: 'DISABLED' }))).toThrow(
      SsoAuthError,
    );
    const publicClient = oidcConfig(idp, {
      tokenEndpointAuthMethod: 'none',
      clientSecretCiphertext: null,
      pkceRequired: false,
    });
    expect(() => oidc.assertConfigUsable(publicClient)).not.toThrow();
    expect(oidc.usesPkce(publicClient)).toBe(true);
  });
});
