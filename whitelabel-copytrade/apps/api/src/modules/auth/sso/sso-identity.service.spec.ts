import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';

import { SsoAuthError, SsoReasonCode } from '../../security/sso-flow.types';
import type { VerifiedSsoIdentity } from '../../security/sso-provider.interface';
import {
  createInMemorySsoPrisma,
  fakeCryptoService,
  type InMemorySsoPrisma,
} from './__fixtures__/in-memory-sso-prisma.fixture-spec';
import { SsoIdentityService } from './sso-identity.service';

/**
 * Part 11 [24]-[27]: mapping a VERIFIED (issuer, subject) to exactly one user
 * of the request tenant. Email is only a linking aid for an unlinked subject,
 * and only when the IdP verified it and the operator pinned the domains.
 */

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';
const CONFIG = '33333333-3333-4333-8333-333333333333';
const ISSUER = 'https://idp.acme.test';

function identity(overrides: Partial<VerifiedSsoIdentity> = {}): VerifiedSsoIdentity {
  return {
    providerType: 'OIDC',
    issuer: ISSUER,
    subject: 'subject-1',
    email: 'new.person@acme.test',
    emailVerified: true,
    firstName: 'New',
    lastName: 'Person',
    displayName: 'New Person',
    ...overrides,
  } as VerifiedSsoIdentity;
}

function mapping(overrides: Record<string, unknown> = {}) {
  return {
    id: CONFIG,
    tenantId: TENANT,
    providerType: 'OIDC' as const,
    allowedDomains: ['acme.test'],
    jitEnabled: true,
    defaultRole: null as string | null,
    ...overrides,
  };
}

async function reason(promise: Promise<unknown>): Promise<SsoReasonCode> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(SsoAuthError);
    return (error as SsoAuthError).reason;
  }
  throw new Error('expected a refusal');
}

