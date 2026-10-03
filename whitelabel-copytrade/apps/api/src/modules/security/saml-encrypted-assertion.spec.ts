import { generateKeyPairSync } from 'crypto';
import { Prisma } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';

import { loadSamlTestKeys } from './__fixtures__/saml-test-keys.fixture-spec';
import { SignedXml } from './__fixtures__/xml-signer.fixture-spec';
import { EnterpriseSsoService } from './enterprise-sso.service';
import { SamlProviderService, samlSpDecryptionKeyAad, type SamlConfigRecord } from './saml-provider.service';
import { SsoProvider } from './security.types';
import { SsoAuthError, SsoReasonCode } from './sso-flow.types';

// xml-encryption is the library node-saml decrypts with; the IdP side of these
// tests uses it to encrypt. Loaded without type declarations (it ships none).
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const xmlenc = require('xml-encryption') as {
  encrypt: (
    content: string,
    options: Record<string, unknown>,
    callback: (error: Error | null, result?: string) => void,
  ) => void;
};

/**
 * Round 7 D3: opt-in encrypted SAML assertions.
 *
 * The IdP side below is real: the assertion is signed with RSA-SHA256 XML-DSig
 * (xml-crypto) and then encrypted with XML Encryption (AES-256-GCM content key,
 * RSA-OAEP key transport) to the SP encryption certificate. The SP side is the
 * production path: SamlProviderService unseals the tenant's SP key, node-saml
 * decrypts, the signature INSIDE the decrypted assertion is verified, and our
 * Recipient / Destination / replay checks run on the decrypted, signed XML.
 * Every key is generated at test time (jest globalSetup or below); none is
 * committed.
 */

const KEYS = loadSamlTestKeys();
const TENANT = '11111111-1111-4111-8111-111111111111';
const IDP_ISSUER = 'https://idp.acme.test/saml';
const SP_ENTITY = 'https://acme.app.test/saml/sp';
const ACS = 'https://acme.app.test/v1/auth/sso/saml/acs';
const REQUEST_ID = '_0123456789abcdef0123456789abcdef01234567';

/** A stand-in for CryptoService that enforces the AAD binding like the real envelope. */
const fakeCrypto = {
  encrypt: (plaintext: string, aad?: string) => ({ sealed: plaintext, aad }),
  decrypt: (payload: { sealed: string; aad?: string }, aad?: string) => {
    if (payload.aad !== aad) throw new Error('AAD mismatch');
    return payload.sealed;
  },
};

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
    certificate: KEYS.idpCert,
    clockSkewSec: 60,
    wantResponseSigned: false,
    wantAssertionsEncrypted: true,
    spDecryptionKeyCiphertext: fakeCrypto.encrypt(KEYS.spEncKey, samlSpDecryptionKeyAad(TENANT)),
    spEncryptionCertificate: KEYS.spEncCert,
    ...overrides,
  };
}

const iso = (d: Date) => d.toISOString();

function assertionXml(assertionId: string): string {
  const now = Date.now();
  return (
    `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${assertionId}" Version="2.0" IssueInstant="${iso(new Date(now))}">` +
    `<saml:Issuer>${IDP_ISSUER}</saml:Issuer>` +
    `<saml:Subject>` +
    `<saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified">subject-alice</saml:NameID>` +
    `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">` +
    `<saml:SubjectConfirmationData InResponseTo="${REQUEST_ID}" NotOnOrAfter="${iso(new Date(now + 300_000))}" Recipient="${ACS}"/>` +
    `</saml:SubjectConfirmation>` +
    `</saml:Subject>` +
    `<saml:Conditions NotBefore="${iso(new Date(now - 30_000))}" NotOnOrAfter="${iso(new Date(now + 300_000))}">` +
    `<saml:AudienceRestriction><saml:Audience>${SP_ENTITY}</saml:Audience></saml:AudienceRestriction>` +
    `</saml:Conditions>` +
    `<saml:AuthnStatement AuthnInstant="${iso(new Date(now))}" SessionIndex="_session1">` +
    `<saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext>` +
    `</saml:AuthnStatement>` +
    `<saml:AttributeStatement>` +
    `<saml:Attribute Name="email"><saml:AttributeValue>alice@acme.test</saml:AttributeValue></saml:Attribute>` +
    `</saml:AttributeStatement>` +
    `</saml:Assertion>`
  );
}

