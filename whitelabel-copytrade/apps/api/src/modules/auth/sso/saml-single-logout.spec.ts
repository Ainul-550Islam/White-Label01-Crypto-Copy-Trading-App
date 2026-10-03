import { randomBytes } from 'crypto';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { inflateRawSync } from 'zlib';
import { SAML, ValidateInResponseTo, type Profile } from '@node-saml/node-saml';
import { Prisma } from '@prisma/client';

import type { TenantContext } from '../../../common/types/request.types';
import { createMetricsRegistry } from '../../observability/metrics.registry.provider';
import { SamlProviderService, samlSpSigningKeyAad } from '../../security/saml-provider.service';
import { SsoAuditEventCode, SsoReasonCode } from '../../security/sso-flow.types';
import { loadSamlTestKeys } from '../../security/__fixtures__/saml-test-keys.fixture-spec';
import { AuthService } from '../auth.service';
import { SessionService } from '../services/session.service';
import {
  createInMemorySsoPrisma,
  fakeCryptoService,
  type InMemorySsoPrisma,
} from './__fixtures__/in-memory-sso-prisma.fixture-spec';
import { SsoAuditService } from './sso-audit.service';
import { SsoLoginService } from './sso-login.service';
import { SsoTransactionService } from './sso-transaction.service';

/**
 * Round 8 - SAML Single Logout (HTTP-Redirect binding).
 *
 * Real: SsoLoginService, SamlProviderService (node-saml + our redirect
 * signature check), SsoTransactionService, SessionService (session rows and
 * refresh tokens), AuthService.revokeSamlIdpSessions, SsoAuditService.
 * The IdP is a second, independent node-saml instance with its own key that
 * trusts only the SP signing certificate: it verifies our LogoutRequest and
 * LogoutResponse and produces signed LogoutResponses / LogoutRequests.
 * Faked: the database (in-memory models with conditional updates) and
 * CryptoService (reversible, AAD-bound).
 *
 * Keys are generated for every jest run (test/sso-test-keys.global-setup.js);
 * the SP signing pair reuses the generated SP key pair. Nothing is committed.
 */

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '99999999-9999-4999-8999-999999999999';
const CONFIG = '55555555-5555-4555-8555-555555555555';
const OTHER_CONFIG = '66666666-6666-4666-8666-666666666666';
const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const IDP_ENTITY = 'https://idp.acme.test/saml';
const IDP_SSO = 'https://idp.acme.test/saml/sso';
const IDP_SLO = 'https://idp.acme.test/saml/slo';
const SP_ENTITY = 'https://acme.app.test/saml/sp';
const ACS = 'https://acme.app.test/v1/auth/sso/saml/acs';
const SP_SLO = 'https://acme.app.test/v1/auth/sso/saml/slo';
const WEB_CALLBACK = 'https://acme.app.test/api/auth/sso/callback';
const WEB_LOGIN = 'https://acme.app.test/login';
const EMAIL_FORMAT = 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress';
const ALICE_NAME_ID = 'alice@acme.test';
const BOB_NAME_ID = 'bob@acme.test';

const KEYS = loadSamlTestKeys();
const SP_SIGNING_KEY = KEYS.spEncKey;
const SP_SIGNING_CERT = KEYS.spEncCert;

const tenantCtx = (tenantId: string): TenantContext => ({
  tenantId,
  slug: tenantId === TENANT ? 'acme' : 'other',
  status: 'ACTIVE',
  source: 'subdomain',
  defaultLocale: 'en',
  defaultCurrency: 'USD',
});
const requestCtx = { ipHash: 'iphash-0001', userAgent: 'jest', requestId: 'req-1', locale: 'en' };

const queryOf = (url: string): string => url.slice(url.indexOf('?') + 1);
const paramsOf = (url: string): Record<string, string> => Object.fromEntries(new URLSearchParams(queryOf(url)));
const inflateParam = (url: string, key: 'SAMLRequest' | 'SAMLResponse'): string =>
  inflateRawSync(Buffer.from(new URLSearchParams(queryOf(url)).get(key) ?? '', 'base64')).toString('utf8');

/** An independent IdP: signs with its own key, trusts only the SP signing certificate. */
function idp(options: {
  key?: string;
  signatureAlgorithm?: 'sha1' | 'sha256' | 'sha512';
  issuer?: string;
  destination?: string;
  trustedSpCert?: string;
} = {}): SAML {
  return new SAML({
    entryPoint: IDP_SSO,
    callbackUrl: 'https://idp.acme.test/unused-acs',
    issuer: options.issuer ?? IDP_ENTITY,
    idpCert: options.trustedSpCert ?? SP_SIGNING_CERT,
    idpIssuer: SP_ENTITY,
    privateKey: options.key ?? KEYS.idpKey,
    signatureAlgorithm: options.signatureAlgorithm ?? 'sha256',
    logoutUrl: options.destination ?? SP_SLO,
    validateInResponseTo: ValidateInResponseTo.never,
    generateUniqueId: () => `_idp${randomBytes(12).toString('hex')}`,
    wantAssertionsSigned: false,
  });
}

interface Harness {
  prisma: InMemorySsoPrisma;
  crypto: ReturnType<typeof fakeCryptoService>;
  saml: SamlProviderService;
  transactions: SsoTransactionService;
  sessions: SessionService;
  login: SsoLoginService;
  revokeSpy: jest.SpyInstance;
}

