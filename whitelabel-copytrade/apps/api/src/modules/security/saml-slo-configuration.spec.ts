import { generateKeyPairSync } from 'crypto';
import { BadRequestException } from '@nestjs/common';

import { loadSamlTestKeys } from './__fixtures__/saml-test-keys.fixture-spec';
import { EnterpriseSsoService } from './enterprise-sso.service';
import { SamlProviderService, samlSpSigningKeyAad } from './saml-provider.service';
import { SsoProvider } from './security.types';

/**
 * Round 8 - SAML Single Logout configuration (tenant SSO settings).
 *
 * The SP signing key is write-only: envelope-encrypted with the tenant AAD,
 * never returned (only hasSpSigningKey). With an IdP SLO URL the
 * configuration must also carry our SLO URL and a currently valid signing
 * certificate that belongs to an RSA >= 2048 key, so a stored configuration
 * can actually sign LogoutRequests. Single Logout settings are SAML-only.
 * Keys are generated at test time; none is committed.
 */

const KEYS = loadSamlTestKeys();
const TENANT = '11111111-1111-4111-8111-111111111111';
const CONFIG_ID = '22222222-2222-4222-8222-222222222222';
const IDP_ISSUER = 'https://idp.acme.test/saml';
const SP_ENTITY = 'https://acme.app.test/saml/sp';
const ACS = 'https://acme.app.test/v1/auth/sso/saml/acs';
const IDP_SLO = 'https://idp.acme.test/saml/slo';
const SP_SLO = 'https://acme.app.test/v1/auth/sso/saml/slo';

/** A stand-in for CryptoService that enforces the AAD binding like the real envelope. */
const fakeCrypto = {
  encrypt: (plaintext: string, aad?: string) => ({ sealed: plaintext, aad }),
  decrypt: (payload: { sealed: string; aad?: string }, aad?: string) => {
    if (payload.aad !== aad) throw new Error('AAD mismatch');
    return payload.sealed;
  },
};

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
  return { service, prisma, events };
}

const samlInput = {
  tenantId: TENANT,
  providerType: SsoProvider.SAML,
  actorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  issuer: IDP_ISSUER,
  ssoUrl: 'https://idp.acme.test/saml/sso',
  acsUrl: ACS,
  entityId: SP_ENTITY,
  certificate: KEYS.idpCert,
};

const sloInput = {
  sloUrl: IDP_SLO,
  logoutCallbackUrl: SP_SLO,
  spSigningPrivateKey: KEYS.spEncKey,
  spSigningCertificate: KEYS.spEncCert,
};

function existingWithSlo(overrides: Record<string, unknown> = {}) {
  return {
    id: CONFIG_ID,
    tenantId: TENANT,
    providerType: 'SAML',
    state: 'ENABLED',
    isActive: true,
    enforced: false,
    issuer: IDP_ISSUER,
    ssoUrl: 'https://idp.acme.test/saml/sso',
    acsUrl: ACS,
    entityId: SP_ENTITY,
    certificate: KEYS.idpCert,
    sloUrl: IDP_SLO,
    logoutCallbackUrl: SP_SLO,
    spSigningKeyCiphertext: fakeCrypto.encrypt(KEYS.spEncKey, samlSpSigningKeyAad(TENANT)),
    spSigningCertificate: KEYS.spEncCert,
    ...overrides,
  };
}