function sign(xml: string, key: string, cert: string): string {
  const sig = new SignedXml({ privateKey: key, publicCert: cert });
  sig.addReference({
    xpath: "//*[local-name(.)='Assertion']",
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/2001/10/xml-exc-c14n#'],
  });
  sig.canonicalizationAlgorithm = 'http://www.w3.org/2001/10/xml-exc-c14n#';
  sig.signatureAlgorithm = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
  sig.computeSignature(xml, {
    location: { reference: "//*[local-name(.)='Assertion']/*[local-name(.)='Issuer']", action: 'after' },
  });
  return sig.getSignedXml();
}

function encryptTo(xml: string, cert: string): Promise<string> {
  return new Promise((resolve, reject) => {
    xmlenc.encrypt(
      xml,
      {
        rsa_pub: cert,
        pem: cert,
        encryptionAlgorithm: 'http://www.w3.org/2009/xmlenc11#aes256-gcm',
        keyEncryptionAlgorithm: 'http://www.w3.org/2001/04/xmlenc#rsa-oaep-mgf1p',
        disallowEncryptionWithInsecureAlgorithm: true,
        warnInsecureAlgorithm: false,
      },
      (error, result) => (error || !result ? reject(error ?? new Error('encryption failed')) : resolve(result)),
    );
  });
}

function response(inner: string): string {
  const xml =
    `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_resp${Math.random().toString(16).slice(2)}" Version="2.0" IssueInstant="${iso(new Date())}" Destination="${ACS}" InResponseTo="${REQUEST_ID}">` +
    `<saml:Issuer>${IDP_ISSUER}</saml:Issuer>` +
    `<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>` +
    inner +
    `</samlp:Response>`;
  return Buffer.from(xml, 'utf8').toString('base64');
}

async function encryptedResponse(
  assertionId: string,
  options: { signKey?: string; signCert?: string; unsigned?: boolean; encryptTo?: string } = {},
): Promise<string> {
  const assertion = options.unsigned
    ? assertionXml(assertionId)
    : sign(assertionXml(assertionId), options.signKey ?? KEYS.idpKey, options.signCert ?? KEYS.idpCert);
  const encrypted = await encryptTo(assertion, options.encryptTo ?? KEYS.spEncCert);
  return response(`<saml:EncryptedAssertion>${encrypted}</saml:EncryptedAssertion>`);
}

function fakePrisma() {
  const replays = new Set<string>();
  return {
    ssoAssertionReplay: {
      create: jest.fn(async ({ data }: { data: { tenantId: string; issuer: string; assertionId: string } }) => {
        const key = `${data.tenantId}|${data.issuer}|${data.assertionId}`;
        if (replays.has(key)) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });
        }
        replays.add(key);
        return data;
      }),
    },
    ssoConfiguration: { findFirst: jest.fn(async () => null) },
  };
}

