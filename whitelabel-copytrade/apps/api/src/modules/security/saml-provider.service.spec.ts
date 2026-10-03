import { inflateRawSync } from 'zlib';
import { Prisma } from '@prisma/client';
import { loadSamlTestKeys } from './__fixtures__/saml-test-keys.fixture-spec';
import { SignedXml } from './__fixtures__/xml-signer.fixture-spec';

import { SamlProviderService, type SamlConfigRecord } from './saml-provider.service';
import { SsoAuthError, SsoReasonCode } from './sso-flow.types';

/**
 * Part 11 - SAML provider. Every response below is signed (or deliberately
 * not signed) with real RSA-SHA256 XML-DSig via xml-crypto and verified by
 * the production path (@node-saml/node-saml + our Recipient / Destination /
 * replay checks). Nothing in this file stubs the verifier.
 */

// Freshly generated for every jest run (test/sso-test-keys.global-setup.js); never committed.
const SAML_KEYS = loadSamlTestKeys();
const IDP_KEY = SAML_KEYS.idpKey;
const IDP_CERT = SAML_KEYS.idpCert;
const ATTACKER_KEY = SAML_KEYS.attackerKey;
const ATTACKER_CERT = SAML_KEYS.attackerCert;
const EXPIRED_CERT = SAML_KEYS.expiredCert;

const TENANT = '11111111-1111-4111-8111-111111111111';
const IDP_ISSUER = 'https://idp.acme.test/saml';
const SP_ENTITY = 'https://acme.app.test/saml/sp';
const ACS = 'https://acme.app.test/v1/auth/sso/saml/acs';
const REQUEST_ID = '_0123456789abcdef0123456789abcdef01234567';

function config(overrides: Partial<SamlConfigRecord> = {}): SamlConfigRecord {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    tenantId: TENANT,
    providerType: 'SAML',
    state: 'ENABLED',
    isActive: true,
    issuer: IDP_ISSUER,
    entityId: SP_ENTITY,
    audience: null,
    ssoUrl: 'https://idp.acme.test/sso',
    acsUrl: ACS,
    certificate: IDP_CERT,
    clockSkewSec: 60,
    wantResponseSigned: false,
    ...overrides,
  };
}

interface AssertionOptions {
  issuer?: string;
  audience?: string;
  recipient?: string;
  destination?: string | null;
  inResponseTo?: string;
  notBefore?: Date;
  notOnOrAfter?: Date;
  assertionId?: string;
  nameId?: string;
  email?: string;
}

const iso = (d: Date) => d.toISOString();

function assertionXml(o: AssertionOptions = {}): string {
  const now = Date.now();
  const notBefore = o.notBefore ?? new Date(now - 30_000);
  const notOnOrAfter = o.notOnOrAfter ?? new Date(now + 300_000);
  const issuer = o.issuer ?? IDP_ISSUER;
  return (
    `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${o.assertionId ?? '_assert' + Math.random().toString(16).slice(2)}" Version="2.0" IssueInstant="${iso(new Date(now))}">` +
    `<saml:Issuer>${issuer}</saml:Issuer>` +
    `<saml:Subject>` +
    `<saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified">${o.nameId ?? 'subject-alice'}</saml:NameID>` +
    `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">` +
    `<saml:SubjectConfirmationData InResponseTo="${o.inResponseTo ?? REQUEST_ID}" NotOnOrAfter="${iso(notOnOrAfter)}" Recipient="${o.recipient ?? ACS}"/>` +
    `</saml:SubjectConfirmation>` +
    `</saml:Subject>` +
    `<saml:Conditions NotBefore="${iso(notBefore)}" NotOnOrAfter="${iso(notOnOrAfter)}">` +
    `<saml:AudienceRestriction><saml:Audience>${o.audience ?? SP_ENTITY}</saml:Audience></saml:AudienceRestriction>` +
    `</saml:Conditions>` +
    `<saml:AuthnStatement AuthnInstant="${iso(new Date(now))}" SessionIndex="_session1">` +
    `<saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext>` +
    `</saml:AuthnStatement>` +
    `<saml:AttributeStatement>` +
    `<saml:Attribute Name="email"><saml:AttributeValue>${o.email ?? 'alice@acme.test'}</saml:AttributeValue></saml:Attribute>` +
    `</saml:AttributeStatement>` +
    `</saml:Assertion>`
  );
}

