// # Responsibility: verifies attribution idempotency, durable persistence, and fail-closed handling of storage failures.
import { ServiceUnavailableException } from '@nestjs/common';
import { PartnerAttributionService } from './partner-attribution.service';
import { PartnerAttributionState } from './partner.types';

describe('PartnerAttributionService durable attribution', () => {
  function buildService(options?: { findFirst?: jest.Mock; findMany?: jest.Mock; create?: jest.Mock }) {
    const prisma = {
      partnerAttribution: {
        findFirst: options?.findFirst ?? jest.fn(async () => null),
        findMany: options?.findMany ?? jest.fn(async () => []),
        create: options?.create ?? jest.fn(async ({ data }) => data),
      },
    };
    const policyService = {};
    const agreementService = {
      getActiveAgreement: jest.fn(async () => ({
        version: 2,
        commissionPolicy: { attributionWindowHours: 720, policyVersion: 'policy-v2' },
      })),
    };
    const audit = { recordEvent: jest.fn(async () => undefined) };
    const profileService = { getProfile: jest.fn(async () => ({ ownerUserId: 'partner-owner' })) };
    const referralService = {};
    const tenantService = { getPrimaryPartnerForTenant: jest.fn(async () => null) };
    const service = new PartnerAttributionService(
      policyService as any,
      agreementService as any,
      audit as any,
      profileService as any,
      referralService as any,
      tenantService as any,
      prisma as any,
    );
    return { service, prisma, agreementService, audit };
  }

  function input(idempotencyKey = 'attrib-idem-1') {
    return {
      partnerId: 'partner-a',
      tenantId: 'tenant-a',
      attributionSource: 'TENANT_PROVISIONING',
      capturedAt: new Date().toISOString(),
      createdBy: 'operator-a',
      correlationId: 'corr-a',
      idempotencyKey,
    };
  }

  test('returns an attribution only after the canonical database row is created', async () => {
    const { service, prisma, audit } = buildService();

    const result = await service.attributeTenant(input());

    expect(prisma.partnerAttribution.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        partnerId: 'partner-a',
        tenantId: 'tenant-a',
        state: PartnerAttributionState.ACTIVE,
        idempotencyKey: 'attrib-idem-1',
      }),
    }));
    expect(result).toMatchObject({
      partnerId: 'partner-a',
      tenantId: 'tenant-a',
      state: PartnerAttributionState.ACTIVE,
      idempotencyKey: 'attrib-idem-1',
    });
    expect(audit.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'REFERRAL_ATTRIBUTED',
      tenantId: 'tenant-a',
      safeEvidence: expect.objectContaining({ attributionId: result.id }),
    }));
  });

  test('returns a prior durable attribution for an idempotent retry without creating a duplicate', async () => {
    const now = new Date();
    const persisted = {
      id: 'persisted-attribution',
      partnerId: 'partner-a',
      tenantId: 'tenant-a',
      campaignId: null,
      referralCode: null,
      referralToken: null,
      attributionSource: 'TENANT_PROVISIONING',
      attributionWindowHours: 720,
      capturedAt: now,
      effectiveAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
      agreementVersion: 'v2',
      policyVersion: 'policy-v2',
      state: PartnerAttributionState.ACTIVE,
      isPrimary: true,
      createdAt: now,
      updatedAt: now,
      idempotencyKey: 'attrib-idem-1',
    };
    const findFirst = jest.fn(async () => persisted);
    const create = jest.fn();
    const { service, audit } = buildService({ findFirst, create });

    const result = await service.attributeTenant(input());

    expect(findFirst).toHaveBeenCalledWith({ where: { tenantId: 'tenant-a', idempotencyKey: 'attrib-idem-1' } });
    expect(result.id).toBe('persisted-attribution');
    expect(create).not.toHaveBeenCalled();
    expect(audit.recordEvent).not.toHaveBeenCalled();
  });

  test('resolves a concurrent same-tenant insert conflict as an idempotent replay', async () => {
    const now = new Date();
    const persisted = {
      id: 'concurrent-attribution',
      partnerId: 'partner-a',
      tenantId: 'tenant-a',
      campaignId: null,
      referralCode: null,
      referralToken: null,
      attributionSource: 'TENANT_PROVISIONING',
      attributionWindowHours: 720,
      capturedAt: now,
      effectiveAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
      agreementVersion: 'v2',
      policyVersion: 'policy-v2',
      state: PartnerAttributionState.ACTIVE,
      isPrimary: true,
      createdAt: now,
      updatedAt: now,
      idempotencyKey: 'race-idem-key',
    };
    const findFirst = jest.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(persisted);
    const create = jest.fn(async () => { throw Object.assign(new Error('unique conflict'), { code: 'P2002' }); });
    const { service, audit } = buildService({ findFirst, create });

    const result = await service.attributeTenant(input('race-idem-key'));

    expect(findFirst).toHaveBeenNthCalledWith(1, { where: { tenantId: 'tenant-a', idempotencyKey: 'race-idem-key' } });
    expect(findFirst).toHaveBeenNthCalledWith(2, { where: { tenantId: 'tenant-a', idempotencyKey: 'race-idem-key' } });
    expect(result.id).toBe('concurrent-attribution');
    expect(audit.recordEvent).not.toHaveBeenCalled();
  });

  test('does not return another tenant attribution for the same client idempotency key', async () => {
    const findFirst = jest.fn(async ({ where }: { where: { tenantId: string } }) => (
      where.tenantId === 'tenant-a' ? { id: 'foreign-attribution', partnerId: 'partner-a', tenantId: 'tenant-a' } : null
    ));
    const create = jest.fn(async ({ data }) => data);
    const { service } = buildService({ findFirst, create });

    const result = await service.attributeTenant({ ...input('shared-client-key'), tenantId: 'tenant-b' });

    expect(findFirst).toHaveBeenCalledWith({ where: { tenantId: 'tenant-b', idempotencyKey: 'shared-client-key' } });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ tenantId: 'tenant-b' }) }));
    expect(result.tenantId).toBe('tenant-b');
  });

  test('fails closed without audit success when idempotency storage is unavailable', async () => {
    const findFirst = jest.fn(async () => { throw new Error('database unavailable'); });
    const create = jest.fn();
    const { service, audit } = buildService({ findFirst, create });

    await expect(service.attributeTenant(input())).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(create).not.toHaveBeenCalled();
    expect(audit.recordEvent).not.toHaveBeenCalled();
  });

  test('fails closed when attribution insert is unavailable and does not cache an unpersisted claim', async () => {
    const create = jest.fn(async () => { throw new Error('database unavailable'); });
    const findMany = jest.fn(async () => []);
    const { service, audit } = buildService({ create, findMany });

    await expect(service.attributeTenant(input())).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(audit.recordEvent).not.toHaveBeenCalled();
    await expect(service.listAttributionsForPartner('partner-a')).resolves.toEqual([]);
  });
});