function samlConfig(crypto: ReturnType<typeof fakeCryptoService>, overrides: Record<string, unknown> = {}) {
  return {
    id: CONFIG,
    tenantId: TENANT,
    providerType: 'SAML',
    state: 'ENABLED',
    isActive: true,
    enforced: false,
    issuer: IDP_ENTITY,
    entityId: SP_ENTITY,
    audience: null,
    ssoUrl: IDP_SSO,
    acsUrl: ACS,
    certificate: KEYS.idpCert,
    clockSkewSec: 60,
    wantResponseSigned: false,
    wantAssertionsEncrypted: false,
    spDecryptionKeyCiphertext: null,
    spEncryptionCertificate: null,
    redirectUri: WEB_CALLBACK,
    sloUrl: IDP_SLO,
    logoutCallbackUrl: SP_SLO,
    spSigningKeyCiphertext: crypto.encrypt(SP_SIGNING_KEY, samlSpSigningKeyAad(TENANT)),
    spSigningCertificate: SP_SIGNING_CERT,
    ...overrides,
  };
}

function harness(): Harness {
  const prisma = createInMemorySsoPrisma();
  const crypto = fakeCryptoService();
  const saml = new SamlProviderService(prisma as never, crypto as never);
  const transactions = new SsoTransactionService(prisma as never, crypto as never);
  const pino = { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() };
  const sessions = new SessionService(
    prisma as never,
    { refreshTokenTtlSeconds: 3600, maxActiveSessionsPerUser: 10 } as never,
    pino as never,
  );
  const securityAudit = { record: jest.fn(async () => undefined) };
  const audit = new SsoAuditService(prisma as never, securityAudit as never, createMetricsRegistry());
  // The real AuthService method, bound to the real SessionService.
  const auth = {
    sessions,
    revokeSamlIdpSessions(input: { tenantId: string; configurationId: string; subjectHash: string; sessionIndexHashes: string[] }) {
      return AuthService.prototype.revokeSamlIdpSessions.call(this as never, input);
    },
  };
  const revokeSpy = jest.spyOn(auth, 'revokeSamlIdpSessions');
  const unused = {} as never;
  const login = new SsoLoginService(prisma as never, auth as never, unused, saml, transactions, unused, audit);
  prisma.ssoConfiguration.rows.push(samlConfig(crypto));
  return { prisma, crypto, saml, transactions, sessions, login, revokeSpy };
}

/** A SAML session exactly as a verified login stores it (sealed context + lookup hashes) and one refresh token. */
async function samlSession(
  h: Harness,
  input: { userId: string; deviceId: string; nameID: string; sessionIndex: string | null; configurationId?: string; tenantId?: string },
): Promise<string> {
  const configurationId = input.configurationId ?? CONFIG;
  const tenantId = input.tenantId ?? TENANT;
  const samlLogout = h.transactions.sealSamlLogout(tenantId, configurationId, {
    nameID: input.nameID,
    nameIDFormat: EMAIL_FORMAT,
    nameQualifier: null,
    spNameQualifier: null,
    sessionIndex: input.sessionIndex,
  });
  const created = await h.sessions.createOrReuse({
    userId: input.userId,
    tenantId,
    deviceId: input.deviceId,
    ipHash: 'iphash-0001',
    authMethod: 'SSO_SAML',
    ssoConfigurationId: configurationId,
    samlLogout,
  });
  await h.prisma.refreshToken.create({ data: { sessionId: created.id, userId: input.userId, tenantId } });
  return created.id;
}

const sessionRow = (h: Harness, id: string) => h.prisma.userSession.rows.find((row) => row.id === id) as Record<string, any>;
const tokenOf = (h: Harness, sessionId: string) => h.prisma.refreshToken.rows.find((row) => row.sessionId === sessionId) as Record<string, any>;
const auditCodes = (h: Harness) => h.prisma.ssoAuditEvent.rows.map((row) => row.eventCode);
const lastAudit = (h: Harness) => h.prisma.ssoAuditEvent.rows[h.prisma.ssoAuditEvent.rows.length - 1] as Record<string, any>;

/** SP-initiated logout for Alice's session; returns the IdP URL and what the IdP verified. */
async function startLogout(h: Harness) {
  const sessionId = await samlSession(h, { userId: ALICE, deviceId: 'web-alice-1', nameID: ALICE_NAME_ID, sessionIndex: 'idx-alice-1' });
  const result = await h.login.logoutUrl(TENANT, ALICE, sessionId, 'iphash-0001');
  expect(result.reason).toBeNull();
  const url = String(result.logoutUrl);
  const verified = await idp().validateRedirectAsync(paramsOf(url) as never, queryOf(url));
  return { sessionId, url, request: verified.profile as Profile, relayState: paramsOf(url).RelayState };
}

const logoutTx = (h: Harness) => h.prisma.ssoAuthTransaction.rows.find((row) => row.status === 'LOGOUT_PENDING' || row.samlRequestId) as Record<string, any>;

beforeAll(() => {
  process.env.SSO_SAML_ENABLED = 'true';
});
afterAll(() => {
  delete process.env.SSO_SAML_ENABLED;
});

