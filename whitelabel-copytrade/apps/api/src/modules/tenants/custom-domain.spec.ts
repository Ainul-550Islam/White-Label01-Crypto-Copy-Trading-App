// # Responsibility: proves custom-domain tenant isolation, real DNS TXT proof, persisted expiry/attempt limits, and fail-closed resolver behavior.
import {
  CustomDomainVerificationService,
  DomainVerificationStatus,
  type CustomDomainTxtResolver,
} from '../billing/saas-admin/custom-domain-verification.service';
import { CustomDomainService } from '../billing/saas-admin/custom-domain.service';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const DOMAIN = 'brand.example.com';
const TOKEN = 'a'.repeat(64);
const EXPECTED_TXT = `wlct-verification=${TOKEN}`;

function pendingDomain(overrides: Record<string, unknown> = {}) {
  return {
    id: 'domain-record-a',
    tenantId: TENANT_A,
    domain: DOMAIN,
    isPrimary: true,
    status: 'PENDING_DNS',
    verificationToken: TOKEN,
    verificationAttempts: 0,
    verificationExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    verifiedAt: null,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    ...overrides,
  };
}

function buildVerificationService() {
  const prisma = {
    tenantDomain: {
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const audit = {
    logDomainVerificationStarted: jest.fn().mockResolvedValue(undefined),
    logDomainVerified: jest.fn().mockResolvedValue(undefined),
    logDomainVerificationFailed: jest.fn().mockResolvedValue(undefined),
  };
  const resolver: CustomDomainTxtResolver = {
    resolveTxt: jest.fn().mockResolvedValue([]),
  };
  const service = new CustomDomainVerificationService(
    prisma as never,
    audit as never,
    undefined,
    resolver,
  );
  return { service, prisma, audit, resolver };
}

describe('custom-domain tenant isolation and DNS ownership verification', () => {
  it('issues a tenant-bound, persisted, expiring DNS TXT challenge with a copyable host and value', async () => {
    const { service, prisma, audit } = buildVerificationService();
    prisma.tenantDomain.findFirst.mockResolvedValue(pendingDomain());

    const challenge = await service.generateChallenge(TENANT_A, DOMAIN.toUpperCase(), 'operator-a');

    expect(prisma.tenantDomain.findFirst).toHaveBeenCalledWith({ where: { domain: DOMAIN, tenantId: TENANT_A } });
    expect(prisma.tenantDomain.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'domain-record-a', tenantId: TENANT_A },
      data: expect.objectContaining({
        verificationToken: expect.stringMatching(/^[a-f0-9]{64}$/),
        verificationAttempts: 0,
        verificationExpiresAt: expect.any(Date),
        status: 'PENDING_DNS',
        verifiedAt: null,
      }),
    }));
    expect(challenge.domain).toBe(DOMAIN);
    expect(challenge.token).toMatch(/^[a-f0-9]{64}$/);
    expect(challenge.verificationHost).toBe(`_wlct-challenge.${DOMAIN}`);
    expect(challenge.verificationRecord).toBe(`wlct-verification=${challenge.token}`);
    expect(challenge.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(challenge.maxAttempts).toBe(5);
    expect(audit.logDomainVerificationStarted).toHaveBeenCalledWith(TENANT_A, 'operator-a', DOMAIN);
  });

  it('marks a domain verified only when the exact challenge value is returned by the DNS TXT resolver', async () => {
    const { service, prisma, audit, resolver } = buildVerificationService();
    prisma.tenantDomain.findFirst.mockResolvedValue(pendingDomain());
    (resolver.resolveTxt as jest.Mock).mockResolvedValue([[`wlct-verification=`, TOKEN]]);

    const result = await service.verifyDomain(TENANT_A, DOMAIN, 'operator-a');

    expect(resolver.resolveTxt).toHaveBeenCalledWith(`_wlct-challenge.${DOMAIN}`);
    expect(prisma.tenantDomain.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'domain-record-a',
        tenantId: TENANT_A,
        status: 'PENDING_DNS',
        verificationToken: TOKEN,
        verificationAttempts: { lt: 5 },
        verificationExpiresAt: { gt: expect.any(Date) },
      }),
      data: expect.objectContaining({
        verificationAttempts: { increment: 1 },
        status: 'ACTIVE',
        verifiedAt: expect.any(Date),
      }),
    }));
    expect(result).toMatchObject({
      domain: DOMAIN,
      status: DomainVerificationStatus.VERIFIED,
      verified: true,
      attempts: 1,
      failureReason: null,
    });
    expect(result.verifiedAt).toBeInstanceOf(Date);
    expect(audit.logDomainVerified).toHaveBeenCalledWith(TENANT_A, 'operator-a', DOMAIN);
  });

  it('does not accept a substring, stale value, or another tenant’s token as DNS ownership proof', async () => {
    const { service, prisma, resolver, audit } = buildVerificationService();
    prisma.tenantDomain.findFirst
      .mockResolvedValueOnce(pendingDomain())
      .mockResolvedValueOnce(pendingDomain({ verificationAttempts: 1 }));
    (resolver.resolveTxt as jest.Mock).mockResolvedValue([[`prefix-${EXPECTED_TXT}-suffix`]]);

    const result = await service.verifyDomain(TENANT_A, DOMAIN, 'operator-a');

    expect(result.status).toBe(DomainVerificationStatus.PENDING);
    expect(result.verified).toBe(false);
    expect(result.attempts).toBe(1);
    expect(result.failureReason).toContain('did not exactly match');
    expect(prisma.tenantDomain.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.tenantDomain.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantId: TENANT_A, verificationToken: TOKEN }),
      data: { verificationAttempts: { increment: 1 } },
    }));
    expect(audit.logDomainVerified).not.toHaveBeenCalled();
    expect(audit.logDomainVerificationFailed).toHaveBeenCalledWith(
      TENANT_A,
      'operator-a',
      DOMAIN,
      expect.stringContaining('did not exactly match'),
    );
  });

  it.each(['ENODATA', 'ENOTFOUND'])('treats DNS TXT absence (%s) as an unsuccessful proof and never activates the domain', async (code) => {
    const { service, prisma, resolver } = buildVerificationService();
    prisma.tenantDomain.findFirst
      .mockResolvedValueOnce(pendingDomain())
      .mockResolvedValueOnce(pendingDomain({ verificationAttempts: 1 }));
    const noTxtRecord = Object.assign(new Error('No TXT record'), { code });
    (resolver.resolveTxt as jest.Mock).mockRejectedValue(noTxtRecord);

    const result = await service.verifyDomain(TENANT_A, DOMAIN, 'operator-a');

    expect(result.verified).toBe(false);
    expect(result.status).toBe(DomainVerificationStatus.PENDING);
    expect(prisma.tenantDomain.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.tenantDomain.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'ACTIVE' }),
    }));
  });

  it('propagates DNS resolver outages and leaves the persisted domain unverified', async () => {
    const { service, prisma, resolver, audit } = buildVerificationService();
    prisma.tenantDomain.findFirst.mockResolvedValue(pendingDomain());
    const resolverUnavailable = Object.assign(new Error('DNS resolver unavailable'), { code: 'EAI_AGAIN' });
    (resolver.resolveTxt as jest.Mock).mockRejectedValue(resolverUnavailable);

    await expect(service.verifyDomain(TENANT_A, DOMAIN, 'operator-a')).rejects.toBe(resolverUnavailable);

    expect(prisma.tenantDomain.updateMany).not.toHaveBeenCalled();
    expect(audit.logDomainVerified).not.toHaveBeenCalled();
  });

  it('refuses an expired or legacy challenge that has no persisted expiry without querying DNS', async () => {
    const { service, prisma, resolver } = buildVerificationService();
    prisma.tenantDomain.findFirst
      .mockResolvedValueOnce(pendingDomain({ verificationExpiresAt: new Date(Date.now() - 1) }))
      .mockResolvedValueOnce(pendingDomain({ verificationExpiresAt: null }));

    const expired = await service.verifyDomain(TENANT_A, DOMAIN, 'operator-a');
    const legacy = await service.verifyDomain(TENANT_A, DOMAIN, 'operator-a');

    expect(expired.status).toBe(DomainVerificationStatus.EXPIRED);
    expect(legacy.status).toBe(DomainVerificationStatus.EXPIRED);
    expect(expired.failureReason).toContain('expired');
    expect(legacy.failureReason).toContain('no persisted expiry');
    expect(resolver.resolveTxt).not.toHaveBeenCalled();
    expect(prisma.tenantDomain.updateMany).not.toHaveBeenCalled();
  });

  it('enforces the persisted maximum attempt count before another DNS lookup', async () => {
    const { service, prisma, resolver } = buildVerificationService();
    prisma.tenantDomain.findFirst.mockResolvedValue(pendingDomain({ verificationAttempts: 5 }));

    const result = await service.verifyDomain(TENANT_A, DOMAIN, 'operator-a');

    expect(result.status).toBe(DomainVerificationStatus.FAILED);
    expect(result.attempts).toBe(5);
    expect(resolver.resolveTxt).not.toHaveBeenCalled();
    expect(prisma.tenantDomain.updateMany).not.toHaveBeenCalled();
  });

  it('atomically consumes the fifth failed proof and permanently closes that challenge', async () => {
    const { service, prisma, resolver, audit } = buildVerificationService();
    prisma.tenantDomain.findFirst
      .mockResolvedValueOnce(pendingDomain({ verificationAttempts: 4 }))
      .mockResolvedValueOnce(pendingDomain({ verificationAttempts: 5 }));
    (resolver.resolveTxt as jest.Mock).mockResolvedValue([]);

    const result = await service.verifyDomain(TENANT_A, DOMAIN, 'operator-a');

    expect(prisma.tenantDomain.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({
        tenantId: TENANT_A,
        verificationToken: TOKEN,
        verificationAttempts: { lt: 5 },
      }),
      data: { verificationAttempts: { increment: 1 } },
    }));
    expect(prisma.tenantDomain.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({
        tenantId: TENANT_A,
        status: 'PENDING_DNS',
        verificationAttempts: { gte: 5 },
      }),
      data: { status: 'FAILED' },
    }));
    expect(result).toMatchObject({
      status: DomainVerificationStatus.FAILED,
      verified: false,
      attempts: 5,
      challenge: null,
    });
    expect(result.failureReason).toContain('after 5 attempts');
    expect(audit.logDomainVerificationFailed).toHaveBeenCalledWith(
      TENANT_A,
      'operator-a',
      DOMAIN,
      expect.stringContaining('after 5 attempts'),
    );
    expect(resolver.resolveTxt).toHaveBeenCalledTimes(1);
  });

  it('cannot resolve or verify a domain outside the authenticated tenant scope', async () => {
    const { service, prisma, resolver } = buildVerificationService();
    prisma.tenantDomain.findFirst.mockResolvedValue(null);

    await expect(service.verifyDomain(TENANT_B, DOMAIN, 'operator-b')).rejects.toThrow(
      `Domain ${DOMAIN} not found for tenant ${TENANT_B}`,
    );

    expect(prisma.tenantDomain.findFirst).toHaveBeenCalledWith({ where: { domain: DOMAIN, tenantId: TENANT_B } });
    expect(resolver.resolveTxt).not.toHaveBeenCalled();
    expect(prisma.tenantDomain.updateMany).not.toHaveBeenCalled();
  });

  it('prevents registering a domain that is already owned by another tenant', async () => {
    const prisma = {
      tenantDomain: {
        findFirst: jest.fn().mockResolvedValue({ id: 'foreign-domain', tenantId: TENANT_B, domain: DOMAIN }),
        count: jest.fn(),
        create: jest.fn(),
      },
    };
    const featureAccess = { checkFeatureAccess: jest.fn().mockResolvedValue({ enabled: true }) };
    const audit = { logDomainRegistered: jest.fn(), logDomainVerificationFailed: jest.fn() };
    const service = new CustomDomainService(prisma as never, featureAccess as never, audit as never);

    await expect(service.registerDomain(TENANT_A, DOMAIN.toUpperCase(), true, 'operator-a')).rejects.toThrow(
      `Domain ${DOMAIN} is already registered to another tenant`,
    );

    expect(prisma.tenantDomain.findFirst).toHaveBeenCalledWith({ where: { domain: DOMAIN } });
    expect(prisma.tenantDomain.count).not.toHaveBeenCalled();
    expect(prisma.tenantDomain.create).not.toHaveBeenCalled();
  });
});