describe('EnterpriseSsoService SAML Single Logout configuration (round 8)', () => {
  it('stores the SP signing key sealed with the tenant AAD and never returns it', async () => {
    const h = build();
    const view = await h.service.configureSso({ ...samlInput, ...sloInput });
    expect(view).toMatchObject({
      sloUrl: IDP_SLO,
      logoutCallbackUrl: SP_SLO,
      hasSpSigningKey: true,
      spSigningCertificate: KEYS.spEncCert.trim(),
    });
    expect(JSON.stringify(view)).not.toContain('PRIVATE KEY');
    const stored = h.prisma.ssoConfiguration.create.mock.calls[0][0].data;
    expect(stored.spSigningKeyCiphertext).toEqual({ sealed: KEYS.spEncKey.trim(), aad: samlSpSigningKeyAad(TENANT) });
    expect(stored.sloUrl).toBe(IDP_SLO);
    expect(stored.logoutCallbackUrl).toBe(SP_SLO);
    // The audit record names the change, never the key.
    expect(JSON.stringify(h.events.record.mock.calls)).not.toContain('PRIVATE KEY');
  });

  it('a configuration without Single Logout reports it plainly', async () => {
    const h = build();
    const view = await h.service.configureSso({ ...samlInput });
    expect(view).toMatchObject({ sloUrl: null, logoutCallbackUrl: null, hasSpSigningKey: false, spSigningCertificate: null });
  });

  it('with an IdP SLO URL, our SLO URL, the key and the certificate are all required', async () => {
    const h = build();
    const { logoutCallbackUrl: _a, ...noCallback } = sloInput;
    const { spSigningPrivateKey: _b, ...noKey } = sloInput;
    const { spSigningCertificate: _c, ...noCert } = sloInput;
    await expect(h.service.configureSso({ ...samlInput, ...noCallback })).rejects.toThrow('logoutCallbackUrl is required when sloUrl is set');
    await expect(h.service.configureSso({ ...samlInput, ...noKey })).rejects.toThrow('spSigningPrivateKey is required when sloUrl is set');
    await expect(h.service.configureSso({ ...samlInput, ...noCert })).rejects.toThrow('spSigningCertificate is required when sloUrl is set');
    expect(h.prisma.ssoConfiguration.create).not.toHaveBeenCalled();
  });

  it('refuses a certificate that does not belong to the key, and an expired certificate', async () => {
    const h = build();
    await expect(h.service.configureSso({ ...samlInput, ...sloInput, spSigningCertificate: KEYS.attackerCert })).rejects.toThrow(
      'spSigningCertificate does not belong to spSigningPrivateKey',
    );
    await expect(h.service.configureSso({ ...samlInput, ...sloInput, spSigningCertificate: KEYS.expiredCert })).rejects.toThrow(
      'spSigningCertificate is not currently valid',
    );
    await expect(h.service.configureSso({ ...samlInput, ...sloInput, spSigningCertificate: 'not a certificate' })).rejects.toThrow(
      'spSigningCertificate is not a valid X.509 certificate',
    );
    expect(h.prisma.ssoConfiguration.create).not.toHaveBeenCalled();
  });

  it('refuses malformed, non-RSA and short signing keys before anything is sealed', async () => {
    const h = build();
    const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const rsa1024 = generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    for (const key of ['not a key', ec, rsa1024]) {
      await expect(h.service.configureSso({ ...samlInput, ...sloInput, spSigningPrivateKey: key })).rejects.toThrow(BadRequestException);
    }
    expect(h.prisma.ssoConfiguration.create).not.toHaveBeenCalled();
  });

  it('refuses non-https SLO URLs', async () => {
    const h = build();
    await expect(h.service.configureSso({ ...samlInput, ...sloInput, sloUrl: 'http://idp.acme.test/slo' })).rejects.toThrow(BadRequestException);
    await expect(h.service.configureSso({ ...samlInput, ...sloInput, logoutCallbackUrl: 'javascript:alert(1)' })).rejects.toThrow(BadRequestException);
    expect(h.prisma.ssoConfiguration.create).not.toHaveBeenCalled();
  });

  it('re-checks a new certificate against the stored key, and refuses a stored key sealed for another tenant', async () => {
    const h = build(existingWithSlo());
    await expect(h.service.configureSso({ ...samlInput, spSigningCertificate: KEYS.idpCert })).rejects.toThrow(
      'spSigningCertificate does not belong to spSigningPrivateKey',
    );
    await expect(h.service.configureSso({ ...samlInput, spSigningCertificate: KEYS.spEncCert })).resolves.toMatchObject({ hasSpSigningKey: true });

    const foreign = build(
      existingWithSlo({ spSigningKeyCiphertext: fakeCrypto.encrypt(KEYS.spEncKey, samlSpSigningKeyAad('99999999-9999-4999-8999-999999999999')) }),
    );
    await expect(foreign.service.configureSso({ ...samlInput, spSigningCertificate: KEYS.spEncCert })).rejects.toThrow(
      'The stored SP signing key cannot be read; upload spSigningPrivateKey again',
    );
  });

  it('an empty sloUrl turns Single Logout off without needing the other fields', async () => {
    const h = build(existingWithSlo());
    await expect(h.service.configureSso({ ...samlInput, sloUrl: '' })).resolves.toMatchObject({ sloUrl: null });
    expect(h.prisma.ssoConfiguration.update.mock.calls[0][0].data.sloUrl).toBeNull();
  });

  it('Single Logout settings are SAML-only', async () => {
    const h = build();
    const oidc = {
      tenantId: TENANT,
      providerType: SsoProvider.OIDC,
      actorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      issuer: 'https://idp.acme.test',
      clientId: 'c',
      clientSecret: 's',
      redirectUri: 'https://acme.app.test/api/auth/sso/callback',
    };
    await expect(h.service.configureSso({ ...oidc, sloUrl: IDP_SLO })).rejects.toThrow('Single Logout settings apply to SAML configurations only');
    await expect(h.service.configureSso({ ...oidc, spSigningPrivateKey: KEYS.spEncKey })).rejects.toThrow(
      'spSigningPrivateKey applies to SAML configurations only',
    );
    expect(h.prisma.ssoConfiguration.create).not.toHaveBeenCalled();
  });
});