describe('SP-initiated SAML logout (POST /v1/auth/sso/logout-url)', () => {
  it('builds a signed LogoutRequest that an independent IdP verifies with the SP signing certificate', async () => {
    const h = harness();
    const { url, request } = await startLogout(h);

    expect(url.startsWith(`${IDP_SLO}?`)).toBe(true);
    const params = paramsOf(url);
    expect(params.SigAlg).toBe('http://www.w3.org/2001/04/xmldsig-more#rsa-sha256');
    expect(params.Signature).toBeTruthy();
    expect(params.RelayState).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // What the IdP verified: our issuer, Alice's NameID exactly as issued, her SessionIndex.
    expect(request.issuer).toBe(SP_ENTITY);
    expect(request.nameID).toBe(ALICE_NAME_ID);
    expect(request.nameIDFormat).toBe(EMAIL_FORMAT);
    expect(request.sessionIndex).toBe('idx-alice-1');
    const xml = inflateParam(url, 'SAMLRequest');
    expect(xml).toContain(`Destination="${IDP_SLO}"`);

    // A LOGOUT_PENDING transaction holds the request ID; the RelayState is stored only as a hash.
    const tx = logoutTx(h);
    expect(tx.status).toBe('LOGOUT_PENDING');
    expect(tx.samlRequestId).toBe(request.ID);
    expect(tx.verifiedUserId).toBe(ALICE);
    expect(tx.redirectUri).toBe(WEB_LOGIN);
    expect(tx.stateHash).toBe(SsoTransactionService.hashState(params.RelayState));
    expect(JSON.stringify(tx)).not.toContain(params.RelayState);
    expect(auditCodes(h)).toEqual([SsoAuditEventCode.SAML_LOGOUT_REQUESTED]);
  });

  it('the signature is real: an IdP that trusts a different certificate refuses the LogoutRequest', async () => {
    const h = harness();
    const sessionId = await samlSession(h, { userId: ALICE, deviceId: 'web-alice-1', nameID: ALICE_NAME_ID, sessionIndex: 'idx-alice-1' });
    const { logoutUrl } = await h.login.logoutUrl(TENANT, ALICE, sessionId);
    const url = String(logoutUrl);
    await expect(
      idp({ trustedSpCert: KEYS.attackerCert }).validateRedirectAsync(paramsOf(url) as never, queryOf(url)),
    ).rejects.toThrow(/signature/i);
  });

  it("completes on the IdP's signed Success LogoutResponse, exactly once", async () => {
    const h = harness();
    const { request, relayState } = await startLogout(h);
    const responseUrl = await idp().getLogoutResponseUrlAsync(request, relayState, {}, true);
    expect(responseUrl.startsWith(`${SP_SLO}?`)).toBe(true);

    await expect(h.login.consumeSamlLogout(tenantCtx(TENANT), queryOf(responseUrl), requestCtx)).resolves.toEqual({
      redirectTo: WEB_LOGIN,
    });
    expect(logoutTx(h).status).toBe('CONSUMED');
    expect(lastAudit(h)).toMatchObject({ eventCode: SsoAuditEventCode.SAML_LOGOUT_COMPLETED, outcome: 'SUCCESS', userId: ALICE });

    // Replay of the same response: not accepted again, the browser is told the IdP logout is unconfirmed.
    const replay = await h.login.consumeSamlLogout(tenantCtx(TENANT), queryOf(responseUrl), requestCtx);
    expect(replay.redirectTo).toBe(`${WEB_LOGIN}?sso=logout_unconfirmed`);
    expect(lastAudit(h)).toMatchObject({ eventCode: SsoAuditEventCode.SAML_LOGOUT_REJECTED, reasonCode: SsoReasonCode.STATE_CONSUMED });
  });

  describe('forged or wrong LogoutResponses are refused and the pending logout is closed', () => {
    async function refused(build: (request: Profile, relayState: string) => Promise<string>, reason: SsoReasonCode) {
      const h = harness();
      const { request, relayState } = await startLogout(h);
      const query = queryOf(await build(request, relayState));
      const outcome = await h.login.consumeSamlLogout(tenantCtx(TENANT), query, requestCtx);
      expect(outcome.redirectTo).toBe(`${WEB_LOGIN}?sso=logout_unconfirmed`);
      const tx = logoutTx(h);
      expect(tx.status).toBe('REJECTED');
      expect(tx.failureReason).toBe(reason);
      expect(lastAudit(h)).toMatchObject({ eventCode: SsoAuditEventCode.SAML_LOGOUT_REJECTED, outcome: 'FAILURE', reasonCode: reason });
      expect(h.revokeSpy).not.toHaveBeenCalled();
    }

    it('signed by an unknown key', () =>
      refused((r, rs) => idp({ key: KEYS.attackerKey }).getLogoutResponseUrlAsync(r, rs, {}, true), SsoReasonCode.SAML_SIGNATURE_INVALID));

    it('unsigned (node-saml alone would accept it)', () =>
      refused(async (r, rs) => {
        const url = new URL(await idp().getLogoutResponseUrlAsync(r, rs, {}, true));
        url.searchParams.delete('Signature');
        url.searchParams.delete('SigAlg');
        return url.toString();
      }, SsoReasonCode.SAML_SIGNATURE_INVALID));

    it('signed with SHA-1', () =>
      refused((r, rs) => idp({ signatureAlgorithm: 'sha1' }).getLogoutResponseUrlAsync(r, rs, {}, true), SsoReasonCode.SAML_SIGNATURE_INVALID));

    it('answering a different LogoutRequest', () =>
      refused((r, rs) => idp().getLogoutResponseUrlAsync({ ...r, ID: '_someOtherRequest' }, rs, {}, true), SsoReasonCode.SAML_IN_RESPONSE_TO_MISMATCH));

    it('without InResponseTo (node-saml alone would accept it)', async () => {
      const h = harness();
      const { request, relayState } = await startLogout(h);
      const url = await idp().getLogoutResponseUrlAsync({ ...request, ID: '' }, relayState, {}, true);
      expect(inflateParam(url, 'SAMLResponse')).not.toMatch(/InResponseTo="_/);
      const outcome = await h.login.consumeSamlLogout(tenantCtx(TENANT), queryOf(url), requestCtx);
      expect(outcome.redirectTo).toBe(`${WEB_LOGIN}?sso=logout_unconfirmed`);
      expect(logoutTx(h).status).toBe('REJECTED');
      expect(lastAudit(h)).toMatchObject({ reasonCode: SsoReasonCode.SAML_IN_RESPONSE_TO_MISMATCH });
    });

    it('reporting a non-Success status (a validly signed failure)', () =>
      refused((r, rs) => idp().getLogoutResponseUrlAsync(r, rs, {}, false), SsoReasonCode.SAML_STATUS_NOT_SUCCESS));

    it('addressed to another endpoint (Destination)', () =>
      refused((r, rs) => idp({ destination: 'https://evil.test/slo' }).getLogoutResponseUrlAsync(r, rs, {}, true), SsoReasonCode.SAML_DESTINATION_MISMATCH));

    it('from another issuer, even with the configured signing key', () =>
      refused((r, rs) => idp({ issuer: 'https://other-idp.test/saml' }).getLogoutResponseUrlAsync(r, rs, {}, true), SsoReasonCode.SAML_ISSUER_MISMATCH));

    it('with a tampered signed query (RelayState swapped for another logout of the same tenant)', async () => {
      const h = harness();
      const first = await startLogout(h);
      const secondSession = await samlSession(h, { userId: BOB, deviceId: 'web-bob-1', nameID: BOB_NAME_ID, sessionIndex: 'idx-bob-1' });
      const second = await h.login.logoutUrl(TENANT, BOB, secondSession);
      const secondRelay = paramsOf(String(second.logoutUrl)).RelayState;
      const url = new URL(await idp().getLogoutResponseUrlAsync(first.request, first.relayState, {}, true));
      url.searchParams.set('RelayState', secondRelay);
      const outcome = await h.login.consumeSamlLogout(tenantCtx(TENANT), queryOf(url.toString()), requestCtx);
      expect(outcome.redirectTo).toBe(`${WEB_LOGIN}?sso=logout_unconfirmed`);
      expect(lastAudit(h)).toMatchObject({ reasonCode: SsoReasonCode.SAML_SIGNATURE_INVALID });
      expect(h.prisma.ssoAuthTransaction.rows.filter((row) => row.status === 'CONSUMED')).toHaveLength(0);
    });
  });

  it("another tenant's host cannot complete or close this tenant's logout", async () => {
    const h = harness();
    const { request, relayState } = await startLogout(h);
    const responseUrl = await idp().getLogoutResponseUrlAsync(request, relayState, {}, true);
    await expect(h.login.consumeSamlLogout(tenantCtx(OTHER_TENANT), queryOf(responseUrl), requestCtx)).resolves.toEqual({
      redirectTo: null,
    });
    expect(logoutTx(h).status).toBe('LOGOUT_PENDING');
    expect(lastAudit(h)).toMatchObject({ tenantId: OTHER_TENANT, reasonCode: SsoReasonCode.TENANT_MISMATCH });
  });

  it('a message without RelayState, with an unknown RelayState, or neither message kind gets 400 (null)', async () => {
    const h = harness();
    const { request, relayState } = await startLogout(h);
    const url = new URL(await idp().getLogoutResponseUrlAsync(request, relayState, {}, true));
    const noRelay = new URL(url.toString());
    noRelay.searchParams.delete('RelayState');
    await expect(h.login.consumeSamlLogout(tenantCtx(TENANT), queryOf(noRelay.toString()), requestCtx)).resolves.toEqual({ redirectTo: null });
    const unknown = new URL(url.toString());
    unknown.searchParams.set('RelayState', 'x'.repeat(43));
    await expect(h.login.consumeSamlLogout(tenantCtx(TENANT), queryOf(unknown.toString()), requestCtx)).resolves.toEqual({ redirectTo: null });
    await expect(h.login.consumeSamlLogout(tenantCtx(TENANT), 'foo=bar', requestCtx)).resolves.toEqual({ redirectTo: null });
    await expect(h.login.consumeSamlLogout(tenantCtx(TENANT), '', requestCtx)).resolves.toEqual({ redirectTo: null });
    expect(logoutTx(h).status).toBe('LOGOUT_PENDING');
  });

  describe('no IdP URL (and no transaction) when Single Logout cannot be done', () => {
    async function noUrl(mutate: (h: Harness) => void, reason: SsoReasonCode, sessionIndex: string | null = 'idx-alice-1') {
      const h = harness();
      const sessionId = await samlSession(h, { userId: ALICE, deviceId: 'web-alice-1', nameID: ALICE_NAME_ID, sessionIndex });
      mutate(h);
      await expect(h.login.logoutUrl(TENANT, ALICE, sessionId)).resolves.toEqual({ logoutUrl: null, providerType: 'SAML', reason });
      expect(h.prisma.ssoAuthTransaction.rows).toHaveLength(0);
    }

    it('the configuration has no IdP SLO URL', () =>
      noUrl((h) => Object.assign(h.prisma.ssoConfiguration.rows[0], { sloUrl: null }), SsoReasonCode.SAML_SLO_NOT_CONFIGURED));

    it('the SLO URL is not https', () =>
      noUrl((h) => Object.assign(h.prisma.ssoConfiguration.rows[0], { sloUrl: 'http://idp.acme.test/slo' }), SsoReasonCode.SAML_SLO_NOT_CONFIGURED));

    it('there is no SP signing key', () =>
      noUrl((h) => Object.assign(h.prisma.ssoConfiguration.rows[0], { spSigningKeyCiphertext: null }), SsoReasonCode.SAML_SLO_NOT_CONFIGURED));

    it('the signing certificate does not belong to the signing key', () =>
      noUrl((h) => Object.assign(h.prisma.ssoConfiguration.rows[0], { spSigningCertificate: KEYS.idpCert }), SsoReasonCode.SAML_SLO_NOT_CONFIGURED));

    it('the signing certificate has expired', () =>
      noUrl((h) => Object.assign(h.prisma.ssoConfiguration.rows[0], { spSigningCertificate: KEYS.expiredCert }), SsoReasonCode.SAML_SLO_NOT_CONFIGURED));

    it('the signing key is sealed for another tenant', () =>
      noUrl(
        (h) =>
          Object.assign(h.prisma.ssoConfiguration.rows[0], {
            spSigningKeyCiphertext: h.crypto.encrypt(SP_SIGNING_KEY, samlSpSigningKeyAad(OTHER_TENANT)),
          }),
        SsoReasonCode.SAML_SLO_NOT_CONFIGURED,
      ));

    it('the issuing configuration was disabled', () =>
      noUrl((h) => Object.assign(h.prisma.ssoConfiguration.rows[0], { state: 'DISABLED' }), SsoReasonCode.PROVIDER_NOT_CONFIGURED));

    it('the session predates Single Logout (no stored context)', () =>
      noUrl(
        (h) => Object.assign(h.prisma.userSession.rows[0], { ssoLogoutContext: null }),
        SsoReasonCode.SAML_SLO_CONTEXT_MISSING,
      ));

    it('the stored context is sealed for another configuration', () =>
      noUrl(
        (h) =>
          Object.assign(h.prisma.userSession.rows[0], {
            ssoLogoutContext: h.transactions.sealSamlLogout(TENANT, OTHER_CONFIG, {
              nameID: ALICE_NAME_ID,
              nameIDFormat: EMAIL_FORMAT,
            }).context,
          }),
        SsoReasonCode.SAML_SLO_CONTEXT_MISSING,
      ));
  });
});

describe('IdP-initiated SAML logout (GET /v1/auth/sso/saml/slo with SAMLRequest)', () => {
  async function seedSessions(h: Harness) {
    return {
      aliceIdx1: await samlSession(h, { userId: ALICE, deviceId: 'web-alice-1', nameID: ALICE_NAME_ID, sessionIndex: 'idx-alice-1' }),
      aliceIdx2: await samlSession(h, { userId: ALICE, deviceId: 'web-alice-2', nameID: ALICE_NAME_ID, sessionIndex: 'idx-alice-2' }),
      bob: await samlSession(h, { userId: BOB, deviceId: 'web-bob-1', nameID: BOB_NAME_ID, sessionIndex: 'idx-alice-1' }),
      alicePassword: (await h.sessions.createOrReuse({ userId: ALICE, tenantId: TENANT, deviceId: 'web-alice-pw', ipHash: 'iphash-0001' })).id,
    };
  }

  const idpRequest = (nameID: string, sessionIndex: string | null, options: Parameters<typeof idp>[0] = {}) =>
    idp(options).getLogoutUrlAsync(
      { issuer: options.issuer ?? IDP_ENTITY, nameID, nameIDFormat: EMAIL_FORMAT, ...(sessionIndex ? { sessionIndex } : {}) } as Profile,
      'idp-relay-1',
      {},
    );

  it("revokes only the named subject's session with that SessionIndex and answers with a signed Success LogoutResponse", async () => {
    const h = harness();
    const s = await seedSessions(h);
    const requestUrl = await idpRequest(ALICE_NAME_ID, 'idx-alice-1');
    const requestId = /ID="([^"]+)"/.exec(inflateParam(requestUrl, 'SAMLRequest'))?.[1];

    const outcome = await h.login.consumeSamlLogout(tenantCtx(TENANT), queryOf(requestUrl), requestCtx);

    expect(sessionRow(h, s.aliceIdx1).revokedAt).toBeInstanceOf(Date);
    expect(sessionRow(h, s.aliceIdx1).revokeReason).toBe('saml_idp_logout');
    expect(tokenOf(h, s.aliceIdx1).status).toBe('REVOKED');
    // Not her other IdP session, not Bob (same SessionIndex value, different subject), not her password session.
    expect(sessionRow(h, s.aliceIdx2).revokedAt).toBeNull();
    expect(tokenOf(h, s.aliceIdx2).status).toBe('ACTIVE');
    expect(sessionRow(h, s.bob).revokedAt).toBeNull();
    expect(sessionRow(h, s.alicePassword).revokedAt).toBeNull();

    // Our answer: to the IdP SLO URL, verified by the IdP with the SP signing certificate.
    const redirectTo = String(outcome.redirectTo);
    expect(redirectTo.startsWith(`${IDP_SLO}?`)).toBe(true);
    expect(paramsOf(redirectTo).RelayState).toBe('idp-relay-1');
    await expect(idp().validateRedirectAsync(paramsOf(redirectTo) as never, queryOf(redirectTo))).resolves.toMatchObject({ loggedOut: true });
    const responseXml = inflateParam(redirectTo, 'SAMLResponse');
    expect(responseXml).toContain(`InResponseTo="${requestId}"`);
    expect(responseXml).toContain('urn:oasis:names:tc:SAML:2.0:status:Success');
    expect(responseXml).toContain(`Destination="${IDP_SLO}"`);

    expect(lastAudit(h)).toMatchObject({
      eventCode: SsoAuditEventCode.SAML_IDP_LOGOUT_COMPLETED,
      outcome: 'SUCCESS',
      safeMetadata: expect.objectContaining({ revokedCount: 1, indexCount: 1 }),
    });
    expect(JSON.stringify(h.prisma.ssoAuditEvent.rows)).not.toContain(ALICE_NAME_ID);
  });

  it("without a SessionIndex, revokes every SAML session of the subject from this configuration", async () => {
    const h = harness();
    const s = await seedSessions(h);
    const outcome = await h.login.consumeSamlLogout(tenantCtx(TENANT), queryOf(await idpRequest(ALICE_NAME_ID, null)), requestCtx);
    expect(outcome.redirectTo).toMatch(/^https:\/\/idp\.acme\.test\/saml\/slo\?/);
    expect(sessionRow(h, s.aliceIdx1).revokedAt).toBeInstanceOf(Date);
    expect(sessionRow(h, s.aliceIdx2).revokedAt).toBeInstanceOf(Date);
    expect(sessionRow(h, s.bob).revokedAt).toBeNull();
    expect(sessionRow(h, s.alicePassword).revokedAt).toBeNull();
    expect(lastAudit(h).safeMetadata).toMatchObject({ revokedCount: 2, indexCount: 0 });
  });

  it('a session issued by another configuration with the same NameID is not touched', async () => {
    const h = harness();
    const foreign = await samlSession(h, {
      userId: ALICE,
      deviceId: 'web-alice-x',
      nameID: ALICE_NAME_ID,
      sessionIndex: 'idx-alice-1',
      configurationId: OTHER_CONFIG,
    });
    // The lookup hashes are configuration-bound already; the revocation also filters on the
    // configuration itself, so even a row carrying THIS configuration's hashes is not touched.
    const sameHashes = await samlSession(h, {
      userId: ALICE,
      deviceId: 'web-alice-y',
      nameID: ALICE_NAME_ID,
      sessionIndex: 'idx-alice-1',
      configurationId: OTHER_CONFIG,
    });
    Object.assign(sessionRow(h, sameHashes), {
      ssoSubjectHash: h.transactions.samlSubjectHash(CONFIG, ALICE_NAME_ID),
      ssoSessionIndexHash: h.transactions.samlSessionIndexHash(CONFIG, 'idx-alice-1'),
    });
    await h.login.consumeSamlLogout(tenantCtx(TENANT), queryOf(await idpRequest(ALICE_NAME_ID, 'idx-alice-1')), requestCtx);
    expect(sessionRow(h, foreign).revokedAt).toBeNull();
    expect(sessionRow(h, sameHashes).revokedAt).toBeNull();
    expect(tokenOf(h, sameHashes).status).toBe('ACTIVE');
  });

  it('with no matching session it still answers Success (revokedCount 0)', async () => {
    const h = harness();
    const outcome = await h.login.consumeSamlLogout(tenantCtx(TENANT), queryOf(await idpRequest('nobody@acme.test', 'idx-0')), requestCtx);
    const redirectTo = String(outcome.redirectTo);
    expect(inflateParam(redirectTo, 'SAMLResponse')).toContain('urn:oasis:names:tc:SAML:2.0:status:Success');
    expect(lastAudit(h).safeMetadata).toMatchObject({ revokedCount: 0 });
  });

  it('a replayed LogoutRequest is refused (the ID is recorded once per tenant and issuer)', async () => {
    const h = harness();
    await seedSessions(h);
    const query = queryOf(await idpRequest(ALICE_NAME_ID, 'idx-alice-1'));
    await expect(h.login.consumeSamlLogout(tenantCtx(TENANT), query, requestCtx)).resolves.toMatchObject({
      redirectTo: expect.stringMatching(/^https:\/\/idp/),
    });
    await expect(h.login.consumeSamlLogout(tenantCtx(TENANT), query, requestCtx)).resolves.toEqual({ redirectTo: null });
    expect(lastAudit(h)).toMatchObject({ eventCode: SsoAuditEventCode.SAML_LOGOUT_REJECTED, reasonCode: SsoReasonCode.SAML_REPLAY });
    expect(h.revokeSpy).toHaveBeenCalledTimes(1);
  });

  describe('a LogoutRequest that does not verify revokes nothing and gets no LogoutResponse', () => {
    async function rejected(build: () => Promise<string>, reason: SsoReasonCode, tenantId: string = TENANT) {
      const h = harness();
      const s = await seedSessions(h);
      const outcome = await h.login.consumeSamlLogout(tenantCtx(tenantId), queryOf(await build()), requestCtx);
      expect(outcome).toEqual({ redirectTo: null });
      expect(h.revokeSpy).not.toHaveBeenCalled();
      for (const id of Object.values(s)) {
        expect(sessionRow(h, id).revokedAt).toBeNull();
        if (tokenOf(h, id)) expect(tokenOf(h, id).status).toBe('ACTIVE');
      }
      expect(lastAudit(h)).toMatchObject({ eventCode: SsoAuditEventCode.SAML_LOGOUT_REJECTED, outcome: 'FAILURE', reasonCode: reason });
    }

    it('signed by an unknown key', () =>
      rejected(() => idpRequest(ALICE_NAME_ID, 'idx-alice-1', { key: KEYS.attackerKey }), SsoReasonCode.SAML_SIGNATURE_INVALID));

    it('unsigned', () =>
      rejected(async () => {
        const url = new URL(await idpRequest(ALICE_NAME_ID, 'idx-alice-1'));
        url.searchParams.delete('Signature');
        url.searchParams.delete('SigAlg');
        return url.toString();
      }, SsoReasonCode.SAML_SIGNATURE_INVALID));

    it('signed with SHA-1', () =>
      rejected(() => idpRequest(ALICE_NAME_ID, 'idx-alice-1', { signatureAlgorithm: 'sha1' }), SsoReasonCode.SAML_SIGNATURE_INVALID));

    it('a signed request whose NameID was swapped afterwards', () =>
      rejected(async () => {
        const genuine = new URL(await idpRequest(BOB_NAME_ID, null));
        const forged = new URL(await idpRequest(ALICE_NAME_ID, null, { key: KEYS.attackerKey }));
        // Bob's genuine signature over Alice's request.
        forged.searchParams.set('Signature', String(genuine.searchParams.get('Signature')));
        return forged.toString();
      }, SsoReasonCode.SAML_SIGNATURE_INVALID));

    it('addressed to another endpoint (Destination)', () =>
      rejected(() => idpRequest(ALICE_NAME_ID, 'idx-alice-1', { destination: 'https://evil.test/slo' }), SsoReasonCode.SAML_DESTINATION_MISMATCH));

    it('from another issuer, even with the configured signing key', () =>
      rejected(() => idpRequest(ALICE_NAME_ID, 'idx-alice-1', { issuer: 'https://other-idp.test/saml' }), SsoReasonCode.SAML_ISSUER_MISMATCH));

    it("on another tenant's host (no SAML configuration there)", () =>
      rejected(() => idpRequest(ALICE_NAME_ID, 'idx-alice-1'), SsoReasonCode.PROVIDER_NOT_CONFIGURED, OTHER_TENANT));

    it('with an unexpected extra parameter', () =>
      rejected(async () => `${queryOf(await idpRequest(ALICE_NAME_ID, 'idx-alice-1'))}&extra=1`, SsoReasonCode.SAML_MALFORMED));
  });

  /** A LogoutRequest the IdP issued at a shifted clock (only Date is faked, while it is built). */
  async function idpRequestIssuedAt(offsetMs: number): Promise<string> {
    jest.useFakeTimers({
      now: Date.now() + offsetMs,
      doNotFake: [
        'hrtime',
        'nextTick',
        'performance',
        'queueMicrotask',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'requestIdleCallback',
        'cancelIdleCallback',
        'setImmediate',
        'clearImmediate',
        'setInterval',
        'clearInterval',
        'setTimeout',
        'clearTimeout',
      ],
    });
    try {
      return await idpRequest(ALICE_NAME_ID, 'idx-alice-1');
    } finally {
      jest.useRealTimers();
    }
  }

  it('a stale or future-dated LogoutRequest is refused (freshness = transaction lifetime + clock skew)', async () => {
    for (const offsetMs of [-60 * 60 * 1000, 60 * 60 * 1000]) {
      const h = harness();
      const s = await seedSessions(h);
      const requestUrl = await idpRequestIssuedAt(offsetMs);
      const issueInstant = new Date(/IssueInstant="([^"]+)"/.exec(inflateParam(requestUrl, 'SAMLRequest'))?.[1] ?? '');
      expect(Math.abs(issueInstant.getTime() - Date.now() - offsetMs)).toBeLessThan(60_000);
      await expect(h.login.consumeSamlLogout(tenantCtx(TENANT), queryOf(requestUrl), requestCtx)).resolves.toEqual({ redirectTo: null });
      expect(lastAudit(h)).toMatchObject({ reasonCode: SsoReasonCode.SAML_EXPIRED });
      expect(sessionRow(h, s.aliceIdx1).revokedAt).toBeNull();
      expect(h.prisma.ssoAssertionReplay.rows).toHaveLength(0);
    }
  });

  it('a request issued just now, within the clock skew, is accepted', async () => {
    const h = harness();
    const config = h.prisma.ssoConfiguration.rows[0] as never;
    const query = queryOf(await idpRequestIssuedAt(30_000));
    await expect(h.saml.verifyLogoutRequest(config, { rawQuery: query })).resolves.toMatchObject({
      nameID: ALICE_NAME_ID,
      sessionIndexes: ['idx-alice-1'],
    });
  });

  it('when Single Logout is not configured, an IdP LogoutRequest is refused without revoking', async () => {
    const h = harness();
    const s = await seedSessions(h);
    Object.assign(h.prisma.ssoConfiguration.rows[0], { sloUrl: null });
    const outcome = await h.login.consumeSamlLogout(tenantCtx(TENANT), queryOf(await idpRequest(ALICE_NAME_ID, 'idx-alice-1')), requestCtx);
    expect(outcome).toEqual({ redirectTo: null });
    expect(sessionRow(h, s.aliceIdx1).revokedAt).toBeNull();
    expect(lastAudit(h)).toMatchObject({ reasonCode: SsoReasonCode.SAML_SLO_NOT_CONFIGURED });
  });
});