function signAssertion(xml: string, key: string, cert: string): string {
  const sig = new SignedXml({ privateKey: key, publicCert: cert });
  sig.addReference({
    xpath: "//*[local-name(.)='Assertion']",
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/2001/10/xml-exc-c14n#',
    ],
  });
  sig.canonicalizationAlgorithm = 'http://www.w3.org/2001/10/xml-exc-c14n#';
  sig.signatureAlgorithm = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
  sig.computeSignature(xml, {
    location: {
      reference: "//*[local-name(.)='Assertion']/*[local-name(.)='Issuer']",
      action: 'after',
    },
  });
  return sig.getSignedXml();
}

function responseXml(innerAssertions: string, o: AssertionOptions = {}): string {
  const destination = o.destination === null ? '' : ` Destination="${o.destination ?? ACS}"`;
  return (
    `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_resp${Math.random().toString(16).slice(2)}" Version="2.0" IssueInstant="${iso(new Date())}"${destination} InResponseTo="${o.inResponseTo ?? REQUEST_ID}">` +
    `<saml:Issuer>${o.issuer ?? IDP_ISSUER}</saml:Issuer>` +
    `<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>` +
    innerAssertions +
    `</samlp:Response>`
  );
}

/** Signs the <samlp:Response> element itself (enveloped signature after the Response's Issuer). */
function signResponseElement(xml: string, key: string, cert: string): string {
  const sig = new SignedXml({ privateKey: key, publicCert: cert });
  sig.addReference({
    xpath: "/*[local-name(.)='Response']",
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/2001/10/xml-exc-c14n#',
    ],
  });
  sig.canonicalizationAlgorithm = 'http://www.w3.org/2001/10/xml-exc-c14n#';
  sig.signatureAlgorithm = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
  sig.computeSignature(xml, {
    location: {
      reference: "/*[local-name(.)='Response']/*[local-name(.)='Issuer']",
      action: 'after',
    },
  });
  return sig.getSignedXml();
}

const b64 = (xml: string) => Buffer.from(xml, 'utf8').toString('base64');

function signedResponse(o: AssertionOptions = {}, key = IDP_KEY, cert = IDP_CERT): string {
  return b64(responseXml(signAssertion(assertionXml(o), key, cert), o));
}

function fakePrisma() {
  const replays = new Set<string>();
  return {
    replays,
    ssoAssertionReplay: {
      create: jest.fn(
        async ({ data }: { data: { tenantId: string; issuer: string; assertionId: string } }) => {
          const key = `${data.tenantId}|${data.issuer}|${data.assertionId}`;
          if (replays.has(key)) {
            throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
              code: 'P2002',
              clientVersion: 'test',
            });
          }
          replays.add(key);
          return data;
        },
      ),
    },
    ssoConfiguration: { findFirst: jest.fn(async () => null) },
  };
}

async function expectReason(promise: Promise<unknown>, reason: SsoReasonCode): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(SsoAuthError);
  await promise.catch((error: SsoAuthError) => expect(error.reason).toBe(reason));
}

