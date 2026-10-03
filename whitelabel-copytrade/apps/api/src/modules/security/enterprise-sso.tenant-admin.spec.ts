import { BadRequestException } from '@nestjs/common';
import { Permission, SYSTEM_ROLE_DEFINITIONS, SystemRole } from '@wlct/shared-types';

import { PERMISSIONS_KEY, PERMISSIONS_MODE_KEY } from '../../common/constants/metadata.constants';
import { EnterpriseSsoService } from './enterprise-sso.service';
import { SecurityController } from './security.controller';
import { SsoProvider } from './security.types';

/**
 * Round 7 D2: SSO is configured by the tenant administrator.
 *
 * The configuration routes used to require PLATFORM_MANAGE in addition to
 * SSO_MANAGE + SECURITY_POLICY_WRITE (all-of), which made SSO a super-admin
 * feature even though the TENANT_ADMIN matrix carries both SSO permissions.
 * Opening the routes makes the service responsible for not letting a tenant
 * lock its own administrators out: an ENFORCED configuration can only be left
 * in place by a tenant actor who has signed in through that IdP (under the
 * issuer the configuration will have). Platform staff are exempt; turning
 * enforcement off is never blocked.
 */

const TENANT = '11111111-1111-4111-8111-111111111111';
const ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CONFIG_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ISSUER = 'https://idp.acme.test';

function existingOidc(overrides: Record<string, unknown> = {}) {
  return {
    id: CONFIG_ID,
    tenantId: TENANT,
    providerType: 'OIDC',
    state: 'ENABLED',
    issuer: ISSUER,
    audience: null,
    clientId: 'client-1',
    metadataUrl: null,
    entityId: null,
    acsUrl: null,
    ssoUrl: null,
    certificate: null,
    allowedDomains: ['acme.test'],
    enforced: false,
    jitEnabled: false,
    defaultRole: null,
    discoveryUrl: null,
    jwksUrl: null,
    scopes: [],
    isActive: true,
    createdById: ADMIN,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    clientSecretCiphertext: { ciphertext: 'x' },
    tokenEndpointAuthMethod: 'client_secret_basic',
    redirectUri: 'https://acme.app.test/api/auth/sso/callback',
    pkceRequired: true,
    clockSkewSec: 60,
    maxAuthAgeSec: null,
    allowedAlgorithms: [],
    wantResponseSigned: false,
    ...overrides,
  };
}

function build(options: { existing?: Record<string, unknown> | null; link?: { issuer: string } | null } = {}) {
  const existing = options.existing === undefined ? existingOidc() : options.existing;
  const prisma: any = {
    ssoConfiguration: {
      findUnique: jest.fn(async () => existing),
      update: jest.fn(async ({ data }: any) => ({ ...existing, ...data })),
      create: jest.fn(async ({ data }: any) => ({ ...existingOidc(), ...data })),
    },
    ssoIdentity: {
      findFirst: jest.fn(async ({ where }: any) =>
        options.link && where.tenantId === TENANT && where.configurationId === CONFIG_ID && where.userId === ADMIN
          ? options.link
          : null,
      ),
    },
  };
  const eventService: any = { record: jest.fn(async () => undefined) };
  const auditService: any = { record: jest.fn(async () => undefined) };
  const crypto: any = { encrypt: jest.fn(() => ({ ciphertext: 'enc' })) };
  const unused: any = {};
  const service = new EnterpriseSsoService(prisma, unused, unused, eventService, auditService, crypto, unused);
  return { service, prisma };
}

const base = { tenantId: TENANT, providerType: SsoProvider.OIDC, actorId: ADMIN };

