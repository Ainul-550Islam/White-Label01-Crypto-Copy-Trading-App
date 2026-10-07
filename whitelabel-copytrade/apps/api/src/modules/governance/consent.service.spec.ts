// # Responsibility: verifies consent capture and withdrawal are durable before success or audit events are returned.
import { ServiceUnavailableException } from '@nestjs/common';
import { ConsentService } from './consent.service';
import { ConsentState, GovernanceActionType } from './governance.types';

describe('ConsentService durable consent lifecycle', () => {
  function buildService(options?: {
    create?: jest.Mock;
    findUnique?: jest.Mock;
    findMany?: jest.Mock;
    update?: jest.Mock;
  }) {
    const consentRecord = {
      create: options?.create ?? jest.fn(async ({ data }) => data),
      findUnique: options?.findUnique ?? jest.fn(async () => null),
      findMany: options?.findMany ?? jest.fn(async () => []),
      update: options?.update ?? jest.fn(async ({ where, data }) => ({ id: where.id, ...data })),
    };
    const prisma = { consentRecord };
    const policyService = { assertTenantIsolation: jest.fn() };
    const audit = { recordEvent: jest.fn(async () => undefined) };
    const service = new ConsentService(policyService as any, audit as any, prisma as any);
    return { service, prisma, policyService, audit };
  }

  function captureInput() {
    return {
      tenantId: 'tenant-a',
      subjectUserId: 'user-a',
      purpose: 'COPY_TRADING_RISK_DISCLOSURE',
      version: '2026-10-v1',
      policyReference: 'sha256:document-hash',
      source: 'WEB_CHECKBOX',
      correlationId: 'consent-correlation-a',
      capturedBy: 'user-a',
      evidenceReference: 'consent-page-v1',
    };
  }

  test('captures and audits a consent only after the database insert returns a durable row', async () => {
    const { service, prisma, audit } = buildService();

    const result = await service.captureConsent(captureInput());

    expect(prisma.consentRecord.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tenantId: 'tenant-a',
        subjectUserId: 'user-a',
        purpose: 'COPY_TRADING_RISK_DISCLOSURE',
        version: '2026-10-v1',
        policyReference: 'sha256:document-hash',
      }),
    }));
    expect(result).toMatchObject({
      tenantId: 'tenant-a',
      subjectUserId: 'user-a',
      version: '2026-10-v1',
      status: ConsentState.ACTIVE,
    });
    expect(audit.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
      actionType: GovernanceActionType.CONSENT_CAPTURE,
      consentId: result.id,
      result: 'CAPTURED',
    }));
  });

  test('does not return, cache, or audit consent success when persistence fails', async () => {
    const create = jest.fn(async () => { throw new Error('database unavailable'); });
    const findMany = jest.fn(async () => []);
    const { service, audit } = buildService({ create, findMany });

    await expect(service.captureConsent(captureInput())).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(audit.recordEvent).not.toHaveBeenCalled();
    await expect(service.listConsents('tenant-a', 'user-a')).resolves.toEqual([]);
  });

  test('does not claim consent withdrawal when the durable update fails', async () => {
    const capturedAt = new Date('2026-10-01T00:00:00.000Z');
    const activeRow = {
      id: 'consent-existing',
      tenantId: 'tenant-a',
      subjectUserId: 'user-a',
      purpose: 'COPY_TRADING_RISK_DISCLOSURE',
      version: '2026-10-v1',
      policyReference: 'sha256:document-hash',
      source: 'WEB_CHECKBOX',
      capturedAt,
      withdrawnAt: null,
      status: ConsentState.ACTIVE,
      evidenceReference: 'consent-page-v1',
      correlationId: 'consent-correlation-a',
    };
    const findUnique = jest.fn(async () => activeRow);
    const findMany = jest.fn(async () => [activeRow]);
    const update = jest.fn(async () => { throw new Error('database unavailable'); });
    const { service, audit } = buildService({ findUnique, findMany, update });

    await expect(service.withdrawConsent({
      tenantId: 'tenant-a',
      consentId: 'consent-existing',
      subjectUserId: 'user-a',
      correlationId: 'withdraw-correlation-a',
      withdrawnBy: 'user-a',
      reason: 'User withdrew consent',
    })).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'consent-existing',
        tenantId: 'tenant-a',
        subjectUserId: 'user-a',
        status: ConsentState.ACTIVE,
      }),
      data: expect.objectContaining({ status: ConsentState.WITHDRAWN }),
    }));
    expect(audit.recordEvent).not.toHaveBeenCalled();
    await expect(service.listConsents('tenant-a', 'user-a')).resolves.toEqual([
      expect.objectContaining({ id: 'consent-existing', status: ConsentState.ACTIVE }),
    ]);
  });

  test('fails closed when the durable withdrawal lookup is unavailable', async () => {
    const findUnique = jest.fn(async () => { throw new Error('database unavailable'); });
    const update = jest.fn();
    const { service, audit } = buildService({ findUnique, update });

    await expect(service.withdrawConsent({
      tenantId: 'tenant-a',
      consentId: 'consent-existing',
      subjectUserId: 'user-a',
      correlationId: 'withdraw-correlation-b',
      withdrawnBy: 'user-a',
    })).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'consent-existing', tenantId: 'tenant-a' } });
    expect(update).not.toHaveBeenCalled();
    expect(audit.recordEvent).not.toHaveBeenCalled();
  });

  test('does not return an in-memory consent list when durable listing fails', async () => {
    const findMany = jest.fn(async () => { throw new Error('database unavailable'); });
    const { service } = buildService({ findMany });

    await expect(service.listConsents('tenant-a', 'user-a')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