describe('SamlProviderService (Part 11, real XML-DSig)', () => {
  const ORIGINAL = process.env.SSO_SAML_ENABLED;
  let prisma: ReturnType<typeof fakePrisma>;
  let saml: SamlProviderService;

  beforeEach(() => {
    process.env.SSO_SAML_ENABLED = 'true';
    prisma = fakePrisma();
    saml = new SamlProviderService(prisma as never);
  });

  afterAll(() => {
    if (ORIGINAL === undefined) delete process.env.SSO_SAML_ENABLED;
    else process.env.SSO_SAML_ENABLED = ORIGINAL;
  });

  it('accepts a correctly signed assertion and returns the verified identity (baseline)', async () => {
    const result = await saml.verifyResponse(config(), {
      samlResponse: signedResponse({ assertionId: '_ok1' }),
      expectedRequestId: REQUEST_ID,
    });
    expect(result.assertionId).toBe('_ok1');
    expect(result.identity).toMatchObject({
      issuer: IDP_ISSUER,
      subject: 'subject-alice',
      email: 'alice@acme.test',
      emailVerified: true,
    });
    expect(prisma.ssoAssertionReplay.create).toHaveBeenCalledTimes(1);
  });

  it('[32] SAML is disabled by default (no SSO_SAML_ENABLED) - even a valid response is refused', async () => {
    delete process.env.SSO_SAML_ENABLED;
    expect(saml.isEnabled()).toBe(false);
    expect(saml.isAvailable()).toBe(false);
    expect(() => saml.assertConfigUsable(config())).toThrow(SsoAuthError);
    await expectReason(
      saml.verifyResponse(config(), {
        samlResponse: signedResponse(),
        expectedRequestId: REQUEST_ID,
      }),
      SsoReasonCode.SAML_DISABLED,
    );
    process.env.SSO_SAML_ENABLED = 'TRUE';
    expect(saml.isEnabled()).toBe(false);
  });

  it('[33] an unsigned assertion is rejected', async () => {
    const xml = b64(responseXml(assertionXml()));
    await expectReason(
      saml.verifyResponse(config(), { samlResponse: xml, expectedRequestId: REQUEST_ID }),
      SsoReasonCode.SAML_SIGNATURE_INVALID,
    );
    expect(prisma.ssoAssertionReplay.create).not.toHaveBeenCalled();
  });

  it('[33] a Response signed only at the Response level (the assertion itself unsigned) is rejected: assertions must carry their own signature', async () => {
    const responseOnly = b64(
      signResponseElement(
        responseXml(assertionXml({ assertionId: '_response_only' })),
        IDP_KEY,
        IDP_CERT,
      ),
    );
    await expectReason(
      saml.verifyResponse(config(), { samlResponse: responseOnly, expectedRequestId: REQUEST_ID }),
      SsoReasonCode.SAML_SIGNATURE_INVALID,
    );
    await expectReason(
      saml.verifyResponse(config({ wantResponseSigned: true }), {
        samlResponse: responseOnly,
        expectedRequestId: REQUEST_ID,
      }),
      SsoReasonCode.SAML_SIGNATURE_INVALID,
    );
    expect(prisma.ssoAssertionReplay.create).not.toHaveBeenCalled();
  });

  it('[34] a fake <Signature> element (text only, no valid cryptography) is rejected', async () => {
    const fake =
      '<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:SignedInfo><ds:CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/>' +
      '<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/><ds:Reference URI="#_fake"><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>' +
      '<ds:DigestValue>AAAA</ds:DigestValue></ds:Reference></ds:SignedInfo><ds:SignatureValue>SIGNED-BY-IDP</ds:SignatureValue></ds:Signature>';
    const assertion = assertionXml({ assertionId: '_fake' }).replace(
      `<saml:Issuer>${IDP_ISSUER}</saml:Issuer>`,
      `<saml:Issuer>${IDP_ISSUER}</saml:Issuer>${fake}`,
    );
    await expectReason(
      saml.verifyResponse(config(), {
        samlResponse: b64(responseXml(assertion)),
        expectedRequestId: REQUEST_ID,
      }),
      SsoReasonCode.SAML_SIGNATURE_INVALID,
    );
  });

  it('[35] a cryptographically invalid signature (assertion altered after signing) is rejected', async () => {
    const signed = signAssertion(assertionXml({ nameId: 'subject-alice' }), IDP_KEY, IDP_CERT);
    const tampered = signed.replace('subject-alice', 'subject-mallory');
    expect(tampered).not.toBe(signed);
    await expectReason(
      saml.verifyResponse(config(), {
        samlResponse: b64(responseXml(tampered)),
        expectedRequestId: REQUEST_ID,
      }),
      SsoReasonCode.SAML_SIGNATURE_INVALID,
    );
  });

  it('[36] a wrong issuer is rejected even when correctly signed', async () => {
    await expectReason(
      saml.verifyResponse(config(), {
        samlResponse: signedResponse({ issuer: 'https://evil.example/saml' }),
        expectedRequestId: REQUEST_ID,
      }),
      SsoReasonCode.SAML_ISSUER_MISMATCH,
    );
  });

  it('[37] a wrong audience is rejected', async () => {
    await expectReason(
      saml.verifyResponse(config(), {
        samlResponse: signedResponse({ audience: 'https://other-sp.example' }),
        expectedRequestId: REQUEST_ID,
      }),
      SsoReasonCode.SAML_AUDIENCE_MISMATCH,
    );
  });

  it('[38] a wrong Recipient is rejected, and a wrong Destination is rejected', async () => {
    await expectReason(
      saml.verifyResponse(config(), {
        samlResponse: signedResponse({ recipient: 'https://evil.example/acs' }),
        expectedRequestId: REQUEST_ID,
      }),
      SsoReasonCode.SAML_RECIPIENT_MISMATCH,
    );
    await expectReason(
      saml.verifyResponse(config(), {
        samlResponse: signedResponse({ destination: 'https://evil.example/acs' }),
        expectedRequestId: REQUEST_ID,
      }),
      SsoReasonCode.SAML_DESTINATION_MISMATCH,
    );
    // An absent Destination is allowed (it is optional in the HTTP-POST binding); Recipient still binds the assertion.
    await expect(
      saml.verifyResponse(config(), {
        samlResponse: signedResponse({ destination: null }),
        expectedRequestId: REQUEST_ID,
      }),
    ).resolves.toBeDefined();
  });

  it('[39] an expired assertion is rejected; one not yet valid is rejected', async () => {
    const past = new Date(Date.now() - 3_600_000);
    await expectReason(
      saml.verifyResponse(config(), {
        samlResponse: signedResponse({
          notBefore: new Date(past.getTime() - 600_000),
          notOnOrAfter: past,
        }),
        expectedRequestId: REQUEST_ID,
      }),
      SsoReasonCode.SAML_EXPIRED,
    );
    const future = new Date(Date.now() + 3_600_000);
    await expectReason(
      saml.verifyResponse(config(), {
        samlResponse: signedResponse({
          notBefore: future,
          notOnOrAfter: new Date(future.getTime() + 600_000),
        }),
        expectedRequestId: REQUEST_ID,
      }),
      SsoReasonCode.SAML_EXPIRED,
    );
  });

  it('[40] a replayed assertion (same assertion ID) is rejected the second time', async () => {
    const response = signedResponse({ assertionId: '_replay1' });
    await expect(
      saml.verifyResponse(config(), { samlResponse: response, expectedRequestId: REQUEST_ID }),
    ).resolves.toBeDefined();
    await expectReason(
      saml.verifyResponse(config(), { samlResponse: response, expectedRequestId: REQUEST_ID }),
      SsoReasonCode.SAML_REPLAY,
    );
  });

  it('[41] signature wrapping: a forged assertion next to (or around) a genuinely signed one is rejected', async () => {
    const genuine = signAssertion(
      assertionXml({ assertionId: '_genuine', nameId: 'subject-alice' }),
      IDP_KEY,
      IDP_CERT,
    );
    const forged = assertionXml({
      assertionId: '_forged',
      nameId: 'subject-admin',
      email: 'admin@acme.test',
    });
    // Variant 1: forged assertion first, genuine signed one second.
    await expect(
      saml.verifyResponse(config(), {
        samlResponse: b64(responseXml(forged + genuine)),
        expectedRequestId: REQUEST_ID,
      }),
    ).rejects.toBeInstanceOf(SsoAuthError);
    // Variant 2: genuine assertion hidden inside an Extensions element, forged one as the visible assertion.
    const hidden = `<samlp:Extensions>${genuine}</samlp:Extensions>${forged}`;
    await expect(
      saml.verifyResponse(config(), {
        samlResponse: b64(responseXml(hidden)),
        expectedRequestId: REQUEST_ID,
      }),
    ).rejects.toBeInstanceOf(SsoAuthError);
    // Variant 3: the signed assertion's ID reused by the forged one (reference points at the wrong node).
    const sameId = assertionXml({ assertionId: '_genuine', nameId: 'subject-admin' });
    await expect(
      saml.verifyResponse(config(), {
        samlResponse: b64(responseXml(sameId + genuine)),
        expectedRequestId: REQUEST_ID,
      }),
    ).rejects.toBeInstanceOf(SsoAuthError);
    expect(prisma.ssoAssertionReplay.create).not.toHaveBeenCalled();
  });

  it('[42] an assertion signed by an unknown certificate is rejected (the request cannot supply a certificate)', async () => {
    await expectReason(
      saml.verifyResponse(config(), {
        samlResponse: signedResponse({}, ATTACKER_KEY, ATTACKER_CERT),
        expectedRequestId: REQUEST_ID,
      }),
      SsoReasonCode.SAML_SIGNATURE_INVALID,
    );
  });

  it('[43] missing or unusable verification configuration fails closed', async () => {
    const response = signedResponse();
    for (const broken of [
      config({ certificate: null }),
      config({ certificate: '' }),
      config({ certificate: 'not a certificate' }),
      config({ certificate: EXPIRED_CERT }),
      config({ issuer: null }),
      config({ acsUrl: null }),
      config({ entityId: null, audience: null }),
      config({ ssoUrl: 'http://idp.acme.test/sso' }),
    ]) {
      await expectReason(
        saml.verifyResponse(broken, { samlResponse: response, expectedRequestId: REQUEST_ID }),
        SsoReasonCode.CONFIG_INVALID,
      );
    }
    await expectReason(
      saml.verifyResponse(config({ isActive: false }), {
        samlResponse: response,
        expectedRequestId: REQUEST_ID,
      }),
      SsoReasonCode.PROVIDER_DISABLED,
    );
  });

  it('accepts a rotation set: either configured certificate verifies, an expired one is ignored', async () => {
    const rotation = `${EXPIRED_CERT}\n${ATTACKER_CERT}\n${IDP_CERT}`;
    expect(saml.signingCertificates(rotation)).toHaveLength(2);
    await expect(
      saml.verifyResponse(config({ certificate: rotation }), {
        samlResponse: signedResponse({ assertionId: '_rot1' }),
        expectedRequestId: REQUEST_ID,
      }),
    ).resolves.toBeDefined();
  });

  it('rejects an InResponseTo that is not this transaction (IdP-initiated or cross-login responses)', async () => {
    await expectReason(
      saml.verifyResponse(config(), {
        samlResponse: signedResponse({ inResponseTo: '_someotherrequest' }),
        expectedRequestId: REQUEST_ID,
      }),
      SsoReasonCode.SAML_IN_RESPONSE_TO_MISMATCH,
    );
  });

  it('rejects DTD / entity declarations before parsing (XXE)', async () => {
    const xxe = `<?xml version="1.0"?><!DOCTYPE r [<!ENTITY x SYSTEM "file:///etc/passwd">]>${responseXml(assertionXml())}`;
    await expectReason(
      saml.verifyResponse(config(), { samlResponse: b64(xxe), expectedRequestId: REQUEST_ID }),
      SsoReasonCode.SAML_MALFORMED,
    );
    await expectReason(
      saml.verifyResponse(config(), { samlResponse: '', expectedRequestId: REQUEST_ID }),
      SsoReasonCode.SAML_MALFORMED,
    );
  });

  it('builds a deflated AuthnRequest carrying the transaction request ID, ACS and RelayState', async () => {
    const url = new URL(
      await saml.buildAuthorizationUrl(config(), {
        relayState: 'relay-state-value-123',
        requestId: REQUEST_ID,
      }),
    );
    expect(url.origin + url.pathname).toBe('https://idp.acme.test/sso');
    expect(url.searchParams.get('RelayState')).toBe('relay-state-value-123');
    const request = inflateRawSync(
      Buffer.from(String(url.searchParams.get('SAMLRequest')), 'base64'),
    ).toString('utf8');
    expect(request).toContain(`ID="${REQUEST_ID}"`);
    expect(request).toContain(`AssertionConsumerServiceURL="${ACS}"`);
    expect(request).toContain(SP_ENTITY);
  });
});