describe('session rows', () => {
  it('a later password login on the same device clears the SAML logout data', async () => {
    const h = harness();
    const sessionId = await samlSession(h, { userId: ALICE, deviceId: 'web-alice-1', nameID: ALICE_NAME_ID, sessionIndex: 'idx-alice-1' });
    expect(sessionRow(h, sessionId).ssoSubjectHash).toEqual(expect.any(String));
    await h.sessions.createOrReuse({ userId: ALICE, tenantId: TENANT, deviceId: 'web-alice-1', ipHash: 'iphash-0002' });
    const row = sessionRow(h, sessionId);
    expect(row.authMethod).toBe('PASSWORD');
    expect(row.ssoSubjectHash).toBeNull();
    expect(row.ssoSessionIndexHash).toBeNull();
    expect(row.ssoLogoutContext).toBe(Prisma.DbNull);
    await expect(h.login.logoutUrl(TENANT, ALICE, sessionId)).resolves.toMatchObject({ reason: 'NOT_SSO_SESSION' });
  });

  it('stores the NameID only sealed: the session row and its hashes do not contain it', async () => {
    const h = harness();
    const sessionId = await samlSession(h, { userId: ALICE, deviceId: 'web-alice-1', nameID: ALICE_NAME_ID, sessionIndex: 'idx-alice-1' });
    const row = sessionRow(h, sessionId);
    const visible = JSON.stringify({ ...row, ssoLogoutContext: undefined });
    expect(visible).not.toContain(ALICE_NAME_ID);
    expect(visible).not.toContain('idx-alice-1');
    expect(row.ssoSubjectHash).toBe(h.transactions.samlSubjectHash(CONFIG, ALICE_NAME_ID));
    expect(row.ssoSessionIndexHash).toBe(h.transactions.samlSessionIndexHash(CONFIG, 'idx-alice-1'));
    expect(h.transactions.openSamlLogout(TENANT, CONFIG, row.ssoLogoutContext)).toMatchObject({
      nameID: ALICE_NAME_ID,
      sessionIndex: 'idx-alice-1',
    });
    expect(() => h.transactions.openSamlLogout(OTHER_TENANT, CONFIG, row.ssoLogoutContext)).toThrow();
  });
});