describe('SsoIdentityService (Part 11)', () => {
  let prisma: InMemorySsoPrisma;
  let crypto: ReturnType<typeof fakeCryptoService>;
  let roles: { findByKeys: jest.Mock };
  let policies: { getEffectivePolicy: jest.Mock };
  let service: SsoIdentityService;

  const addUser = (row: Record<string, unknown>): Record<string, any> & { id: string } => {
    const user: Record<string, any> & { id: string } = {
      id: randomUUID(),
      tenantId: TENANT,
      status: 'ACTIVE',
      deletedAt: null,
      isPlatformUser: false,
      ...row,
    };
    if (typeof user.email === 'string') user.emailIndex = crypto.blindIndex(user.email);
    prisma.user.rows.push(user);
    return user;
  };
  const addLink = (userId: string, subject: string, tenantId = TENANT) =>
    prisma.ssoIdentity.rows.push({
      id: randomUUID(),
      tenantId,
      userId,
      configurationId: CONFIG,
      providerType: 'OIDC',
      issuer: ISSUER,
      subject,
      linkedVia: 'JIT',
    });

  beforeEach(() => {
    prisma = createInMemorySsoPrisma();
    crypto = fakeCryptoService();
    roles = {
      findByKeys: jest.fn(async (_t: string, keys: string[]) =>
        keys.map((k) => ({ id: `role-${k}`, key: k })),
      ),
    };
    policies = { getEffectivePolicy: jest.fn(async () => ({ jitProvisioning: false })) };
    service = new SsoIdentityService(
      prisma as never,
      crypto as never,
      { hash: jest.fn(async () => '$argon2id$unusable') } as never,
      roles as never,
      policies as never,
    );
  });

  it('[24] a linked subject maps to its user, even when the IdP now asserts another (or no) email', async () => {
    const user = addUser({ email: 'alice@acme.test' });
    addLink(user.id, 'subject-1');
    await expect(
      service.resolveUser(TENANT, mapping(), identity({ email: 'someone.else@acme.test' })),
    ).resolves.toEqual({ userId: user.id, resolution: 'LINKED' });
    await expect(
      service.resolveUser(
        TENANT,
        mapping(),
        identity({ email: null, emailVerified: false } as never),
      ),
    ).resolves.toMatchObject({ userId: user.id });
    expect(prisma.ssoIdentity.rows[0].lastLoginAt).toBeInstanceOf(Date);
  });

  it('[24] email alone never authenticates: an unverified email or a domain outside the pinned list cannot link', async () => {
    addUser({ email: 'alice@acme.test' });
    expect(
      await reason(
        service.resolveUser(
          TENANT,
          mapping(),
          identity({ subject: 'new', email: 'alice@acme.test', emailVerified: false }),
        ),
      ),
    ).toBe(SsoReasonCode.EMAIL_NOT_VERIFIED);
    expect(
      await reason(
        service.resolveUser(TENANT, mapping(), identity({ subject: 'new', email: null } as never)),
      ),
    ).toBe(SsoReasonCode.EMAIL_MISSING);
    expect(
      await reason(
        service.resolveUser(
          TENANT,
          mapping(),
          identity({ subject: 'new', email: 'alice@evil.test' }),
        ),
      ),
    ).toBe(SsoReasonCode.EMAIL_DOMAIN_NOT_ALLOWED);
    // Without pinned domains, an existing account is never auto-linked.
    expect(
      await reason(
        service.resolveUser(
          TENANT,
          mapping({ allowedDomains: [] }),
          identity({ subject: 'new', email: 'alice@acme.test' }),
        ),
      ),
    ).toBe(SsoReasonCode.IDENTITY_LINK_REQUIRED);
    expect(prisma.ssoIdentity.rows).toHaveLength(0);
  });

  it('[24] a verified email in a pinned domain links an existing unlinked account once', async () => {
    const user = addUser({ email: 'alice@acme.test' });
    await expect(
      service.resolveUser(
        TENANT,
        mapping(),
        identity({ subject: 'alice-sub', email: 'Alice@ACME.test' }),
      ),
    ).resolves.toEqual({ userId: user.id, resolution: 'LINKED_BY_VERIFIED_EMAIL' });
    expect(prisma.ssoIdentity.rows).toEqual([
      expect.objectContaining({
        tenantId: TENANT,
        userId: user.id,
        subject: 'alice-sub',
        linkedVia: 'VERIFIED_EMAIL',
      }),
    ]);
    // From now on the subject is what maps.
    await expect(
      service.resolveUser(
        TENANT,
        mapping(),
        identity({ subject: 'alice-sub', email: 'renamed@acme.test' }),
      ),
    ).resolves.toMatchObject({ resolution: 'LINKED' });
  });

  it("[25] tenant mismatch: a configuration of another tenant, a link in another tenant, or a link to another tenant's user", async () => {
    expect(
      await reason(service.resolveUser(TENANT, mapping({ tenantId: OTHER }), identity())),
    ).toBe(SsoReasonCode.TENANT_MISMATCH);

    const foreign = addUser({ email: 'carol@acme.test', tenantId: OTHER });
    addLink(foreign.id, 'carol-sub', OTHER);
    // The tenant-B link is invisible to tenant A; with JIT off the login stops.
    expect(
      await reason(
        service.resolveUser(
          TENANT,
          mapping({ jitEnabled: false }),
          identity({ subject: 'carol-sub', email: 'carol@acme.test' }),
        ),
      ),
    ).toBe(SsoReasonCode.JIT_DISABLED);
    // A (corrupt) tenant-A link pointing at a tenant-B user is refused.
    addLink(foreign.id, 'corrupt-sub', TENANT);
    expect(
      await reason(service.resolveUser(TENANT, mapping(), identity({ subject: 'corrupt-sub' }))),
    ).toBe(SsoReasonCode.USER_TENANT_MISMATCH);
    expect(await reason(service.assertUserUsable(TENANT, foreign.id))).toBe(
      SsoReasonCode.USER_TENANT_MISMATCH,
    );
  });

  it('[26] duplicate or ambiguous mapping: an account already linked to another subject, and a concurrent JIT race', async () => {
    const user = addUser({ email: 'alice@acme.test' });
    addLink(user.id, 'alice-original');
    expect(
      await reason(
        service.resolveUser(
          TENANT,
          mapping(),
          identity({ subject: 'impostor', email: 'alice@acme.test' }),
        ),
      ),
    ).toBe(SsoReasonCode.IDENTITY_CONFLICT);

    // Race: another request linked the same subject between our lookup and our insert.
    prisma.ssoIdentity.failNextCreate = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      { code: 'P2002', clientVersion: 'test' },
    );
    expect(
      await reason(
        service.resolveUser(
          TENANT,
          mapping(),
          identity({ subject: 'racing-sub', email: 'racer@acme.test' }),
        ),
      ),
    ).toBe(SsoReasonCode.IDENTITY_CONFLICT);

    // Race on the user's email index during JIT.
    prisma.user.failNextCreate = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      { code: 'P2002', clientVersion: 'test' },
    );
    expect(
      await reason(
        service.resolveUser(
          TENANT,
          mapping(),
          identity({ subject: 'racing-2', email: 'racer2@acme.test' }),
        ),
      ),
    ).toBe(SsoReasonCode.IDENTITY_CONFLICT);

    // A real unique-constraint collision from the store (same subject linked twice) is also a conflict.
    const other = addUser({ email: 'bob@acme.test' });
    await expect(
      (service as unknown as { createLink: (...a: unknown[]) => Promise<void> }).createLink(
        TENANT,
        mapping(),
        identity({ subject: 'alice-original' }),
        other.id,
        'x',
        'VERIFIED_EMAIL',
      ),
    ).rejects.toMatchObject({ reason: SsoReasonCode.IDENTITY_CONFLICT });
  });

  it('[27] suspended, deactivated, locked or deleted users are refused (linked or by email)', async () => {
    for (const status of ['SUSPENDED', 'DEACTIVATED', 'LOCKED']) {
      const user = addUser({ email: `${status.toLowerCase()}@acme.test`, status });
      addLink(user.id, `sub-${status}`);
      expect(
        await reason(
          service.resolveUser(TENANT, mapping(), identity({ subject: `sub-${status}` })),
        ),
      ).toBe(SsoReasonCode.ACCOUNT_UNAVAILABLE);
      expect(
        await reason(
          service.resolveUser(
            TENANT,
            mapping(),
            identity({ subject: `new-${status}`, email: `${status.toLowerCase()}@acme.test` }),
          ),
        ),
      ).toBe(SsoReasonCode.ACCOUNT_UNAVAILABLE);
    }
    const deleted = addUser({ email: 'gone@acme.test', deletedAt: new Date() });
    addLink(deleted.id, 'sub-gone');
    expect(
      await reason(service.resolveUser(TENANT, mapping(), identity({ subject: 'sub-gone' }))),
    ).toBe(SsoReasonCode.ACCOUNT_UNAVAILABLE);
    expect(await reason(service.assertUserUsable(TENANT, randomUUID()))).toBe(
      SsoReasonCode.ACCOUNT_UNAVAILABLE,
    );
  });

  it('platform accounts are never auto-linked by email', async () => {
    addUser({ email: 'root@acme.test', isPlatformUser: true });
    expect(
      await reason(
        service.resolveUser(
          TENANT,
          mapping(),
          identity({ subject: 'root-sub', email: 'root@acme.test' }),
        ),
      ),
    ).toBe(SsoReasonCode.IDENTITY_LINK_REQUIRED);
  });

  it('JIT provisioning only when enabled; the role is clamped to FOLLOWER/TRADER and the password is unusable', async () => {
    expect(
      await reason(service.resolveUser(TENANT, mapping({ jitEnabled: false }), identity())),
    ).toBe(SsoReasonCode.JIT_DISABLED);
    const created = await service.resolveUser(
      TENANT,
      mapping({ defaultRole: 'SUPER_ADMIN' }),
      identity(),
    );
    expect(created.resolution).toBe('JIT_CREATED');
    expect(roles.findByKeys).toHaveBeenLastCalledWith(TENANT, ['FOLLOWER']);
    const user = prisma.user.rows.find((u) => u.id === created.userId)!;
    expect(user).toMatchObject({
      tenantId: TENANT,
      email: 'new.person@acme.test',
      status: 'ACTIVE',
      passwordHash: '$argon2id$unusable',
    });
    expect(prisma.userRole.rows).toEqual([
      expect.objectContaining({
        userId: created.userId,
        roleId: 'role-FOLLOWER',
        tenantId: TENANT,
      }),
    ]);
    expect(prisma.ssoIdentity.rows).toEqual([
      expect.objectContaining({ userId: created.userId, subject: 'subject-1', linkedVia: 'JIT' }),
    ]);
    await service.resolveUser(
      TENANT,
      mapping({ defaultRole: 'TRADER' }),
      identity({ subject: 'subject-2', email: 'trader@acme.test' }),
    );
    expect(roles.findByKeys).toHaveBeenLastCalledWith(TENANT, ['TRADER']);
  });

  it('refuses an identity without issuer or subject', async () => {
    expect(await reason(service.resolveUser(TENANT, mapping(), identity({ subject: '' })))).toBe(
      SsoReasonCode.CLAIMS_MISSING,
    );
  });
});
