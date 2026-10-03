import { SsoLoginService } from './sso-login.service';
import { SessionService } from '../services/session.service';
import { OidcProviderService, type OidcConfigRecord } from '../../security/oidc-provider.service';
import { SamlProviderService } from '../../security/saml-provider.service';
import { SsoAuthError, SsoReasonCode } from '../../security/sso-flow.types';

/**
 * Round 7 D3: logout and the IdP session.
 *
 *  - every session records how its latest login was made (PASSWORD, SSO_OIDC,
 *    SSO_SAML) and which SSO configuration issued it; a device session that is
 *    reused by a later password login is reset to PASSWORD;
 *  - POST /v1/auth/sso/logout-url returns the OIDC end-session URL only for the
 *    caller's own, live, OIDC-issued session whose configuration is still the
 *    tenant's active one; password sessions get none; a SAML session whose
 *    configuration has no Single Logout gets the explicit
 *    SAML_SLO_NOT_CONFIGURED refusal (round 8: SAML Single Logout itself is
 *    covered by saml-single-logout.spec.ts); a provider problem never throws
 *    (logout must always complete locally);
 *  - the SAML provider never hands out the IdP's SSO URL as a "logout URL".
 */

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '33333333-3333-4333-8333-333333333333';
const SESSION = '44444444-4444-4444-8444-444444444444';
const CONFIG_ID = '22222222-2222-4222-8222-222222222222';

function loginService(session: { authMethod: string; ssoConfigurationId: string | null } | null) {
  const prisma: any = { userSession: { findFirst: jest.fn(async () => session) } };
  const oidc: any = { getLogoutUrl: jest.fn(async () => 'https://idp.acme.test/logout?client_id=app') };
  const unused: any = {};
  const audit: any = {};
  const service = new SsoLoginService(prisma, unused, oidc, unused, unused, unused, audit);
  return { service, prisma, oidc };
}

describe('SsoLoginService.logoutUrl', () => {
  it('returns the OIDC end-session URL for an OIDC-issued session, bound to its configuration', async () => {
    const h = loginService({ authMethod: 'SSO_OIDC', ssoConfigurationId: CONFIG_ID });
    await expect(h.service.logoutUrl(TENANT, USER, SESSION)).resolves.toEqual({
      logoutUrl: 'https://idp.acme.test/logout?client_id=app',
      providerType: 'OIDC',
      reason: null,
    });
    expect(h.oidc.getLogoutUrl).toHaveBeenCalledWith(TENANT, '/login', CONFIG_ID);
    expect(h.prisma.userSession.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: SESSION, userId: USER, tenantId: TENANT, revokedAt: null } }),
    );
  });

  it('a password session gets no IdP URL', async () => {
    const h = loginService({ authMethod: 'PASSWORD', ssoConfigurationId: null });
    await expect(h.service.logoutUrl(TENANT, USER, SESSION)).resolves.toEqual({ logoutUrl: null, providerType: null, reason: 'NOT_SSO_SESSION' });
    expect(h.oidc.getLogoutUrl).not.toHaveBeenCalled();
  });

  it('a revoked, foreign or unknown session gets no IdP URL', async () => {
    const h = loginService(null);
    await expect(h.service.logoutUrl(TENANT, USER, SESSION)).resolves.toMatchObject({ logoutUrl: null, reason: 'NOT_SSO_SESSION' });
    expect(h.oidc.getLogoutUrl).not.toHaveBeenCalled();
  });

  it('a SAML session whose configuration has no Single Logout gets the explicit refusal, not a URL', async () => {
    const prisma: any = {
      userSession: {
        findFirst: jest.fn(async () => ({
          authMethod: 'SSO_SAML',
          ssoConfigurationId: CONFIG_ID,
          deviceId: 'web-device-0001',
          ssoLogoutContext: null,
        })),
      },
      ssoConfiguration: {
        findFirst: jest.fn(async () => ({
          id: CONFIG_ID,
          tenantId: TENANT,
          providerType: 'SAML',
          state: 'ENABLED',
          isActive: true,
          sloUrl: null,
          logoutCallbackUrl: null,
          spSigningKeyCiphertext: null,
          spSigningCertificate: null,
        })),
      },
    };
    const saml = new SamlProviderService(prisma);
    // The login half of the configuration is usable; only Single Logout is missing.
    jest.spyOn(saml, 'assertConfigUsable').mockReturnValue(['-----BEGIN CERTIFICATE-----']);
    const oidc: any = { getLogoutUrl: jest.fn() };
    const service = new SsoLoginService(prisma, {} as never, oidc, saml, {} as never, {} as never, {} as never);
    await expect(service.logoutUrl(TENANT, USER, SESSION)).resolves.toEqual({
      logoutUrl: null,
      providerType: 'SAML',
      reason: 'SAML_SLO_NOT_CONFIGURED',
    });
    expect(prisma.ssoConfiguration.findFirst).toHaveBeenCalledWith({
      where: { id: CONFIG_ID, tenantId: TENANT, providerType: 'SAML' },
    });
    expect(oidc.getLogoutUrl).not.toHaveBeenCalled();
  });

  it('a provider problem is reported, never thrown (local logout still completes)', async () => {
    const h = loginService({ authMethod: 'SSO_OIDC', ssoConfigurationId: CONFIG_ID });
    h.oidc.getLogoutUrl.mockRejectedValueOnce(new SsoAuthError(SsoReasonCode.CONFIG_INVALID, 'no end_session_endpoint'));
    await expect(h.service.logoutUrl(TENANT, USER, SESSION)).resolves.toEqual({ logoutUrl: null, providerType: 'OIDC', reason: 'CONFIG_INVALID' });
    h.oidc.getLogoutUrl.mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(h.service.logoutUrl(TENANT, USER, SESSION)).resolves.toEqual({ logoutUrl: null, providerType: 'OIDC', reason: 'PROVIDER_UNAVAILABLE' });
  });
});

