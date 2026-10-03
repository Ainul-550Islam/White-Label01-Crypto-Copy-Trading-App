import { createHash } from 'crypto';
import { SignJWT, generateKeyPair } from 'jose';

import { FakeOidcIdp, TestableOidcProvider, oidcConfig } from './__fixtures__/oidc-test-idp.fixture-spec';
import { loadSamlTestKeys } from './__fixtures__/saml-test-keys.fixture-spec';
import { SamlProviderService, type SamlConfigRecord } from './saml-provider.service';
import { SsoAuthError, SsoReasonCode } from './sso-flow.types';

/**
 * Regression guards for the SSO verification defects fixed in round 5
 * (raw JSON ID tokens accepted, signatures only length-checked, SAML
 * "test format" and text-match signatures treated as verified), re-expressed
 * against the Part 11 implementation: ID tokens verified by `jose` against
 * the IdP JWKS, SAML verified by node-saml / xml-crypto. The detailed
 * matrices live in oidc-provider.service.spec.ts and
 * saml-provider.service.spec.ts.
 */

const NONCE = 'regression-nonce-0001';
const NONCE_HASH = createHash('sha256').update(NONCE, 'utf8').digest('hex');
const b64url = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');

async function reasonOf(promise: Promise<unknown>): Promise<SsoReasonCode> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(SsoAuthError);
    return (error as SsoAuthError).reason;
  }
  throw new Error('expected the token to be refused');
}

describe('OIDC ID token verification (regression guards)', () => {
  let idp: FakeOidcIdp;
  let oidc: TestableOidcProvider;

  beforeEach(async () => {
    idp = await FakeOidcIdp.create();
    oidc = new TestableOidcProvider(idp);
  });

  const verify = async (token: string, overrides = {}) => {
    const config = oidcConfig(idp, overrides);
    return oidc.verifyIdToken(config, await oidc.resolveEndpoints(config), token, { nonceHash: NONCE_HASH });
  };

  it('accepts an RS256 token signed by a key published in the JWKS (found through discovery)', async () => {
    await expect(verify(await idp.sign(idp.claims({ nonce: NONCE })))).resolves.toMatchObject({ subject: 'oidc-subject-alice', issuer: idp.issuer });
  });

  it('accepts ES256 when the IdP publishes an ES256 key and the configuration allows it, via a configured jwksUrl', async () => {
    await idp.addKey('ec1', 'ES256');
    idp.published.push('ec1');
    const token = await idp.sign(idp.claims({ nonce: NONCE }), 'ec1');
    await expect(verify(token, { jwksUrl: idp.jwksUri, allowedAlgorithms: ['ES256'] })).resolves.toMatchObject({ subject: 'oidc-subject-alice' });
  });

  it('rejects a raw JSON token (it used to be accepted as-is)', async () => {
    const raw = JSON.stringify(idp.claims({ nonce: NONCE }));
    expect(await reasonOf(verify(raw))).toBe(SsoReasonCode.ID_TOKEN_MALFORMED);
    expect(await reasonOf(verify(Buffer.from(raw).toString('base64')))).toBe(SsoReasonCode.ID_TOKEN_MALFORMED);
  });

  it('rejects a forged signature segment of the right length (only its length used to be checked)', async () => {
    const [h, p, s] = (await idp.sign(idp.claims({ nonce: NONCE }))).split('.');
    const forged = Buffer.alloc(Buffer.from(s, 'base64url').length, 7).toString('base64url');
    expect(await reasonOf(verify(`${h}.${p}.${forged}`))).toBe(SsoReasonCode.SIGNATURE_INVALID);
  });

  it('rejects a token whose payload was altered after signing', async () => {
    const [h, , s] = (await idp.sign(idp.claims({ nonce: NONCE }))).split('.');
    const altered = b64url(idp.claims({ nonce: NONCE, sub: 'oidc-subject-admin', email: 'ceo@acme.test' }));
    expect(await reasonOf(verify(`${h}.${altered}.${s}`))).toBe(SsoReasonCode.SIGNATURE_INVALID);
  });

  it('rejects a token signed by another key that claims a published kid', async () => {
    const { privateKey } = await generateKeyPair('RS256');
    const token = await new SignJWT(idp.claims({ nonce: NONCE })).setProtectedHeader({ alg: 'RS256', kid: 'k1', typ: 'JWT' }).sign(privateKey);
    expect(await reasonOf(verify(token))).toBe(SsoReasonCode.SIGNATURE_INVALID);
  });

  it('rejects alg none and HMAC algorithms, including HS256 keyed with the public key material', async () => {
    const none = `${b64url({ alg: 'none', typ: 'JWT', kid: 'k1' })}.${b64url(idp.claims({ nonce: NONCE }))}.`;
    expect([SsoReasonCode.ALGORITHM_REJECTED, SsoReasonCode.ID_TOKEN_MALFORMED]).toContain(await reasonOf(verify(none)));
    const publicN = Buffer.from(String(idp.keys.get('k1')!.publicJwk.n), 'base64url');
    const hs = await new SignJWT(idp.claims({ nonce: NONCE })).setProtectedHeader({ alg: 'HS256', kid: 'k1' }).sign(publicN);
    expect(await reasonOf(verify(hs))).toBe(SsoReasonCode.ALGORITHM_REJECTED);
    expect(await reasonOf(verify(await idp.sign(idp.claims({ nonce: NONCE })), { allowedAlgorithms: ['HS256'] }))).toBe(SsoReasonCode.CONFIG_INVALID);
  });

  it('refreshes the JWKS when the provider rotated its keys', async () => {
    await expect(verify(await idp.sign(idp.claims({ nonce: NONCE })))).resolves.toBeDefined();
    await idp.addKey('k3', 'RS256');
    idp.published = ['k3'];
    await expect(verify(await idp.sign(idp.claims({ nonce: NONCE }), 'k3'))).resolves.toBeDefined();
  });

  it('claim checks still apply to a correctly signed token', async () => {
    expect(await reasonOf(verify(await idp.sign(idp.claims({ nonce: NONCE, iss: 'https://evil.example' }))))).toBe(SsoReasonCode.ISSUER_MISMATCH);
    expect(await reasonOf(verify(await idp.sign(idp.claims({ nonce: NONCE, aud: 'someone-else' }))))).toBe(SsoReasonCode.AUDIENCE_MISMATCH);
    expect(await reasonOf(verify(await idp.sign(idp.claims({ nonce: 'other-nonce' }))))).toBe(SsoReasonCode.NONCE_MISMATCH);
    const past = Math.floor(Date.now() / 1000) - 3600;
    expect(await reasonOf(verify(await idp.sign(idp.claims({ nonce: NONCE, iat: past - 300, exp: past }))))).toBe(SsoReasonCode.TOKEN_EXPIRED);
  });

  it('a configuration without an issuer cannot verify anything', async () => {
    expect(() => oidc.assertConfigUsable(oidcConfig(idp, { issuer: null }))).toThrow(SsoAuthError);
  });
});