describe('EnterpriseSsoService enforcement lock-out guard (round 7)', () => {
  it('a tenant admin cannot create and enforce in one step', async () => {
    const h = build({ existing: null });
    await expect(
      h.service.configureSso({
        ...base,
        issuer: ISSUER,
        clientId: 'client-1',
        clientSecret: 'secret',
        redirectUri: 'https://acme.app.test/api/auth/sso/callback',
        enforced: true,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(h.prisma.ssoConfiguration.create).not.toHaveBeenCalled();
  });

  it('a tenant admin can create without enforcement', async () => {
    const h = build({ existing: null });
    const view = await h.service.configureSso({
      ...base,
      issuer: ISSUER,
      clientId: 'client-1',
      clientSecret: 'secret',
      redirectUri: 'https://acme.app.test/api/auth/sso/callback',
    });
    expect(view.enforced).toBe(false);
    expect(h.prisma.ssoConfiguration.create).toHaveBeenCalledTimes(1);
  });

  it('a tenant admin who has not signed in through the IdP cannot enforce it', async () => {
    const h = build({ link: null });
    await expect(h.service.configureSso({ ...base, enforced: true })).rejects.toThrow(/signed in through this identity provider/);
    expect(h.prisma.ssoConfiguration.update).not.toHaveBeenCalled();
  });

  it('a tenant admin with a linked identity can enforce it', async () => {
    const h = build({ link: { issuer: ISSUER } });
    const view = await h.service.configureSso({ ...base, enforced: true });
    expect(view).toMatchObject({ enforced: true, state: 'ENFORCED' });
    expect(h.prisma.ssoIdentity.findFirst).toHaveBeenCalledWith({
      where: { tenantId: TENANT, configurationId: CONFIG_ID, userId: ADMIN },
      select: { issuer: true },
    });
  });

  it('changing the issuer of an enforced configuration needs a link under the NEW issuer', async () => {
    const h = build({ existing: existingOidc({ enforced: true, state: 'ENFORCED' }), link: { issuer: ISSUER } });
    await expect(h.service.configureSso({ ...base, issuer: 'https://other-idp.acme.test' })).rejects.toThrow(BadRequestException);
    expect(h.prisma.ssoConfiguration.update).not.toHaveBeenCalled();
    // A harmless change under the same issuer is accepted.
    await expect(h.service.configureSso({ ...base, jitEnabled: true })).resolves.toMatchObject({ jitEnabled: true });
  });

  it('turning enforcement off is never blocked', async () => {
    const h = build({ existing: existingOidc({ enforced: true, state: 'ENFORCED' }), link: null });
    await expect(h.service.configureSso({ ...base, enforced: false })).resolves.toMatchObject({ enforced: false, state: 'ENABLED' });
  });

  it('platform staff are exempt (break-glass)', async () => {
    const h = build({ link: null });
    await expect(h.service.configureSso({ ...base, enforced: true, actorIsPlatform: true })).resolves.toMatchObject({ enforced: true });
    expect(h.prisma.ssoIdentity.findFirst).not.toHaveBeenCalled();
  });
});

describe('SecurityController SSO route permissions (round 7)', () => {
  const metadata = (method: keyof SecurityController) => {
    const handler = SecurityController.prototype[method] as unknown as object;
    return {
      permissions: Reflect.getMetadata(PERMISSIONS_KEY, handler) as string[],
      mode: Reflect.getMetadata(PERMISSIONS_MODE_KEY, handler) as string,
    };
  };

  it.each(['configureSaml', 'configureOidc', 'updateSsoConfig', 'disableSso'] as const)(
    '%s requires SSO_MANAGE + SECURITY_POLICY_WRITE and no longer PLATFORM_MANAGE',
    (method) => {
      expect(metadata(method)).toEqual({
        permissions: [Permission.SSO_MANAGE, Permission.SECURITY_POLICY_WRITE],
        mode: 'all',
      });
    },
  );

  it('listing providers needs SSO_READ; cross-tenant reads stay platform-only in the handler', async () => {
    expect(metadata('listSsoProviders')).toEqual({ permissions: [Permission.SSO_READ], mode: 'all' });
    const listTenantProviders = jest.fn(async () => []);
    const unused: any = {};
    const controller = new SecurityController(
      unused,
      unused,
      { listTenantProviders } as any,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
    );
    const tenantAdmin = { isPlatformUser: false, permissions: [Permission.SSO_READ] };
    await expect(controller.listSsoProviders(TENANT, '99999999-9999-4999-8999-999999999999', tenantAdmin)).rejects.toThrow(
      'Cross-tenant access denied',
    );
    await expect(controller.listSsoProviders(TENANT, undefined, tenantAdmin)).resolves.toEqual([]);
    expect(listTenantProviders).toHaveBeenCalledWith(TENANT);
  });

  it('the TENANT_ADMIN matrix holds every permission the configuration routes require', () => {
    const tenantAdmin = SYSTEM_ROLE_DEFINITIONS.find((role) => role.key === SystemRole.TENANT_ADMIN);
    expect(tenantAdmin?.permissions).toEqual(
      expect.arrayContaining([Permission.SSO_MANAGE, Permission.SECURITY_POLICY_WRITE, Permission.SSO_READ]),
    );
  });

  it('the controller passes actorIsPlatform from the authenticated principal, never from the body', async () => {
    const configureSso = jest.fn(async (input: any) => input);
    const unused: any = {};
    const controller = new SecurityController(
      unused,
      { configureSso } as any,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      { hashIp: () => 'h' } as any,
    );
    const req = (isPlatformUser: boolean) => ({ ip: '10.0.0.1', headers: {}, user: { isPlatformUser } });
    const dto: any = { issuer: ISSUER, clientId: 'c', redirectUri: 'https://x.test/cb', actorIsPlatform: true };
    await controller.configureOidc(dto, TENANT, { id: ADMIN }, req(false));
    await controller.configureOidc(dto, TENANT, { id: ADMIN }, req(true));
    expect(configureSso.mock.calls.map(([input]) => input.actorIsPlatform)).toEqual([false, true]);
  });
});