describe('OidcProviderService.getLogoutUrl (RP-Initiated Logout 1.0)', () => {
  function oidc(config: Partial<OidcConfigRecord> | null, endSessionEndpoint: string | null = 'https://idp.acme.test/oidc/logout') {
    const prisma: any = {
      ssoConfiguration: {
        findFirst: jest.fn(async () =>
          config === null
            ? null
            : {
                id: CONFIG_ID,
                tenantId: TENANT,
                providerType: 'OIDC',
                state: 'ENABLED',
                isActive: true,
                issuer: 'https://idp.acme.test',
                clientId: 'acme-app',
                redirectUri: 'https://acme.app.test/api/auth/sso/callback',
                ...config,
              },
        ),
      },
    };
    const service = new OidcProviderService(prisma, {} as never);
    jest.spyOn(service, 'resolveEndpoints').mockResolvedValue({
      issuer: 'https://idp.acme.test',
      authorizationEndpoint: 'https://idp.acme.test/oidc/auth',
      tokenEndpoint: 'https://idp.acme.test/oidc/token',
      jwksUri: 'https://idp.acme.test/oidc/jwks',
      endSessionEndpoint,
    } as never);
    return service;
  }

  it('builds the end-session URL with client_id and a post-logout redirect on the web origin', async () => {
    const url = new URL(await oidc({}).getLogoutUrl(TENANT, '/login', CONFIG_ID));
    expect(url.origin + url.pathname).toBe('https://idp.acme.test/oidc/logout');
    expect(url.searchParams.get('client_id')).toBe('acme-app');
    expect(url.searchParams.get('post_logout_redirect_uri')).toBe('https://acme.app.test/login');
  });

  it('refuses when the issuing configuration was replaced, or the configuration is disabled', async () => {
    await expect(oidc({ id: '55555555-5555-4555-8555-555555555555' }).getLogoutUrl(TENANT, '/login', CONFIG_ID)).rejects.toMatchObject({
      reason: SsoReasonCode.PROVIDER_NOT_CONFIGURED,
    });
    await expect(oidc({ state: 'DISABLED' }).getLogoutUrl(TENANT, '/login', CONFIG_ID)).rejects.toMatchObject({
      reason: SsoReasonCode.PROVIDER_NOT_CONFIGURED,
    });
    await expect(oidc(null).getLogoutUrl(TENANT, '/login', CONFIG_ID)).rejects.toMatchObject({ reason: SsoReasonCode.PROVIDER_NOT_CONFIGURED });
  });

  it('refuses when the OP publishes no end_session_endpoint, and never redirects off-origin', async () => {
    await expect(oidc({}, null).getLogoutUrl(TENANT, '/login', CONFIG_ID)).rejects.toMatchObject({ reason: SsoReasonCode.CONFIG_INVALID });
    const url = new URL(await oidc({}).getLogoutUrl(TENANT, '//evil.test/x', CONFIG_ID));
    expect(url.searchParams.get('post_logout_redirect_uri')).toBeNull();
  });
});

describe('SamlProviderService.getLogoutUrl', () => {
  it('is an explicit refusal (a SAML LogoutRequest needs the session context; see logout-url)', async () => {
    const saml = new SamlProviderService({} as never);
    await expect(saml.getLogoutUrl(TENANT, '/login')).rejects.toBeInstanceOf(SsoAuthError);
    await expect(saml.getLogoutUrl(TENANT, '/login')).rejects.toMatchObject({ reason: SsoReasonCode.CONFIG_INVALID });
  });
});

describe('SessionService records the auth method of each login', () => {
  function sessions(existing: { id: string } | null) {
    const prisma: any = {
      userSession: {
        findFirst: jest.fn(async () => existing),
        findMany: jest.fn(async () => []),
        update: jest.fn(async () => ({})),
        create: jest.fn(async () => ({ id: SESSION })),
      },
    };
    const config: any = { refreshTokenTtlSeconds: 3600, maxActiveSessionsPerUser: 10 };
    const logger: any = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { service: new SessionService(prisma, config, logger), prisma };
  }
  const base = { userId: USER, tenantId: TENANT, deviceId: 'dev-1', ipHash: 'h' };

  it('a new SSO session stores SSO_OIDC and the issuing configuration', async () => {
    const h = sessions(null);
    await h.service.createOrReuse({ ...base, authMethod: 'SSO_OIDC', ssoConfigurationId: CONFIG_ID });
    expect(h.prisma.userSession.create.mock.calls[0][0].data).toMatchObject({ authMethod: 'SSO_OIDC', ssoConfigurationId: CONFIG_ID });
  });

  it('a password login that reuses an SSO device session resets it to PASSWORD', async () => {
    const h = sessions({ id: SESSION });
    await h.service.createOrReuse(base);
    expect(h.prisma.userSession.update.mock.calls[0][0].data).toMatchObject({ authMethod: 'PASSWORD', ssoConfigurationId: null });
  });
});