describe('database: the sso_auth_transactions status CHECK admits every status the service writes', () => {
  // The in-memory fixture has no CHECK constraints, so a status the database refuses would only
  // fail in production (PostgreSQL 23514). Migration 20260923089000 closed the set to
  // PENDING/VERIFIED/CONSUMED/REJECTED; round 8 widens it for LOGOUT_PENDING in its own migration.
  const migrationsDir = join(__dirname, '..', '..', '..', '..', 'prisma', 'migrations');
  const constraintValues = (sql: string): string[][] =>
    [...sql.matchAll(/"sso_auth_transactions_status_check"\s*CHECK\s*\(\s*"status"\s+IN\s*\(([^)]*)\)\s*\)/g)].map(
      (match) => [...match[1].matchAll(/'([A-Z_]+)'/g)].map((value) => value[1]),
    );
  const effectiveStatuses = (): string[] => {
    let current: string[] = [];
    for (const dir of readdirSync(migrationsDir).filter((name) => /^\d{14}_/.test(name)).sort()) {
      for (const values of constraintValues(readFileSync(join(migrationsDir, dir, 'migration.sql'), 'utf8'))) {
        current = values;
      }
    }
    return current;
  };
  const writtenStatuses = (): string[] => {
    const source = readFileSync(join(__dirname, 'sso-transaction.service.ts'), 'utf8');
    const found = new Set<string>();
    for (const match of source.matchAll(/status: '([A-Z_]+)'/g)) found.add(match[1]);
    for (const match of source.matchAll(/status: \{ in: \[([^\]]*)\]/g)) {
      for (const value of match[1].matchAll(/'([A-Z_]+)'/g)) found.add(value[1]);
    }
    return [...found].sort();
  };

  it('finds the constraint and the status literals at all (the guard is not silently blind)', () => {
    expect(effectiveStatuses().length).toBeGreaterThanOrEqual(4);
    expect(writtenStatuses()).toEqual(expect.arrayContaining(['PENDING', 'VERIFIED', 'CONSUMED', 'REJECTED', 'LOGOUT_PENDING']));
  });

  it('every status literal in SsoTransactionService is allowed by the newest constraint', () => {
    const allowed = effectiveStatuses();
    expect(writtenStatuses().filter((status) => !allowed.includes(status))).toEqual([]);
  });

  it('the set stays closed and the historical migration is untouched (replaced, not edited)', () => {
    expect(effectiveStatuses().sort()).toEqual(['CONSUMED', 'LOGOUT_PENDING', 'PENDING', 'REJECTED', 'VERIFIED']);
    const historical = readFileSync(join(migrationsDir, '20260923089000_sso_authorization_code_flow', 'migration.sql'), 'utf8');
    expect(constraintValues(historical)).toEqual([['PENDING', 'VERIFIED', 'CONSUMED', 'REJECTED']]);
    const round8 = readFileSync(join(migrationsDir, '20261002020000_saml_single_logout', 'migration.sql'), 'utf8');
    expect(round8).toContain('DROP CONSTRAINT "sso_auth_transactions_status_check"');
  });
});