async function expectReason(promise: Promise<unknown>, reason: SsoReasonCode): Promise<void> {
  const error = await promise.then(
    () => {
      throw new Error('verification unexpectedly succeeded');
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(SsoAuthError);
  expect((error as SsoAuthError).reason).toBe(reason);
}

describe('SAML encrypted assertions (round 7, opt-in)', () => {
  const ORIGINAL = process.env.SSO_SAML_ENABLED;
  let saml: SamlProviderService;

  beforeEach(() => {
    process.env.SSO_SAML_ENABLED = 'true';
    saml = new SamlProviderService(fakePrisma() as never, fakeCrypto as never);
  });

  afterAll(() => {
    if (ORIGINAL === undefined) delete process.env.SSO_SAML_ENABLED;
    else process.env.SSO_SAML_ENABLED = ORIGINAL;
  });

  it('decrypts an encrypted, signed assertion and returns the verified identity', async () => {
    const result = await saml.verifyResponse(config(), {
      samlResponse: await encryptedResponse('_enc_ok'),
      expectedRequestId: REQUEST_ID,
    });
    expect(result.assertionId).toBe('_enc_ok');
    expect(result.identity).toMatchObject({ issuer: IDP_ISSUER, subject: 'subject-alice', email: 'alice@acme.test' });
  });

  it('with the opt-in, a plaintext (signed) assertion is refused', async () => {
    const plaintext = response(sign(assertionXml('_plain'), KEYS.idpKey, KEYS.idpCert));
    await expectReason(saml.verifyResponse(config(), { samlResponse: plaintext, expectedRequestId: REQUEST_ID }), SsoReasonCode.SAML_ASSERTION_NOT_ENCRYPTED);
  });

  it('a response with both a plaintext and an encrypted assertion is refused', async () => {
    const encrypted = await encryptTo(sign(assertionXml('_both_e'), KEYS.idpKey, KEYS.idpCert), KEYS.spEncCert);
    const both = response(sign(assertionXml('_both_p'), KEYS.idpKey, KEYS.idpCert) + `<saml:EncryptedAssertion>${encrypted}</saml:EncryptedAssertion>`);
    await expectReason(saml.verifyResponse(config(), { samlResponse: both, expectedRequestId: REQUEST_ID }), SsoReasonCode.SAML_ASSERTION_NOT_ENCRYPTED);
  });

  it('encryption is not a substitute for the signature: an unsigned encrypted assertion is refused', async () => {
    await expectReason(
      saml.verifyResponse(config(), { samlResponse: await encryptedResponse('_unsigned', { unsigned: true }), expectedRequestId: REQUEST_ID }),
      SsoReasonCode.SAML_SIGNATURE_INVALID,
    );
  });

  it('an encrypted assertion signed by an unknown key is refused', async () => {
    await expectReason(
      saml.verifyResponse(config(), {
        samlResponse: await encryptedResponse('_attacker', { signKey: KEYS.attackerKey, signCert: KEYS.attackerCert }),
        expectedRequestId: REQUEST_ID,
      }),
      SsoReasonCode.SAML_SIGNATURE_INVALID,
    );
  });

  it('an assertion encrypted to a different key cannot be decrypted and is refused', async () => {
    await expectReason(
      saml.verifyResponse(config(), {
        samlResponse: await encryptedResponse('_wrong_key', { encryptTo: KEYS.attackerCert }),
        expectedRequestId: REQUEST_ID,
      }),
      SsoReasonCode.SAML_MALFORMED,
    );
  });

  it('without the opt-in no key is loaded and an encrypted assertion is refused', async () => {
    await expectReason(
      saml.verifyResponse(config({ wantAssertionsEncrypted: false }), {
        samlResponse: await encryptedResponse('_no_optin'),
        expectedRequestId: REQUEST_ID,
      }),
      SsoReasonCode.SAML_MALFORMED,
    );
  });

  it('the opt-in without a stored key, or a key sealed for another tenant, fails closed as CONFIG_INVALID', async () => {
    const samlResponse = await encryptedResponse('_cfg');
    await expectReason(saml.verifyResponse(config({ spDecryptionKeyCiphertext: null }), { samlResponse, expectedRequestId: REQUEST_ID }), SsoReasonCode.CONFIG_INVALID);
    await expectReason(
      saml.verifyResponse(config({ spDecryptionKeyCiphertext: fakeCrypto.encrypt(KEYS.spEncKey, samlSpDecryptionKeyAad('99999999-9999-4999-8999-999999999999')) }), {
        samlResponse,
        expectedRequestId: REQUEST_ID,
      }),
      SsoReasonCode.CONFIG_INVALID,
    );
    const unwired = new SamlProviderService(fakePrisma() as never);
    await expectReason(unwired.verifyResponse(config(), { samlResponse, expectedRequestId: REQUEST_ID }), SsoReasonCode.CONFIG_INVALID);
  });

  it('a decrypted assertion is still accepted only once (replay)', async () => {
    const samlResponse = await encryptedResponse('_enc_replay');
    await saml.verifyResponse(config(), { samlResponse, expectedRequestId: REQUEST_ID });
    await expectReason(saml.verifyResponse(config(), { samlResponse, expectedRequestId: REQUEST_ID }), SsoReasonCode.SAML_REPLAY);
  });
});

describe('EnterpriseSsoService encrypted-assertion configuration (round 7)', () => {
  const CONFIG_ID = '22222222-2222-4222-8222-222222222222';

  function build(existing: Record<string, unknown> | null = null) {
    const prisma: any = {
      ssoConfiguration: {
        findUnique: jest.fn(async () => existing),
        update: jest.fn(async ({ data }: any) => ({ ...existing, ...data })),
        create: jest.fn(async ({ data }: any) => ({ id: CONFIG_ID, isActive: true, enforced: false, jitEnabled: false, ...data })),
      },
      ssoIdentity: { findFirst: jest.fn(async () => null) },
    };
    const unused: any = {};
    const events: any = { record: jest.fn(async () => undefined) };
    const samlProvider = new SamlProviderService(prisma);
    const service = new EnterpriseSsoService(prisma, unused, unused, events, events, fakeCrypto as never, samlProvider);
    return { service, prisma };
  }

  const samlInput = {
    tenantId: TENANT,
    providerType: SsoProvider.SAML,
    actorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    issuer: IDP_ISSUER,
    ssoUrl: 'https://idp.acme.test/sso',
    acsUrl: ACS,
    entityId: SP_ENTITY,
    certificate: KEYS.idpCert,
  };

  it('stores the SP key sealed with the tenant AAD and never returns it', async () => {
    const h = build();
    const view = await h.service.configureSso({
      ...samlInput,
      wantAssertionsEncrypted: true,
      spDecryptionPrivateKey: KEYS.spEncKey,
      spEncryptionCertificate: KEYS.spEncCert,
    });
    expect(view).toMatchObject({ wantAssertionsEncrypted: true, hasSpDecryptionKey: true, spEncryptionCertificate: KEYS.spEncCert.trim() });
    expect(JSON.stringify(view)).not.toContain('PRIVATE KEY');
    const stored = h.prisma.ssoConfiguration.create.mock.calls[0][0].data;
    expect(stored.spDecryptionKeyCiphertext).toEqual({ sealed: KEYS.spEncKey.trim(), aad: samlSpDecryptionKeyAad(TENANT) });
  });

  it('refuses a certificate that does not belong to the key', async () => {
    const h = build();
    await expect(
      h.service.configureSso({ ...samlInput, wantAssertionsEncrypted: true, spDecryptionPrivateKey: KEYS.spEncKey, spEncryptionCertificate: KEYS.attackerCert }),
    ).rejects.toThrow('spEncryptionCertificate does not belong to spDecryptionPrivateKey');
    expect(h.prisma.ssoConfiguration.create).not.toHaveBeenCalled();
  });

  it('refuses the opt-in without a key or without a certificate', async () => {
    const h = build();
    await expect(h.service.configureSso({ ...samlInput, wantAssertionsEncrypted: true, spEncryptionCertificate: KEYS.spEncCert })).rejects.toThrow(
      'spDecryptionPrivateKey is required',
    );
    await expect(h.service.configureSso({ ...samlInput, wantAssertionsEncrypted: true, spDecryptionPrivateKey: KEYS.spEncKey })).rejects.toThrow(
      'spEncryptionCertificate is required',
    );
  });

  it('refuses malformed, non-RSA and short keys', async () => {
    const h = build();
    const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const rsa1024 = generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    for (const key of ['not a key', ec, rsa1024]) {
      await expect(
        h.service.configureSso({ ...samlInput, wantAssertionsEncrypted: true, spDecryptionPrivateKey: key, spEncryptionCertificate: KEYS.spEncCert }),
      ).rejects.toThrow(BadRequestException);
    }
    expect(h.prisma.ssoConfiguration.create).not.toHaveBeenCalled();
  });

  it('re-checks the pair against the stored key when only the certificate changes', async () => {
    const existing = {
      id: CONFIG_ID,
      tenantId: TENANT,
      providerType: 'SAML',
      state: 'ENABLED',
      isActive: true,
      enforced: false,
      issuer: IDP_ISSUER,
      ssoUrl: 'https://idp.acme.test/sso',
      acsUrl: ACS,
      entityId: SP_ENTITY,
      certificate: KEYS.idpCert,
      wantAssertionsEncrypted: true,
      spDecryptionKeyCiphertext: fakeCrypto.encrypt(KEYS.spEncKey, samlSpDecryptionKeyAad(TENANT)),
      spEncryptionCertificate: KEYS.spEncCert,
    };
    const h = build(existing);
    await expect(h.service.configureSso({ ...samlInput, spEncryptionCertificate: KEYS.idpCert })).rejects.toThrow(
      'spEncryptionCertificate does not belong to spDecryptionPrivateKey',
    );
    await expect(h.service.configureSso({ ...samlInput, spEncryptionCertificate: KEYS.spEncCert })).resolves.toMatchObject({ hasSpDecryptionKey: true });
  });

  it('encrypted assertions are SAML-only', async () => {
    const h = build();
    await expect(
      h.service.configureSso({
        tenantId: TENANT,
        providerType: SsoProvider.OIDC,
        actorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        issuer: 'https://idp.acme.test',
        clientId: 'c',
        clientSecret: 's',
        redirectUri: 'https://acme.app.test/api/auth/sso/callback',
        wantAssertionsEncrypted: true,
      }),
    ).rejects.toThrow('Encrypted assertions apply to SAML configurations only');
  });
});