describe('SAML responses are refused without XML signature verification (regression guards)', () => {
  // Freshly generated for every jest run (test/sso-test-keys.global-setup.js); never committed.
  const IDP_CERT = loadSamlTestKeys().idpCert;
  const ISSUER = 'https://idp.acme.test/saml';
  const config: SamlConfigRecord = {
    id: '22222222-2222-4222-8222-222222222222',
    tenantId: '11111111-1111-4111-8111-111111111111',
    providerType: 'SAML',
    state: 'ENABLED',
    isActive: true,
    issuer: ISSUER,
    entityId: 'https://acme.app.test/saml/sp',
    audience: null,
    ssoUrl: 'https://idp.acme.test/sso',
    acsUrl: 'https://acme.app.test/v1/auth/sso/saml/acs',
    certificate: IDP_CERT,
    clockSkewSec: 60,
    wantResponseSigned: false,
  };
  const service = new SamlProviderService({ ssoAssertionReplay: { create: jest.fn(async () => ({})) } } as never);

  beforeEach(() => {
    process.env.SSO_SAML_ENABLED = 'true';
  });
  afterEach(() => {
    delete process.env.SSO_SAML_ENABLED;
  });

  it('the JSON "test format" is not an identity (it defaulted to signatureValid: true)', async () => {
    const forged = Buffer.from(JSON.stringify({ issuer: ISSUER, audience: 'wlct-sp', subject: 'x', email: 'ceo@example.com' })).toString('base64');
    expect([SsoReasonCode.SAML_MALFORMED, SsoReasonCode.SAML_SIGNATURE_INVALID]).toContain(
      await reasonOf(service.verifyResponse(config, { samlResponse: forged, expectedRequestId: '_req' })),
    );
  });

  it("an XML response containing the text '<ds:Signature' is not treated as signed", async () => {
    const xml = [
      '<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" ID="_r1" Version="2.0" IssueInstant="2026-10-01T00:00:00Z" InResponseTo="_req">',
      `<saml:Issuer>${ISSUER}</saml:Issuer>`,
      '<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>',
      '<saml:Assertion ID="_a1" Version="2.0" IssueInstant="2026-10-01T00:00:00Z">',
      `<saml:Issuer>${ISSUER}</saml:Issuer>`,
      '<ds:Signature>not a real signature</ds:Signature>',
      '<saml:Subject><saml:NameID>x</saml:NameID></saml:Subject>',
      '<saml:Conditions><saml:AudienceRestriction><saml:Audience>https://acme.app.test/saml/sp</saml:Audience></saml:AudienceRestriction></saml:Conditions>',
      '<saml:AttributeStatement><saml:Attribute Name="email"><saml:AttributeValue>ceo@example.com</saml:AttributeValue></saml:Attribute></saml:AttributeStatement>',
      '</saml:Assertion></samlp:Response>',
    ].join('');
    expect([SsoReasonCode.SAML_SIGNATURE_INVALID, SsoReasonCode.SAML_MALFORMED]).toContain(
      await reasonOf(service.verifyResponse(config, { samlResponse: Buffer.from(xml).toString('base64'), expectedRequestId: '_req' })),
    );
  });
});
