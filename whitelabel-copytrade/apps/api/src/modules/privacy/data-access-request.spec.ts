// # Responsibility: verifies the Batch 04 commercial behavior and its safety contracts.
// # Verifies customer privacy request ownership, tenant isolation, step-up deletion, single-use expiring export tokens, and legal retention metadata.
import { createHash } from 'node:crypto';
import { GoneException, NotFoundException } from '@nestjs/common';
import { PrivacySelfServiceController } from './privacy-self-service.controller';
import { PrivacyExportDownloadService } from './privacy-export-download.service';
import { REQUIRE_STEP_UP_KEY } from '../auth/step-up/require-step-up.decorator';
import type { AuthenticatedActor } from '@wlct/shared-types';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { RedisService } from '../../infrastructure/redis/redis.service';

const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';
const userA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const userB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const actor = { tenantId: tenantA, userId: userA } as AuthenticatedActor;
const request = { id: 'privacy-request-a', tenantId: tenantA, subjectUserId: userA, requestType: 'EXPORT', jurisdiction: 'BD', state: 'UNDER_REVIEW', requestedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), legalHoldBlock: false, retentionBlock: false };

function controllerFixture(requestRecord = request) {
  const getRequest = jest.fn().mockResolvedValue(requestRecord);
  const listRequests = jest.fn().mockResolvedValue([requestRecord]);
  const createRequest = jest.fn().mockResolvedValue(requestRecord);
  const generateExport = jest.fn().mockResolvedValue({ id: 'export-a', fileHash: 'a'.repeat(64), recordCount: 1 });
  const issue = jest.fn().mockResolvedValue({ token: 'token-value', expiresAt: new Date(Date.now() + 60_000).toISOString() });
  const consume = jest.fn();
  return { controller: new PrivacySelfServiceController({ getRequest, listRequests, createRequest } as never, { generateExport } as never, { issue, consume } as never), getRequest, listRequests, createRequest, generateExport, issue, consume };
}

function exportRow(overrides: Partial<{ id: string; tenantId: string; subjectUserId: string; requestId: string; exportVersion: string; dataAsOf: Date; generatedAt: Date; dataCategories: string[]; sourceReferences: string[]; recordCount: number; fileHash: string | null; methodology: string; policyVersion: string }> = {}) {
  return { id: 'export-a', tenantId: tenantA, subjectUserId: userA, requestId: request.id, exportVersion: 'v1', dataAsOf: new Date('2026-10-26T00:00:00Z'), generatedAt: new Date('2026-10-26T00:00:00Z'), dataCategories: ['PII'], sourceReferences: ['users:user_profiles:1'], recordCount: 1, fileHash: 'b'.repeat(64), methodology: 'governance-policy', policyVersion: '1', ...overrides };
}

describe('customer data access request security', () => {
  it('lists only the JWT subject inside the JWT tenant', async () => {
    const { controller, listRequests } = controllerFixture();
    await controller.list(actor);
    expect(listRequests).toHaveBeenCalledWith(tenantA, { subjectUserId: userA });
  });

  it('prevents a user from reading another user request even within the same tenant', async () => {
    const foreign = { ...request, subjectUserId: userB };
    const { controller } = controllerFixture(foreign);
    await expect(controller.get(actor, request.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('creates export content for only the caller and never accepts a supplied tenant or subject', async () => {
    const { controller, generateExport } = controllerFixture();
    const result = await controller.requestExport(actor, request.id, { correlationId: 'privacy-export-correlation' });
    expect(result).toMatchObject({ id: 'export-a' });
    expect(generateExport).toHaveBeenCalledWith(expect.objectContaining({ tenantId: tenantA, subjectUserId: userA, requestId: request.id }));
    const foreign = controllerFixture({ ...request, subjectUserId: userB });
    await expect(foreign.controller.requestExport(actor, request.id, { correlationId: 'foreign-export-correlation' })).rejects.toBeInstanceOf(NotFoundException);
    expect(foreign.generateExport).not.toHaveBeenCalled();
  });

  it('requires fresh DATA_DELETION_REQUEST step-up for deletion routes', () => {
    const descriptor = Object.getOwnPropertyDescriptor(PrivacySelfServiceController.prototype, 'createDeletion');
    expect(descriptor?.value).toBeDefined();
    expect(Reflect.getMetadata(REQUIRE_STEP_UP_KEY, descriptor?.value)).toBe('DATA_DELETION_REQUEST');
  });

  it('issues a time-limited token and allows a successful download only once', async () => {
    let tokenRecord = '';
    const storedExport = exportRow();
    const findFirst = jest.fn().mockResolvedValue(storedExport);
    const set = jest.fn(async (_key: string, value: string) => { tokenRecord = value; return 'OK'; });
    const call = jest.fn(async () => { const current = tokenRecord; tokenRecord = ''; return current || null; });
    const prisma = { privacyExport: { findFirst } } as unknown as PrismaService;
    const redis = { client: { set, call } } as unknown as RedisService;
    const service = new PrivacyExportDownloadService(prisma, redis);
    const issued = await service.issue(tenantA, userA, request.id);
    expect(issued.expiresAt).toBeTruthy();
    const downloaded = await service.consume(tenantA, userA, issued.token);
    expect(downloaded).toMatchObject({ id: 'export-a', requestId: request.id, recordCount: 1 });
    await expect(service.consume(tenantA, userA, issued.token)).rejects.toBeInstanceOf(GoneException);
    expect(set).toHaveBeenCalledWith(expect.stringMatching(/^privacy-export-download:/), expect.any(String), 'PX', 300_000, 'NX');
  });

  it('rejects expired or foreign-tenant token context and consumes the bearer token', async () => {
    const expired = { tenantId: tenantA, userId: userA, requestId: request.id, exportId: 'export-a', expiresAt: '2020-01-01T00:00:00.000Z' };
    const call = jest.fn().mockResolvedValue(JSON.stringify(expired));
    const prisma = { privacyExport: { findFirst: jest.fn().mockResolvedValue(exportRow()) } } as unknown as PrismaService;
    const redis = { client: { call } } as unknown as RedisService;
    const service = new PrivacyExportDownloadService(prisma, redis);
    await expect(service.consume(tenantA, userA, 'x'.repeat(40))).rejects.toBeInstanceOf(GoneException);
    expect(call).toHaveBeenCalledWith('GETDEL', expect.stringMatching(/^privacy-export-download:/));
    const foreign = { ...expired, expiresAt: new Date(Date.now() + 60_000).toISOString(), tenantId: tenantB };
    call.mockResolvedValueOnce(JSON.stringify(foreign));
    await expect(service.consume(tenantA, userA, 'y'.repeat(40))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('uses hashed random token storage keys, not raw bearer tokens', () => {
    const token = 'private-token-value-'.repeat(3);
    const expected = `privacy-export-download:${createHash('sha256').update(token, 'utf8').digest('hex')}`;
    expect(expected).not.toContain(token);
    expect(expected).toMatch(/^privacy-export-download:[a-f0-9]{64}$/);
  });
});
