// # Responsibility: verifies the Batch 04 commercial behavior and its safety contracts.
// # Tests exact current-version/hash acceptance, action gates, withdrawal, idempotency, and isolation by tenant and user.
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PolicyAcceptanceService } from './policy-acceptance.service';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';

const tenant = '11111111-1111-4111-8111-111111111111';
const user = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function fixture() {
  const existing: { id: string; tenantId: string; userId: string; document: string; version: string; contentHash: string; acceptedAt: Date; withdrawnAt: Date | null }[] = [];
  const findUnique = jest.fn(async ({ where }: { where: { tenantId_userId_document_version_contentHash: { tenantId: string; userId: string; document: string; version: string; contentHash: string } } }) => existing.find((row) => Object.entries(where.tenantId_userId_document_version_contentHash).every(([key, value]) => row[key as keyof typeof row] === value)) ?? null);
  const findFirst = jest.fn(async ({ where }: { where: { tenantId: string; userId: string; document: string; version: string; contentHash: string; withdrawnAt: null } }) => existing.find((row) => Object.entries(where).every(([key, value]) => row[key as keyof typeof row] === value)) ? { id: 'accepted' } : null);
  const create = jest.fn(async ({ data }: { data: Omit<(typeof existing)[number], 'id' | 'acceptedAt' | 'withdrawnAt'> }) => { const row = { ...data, id: `acceptance-${existing.length + 1}`, acceptedAt: new Date(), withdrawnAt: null }; existing.push(row); return row; });
  const update = jest.fn(async ({ where, data }: { where: { id: string }; data: { acceptedAt: Date; withdrawnAt: null } }) => { const row = existing.find((item) => item.id === where.id); if (!row) throw new Error('not found'); row.acceptedAt = data.acceptedAt; row.withdrawnAt = data.withdrawnAt; return row; });
  const updateMany = jest.fn(async ({ where, data }: { where: { tenantId: string; userId: string; document: string; version: string; contentHash: string; withdrawnAt: null }; data: { withdrawnAt: Date } }) => { const rows = existing.filter((row) => Object.entries(where).every(([key, value]) => row[key as keyof typeof row] === value)); for (const row of rows) row.withdrawnAt = data.withdrawnAt; return { count: rows.length }; });
  const prisma = { policyAcceptance: { findUnique, findFirst, create, update, updateMany } } as unknown as PrismaService;
  return { service: new PolicyAcceptanceService(prisma), existing, findFirst, create, updateMany };
}

describe('PolicyAcceptanceService', () => {
  it('rejects an old version and a content-hash mismatch', async () => {
    const { service, create } = fixture();
    const current = service.current()[0];
    if (!current) throw new Error('policy fixture missing');
    await expect(service.accept({ tenantId: tenant, userId: user, document: current.document, version: 'older', contentHash: current.contentHash })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.accept({ tenantId: tenant, userId: user, document: current.document, version: current.version, contentHash: '0'.repeat(64) })).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it('accepts current content, preserves idempotency, and allows a required-action gate', async () => {
    const { service, create } = fixture();
    const policy = service.current().find((item) => item.document === 'TERMS');
    if (!policy) throw new Error('terms policy missing');
    const request = { tenantId: tenant, userId: user, document: policy.document, version: policy.version, contentHash: policy.contentHash };
    await service.accept(request);
    await service.accept(request);
    expect(create).toHaveBeenCalledTimes(1);
    await expect(service.requireCurrent(tenant, user, ['TERMS'])).resolves.toBeUndefined();
  });

  it('blocks an action until current acceptance is recorded and isolates another tenant', async () => {
    const { service } = fixture();
    await expect(service.requireCurrent(tenant, user, ['PRIVACY'])).rejects.toBeInstanceOf(ForbiddenException);
    const policy = service.current().find((item) => item.document === 'PRIVACY');
    if (!policy) throw new Error('privacy policy missing');
    await service.accept({ tenantId: tenant, userId: user, document: policy.document, version: policy.version, contentHash: policy.contentHash });
    await expect(service.requireCurrent('22222222-2222-4222-8222-222222222222', user, ['PRIVACY'])).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('records withdrawal and refuses to claim the withdrawn acceptance is current', async () => {
    const { service, updateMany } = fixture();
    const policy = service.current().find((item) => item.document === 'TERMS');
    if (!policy) throw new Error('terms policy missing');
    await service.accept({ tenantId: tenant, userId: user, document: policy.document, version: policy.version, contentHash: policy.contentHash });
    await service.withdraw({ tenantId: tenant, userId: user, document: 'TERMS' });
    expect(updateMany).toHaveBeenCalledTimes(1);
    await expect(service.requireCurrent(tenant, user, ['TERMS'])).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not fabricate withdrawal for a different user', async () => {
    const { service } = fixture();
    await expect(service.withdraw({ tenantId: tenant, userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', document: 'TERMS' })).rejects.toBeInstanceOf(NotFoundException);
  });
});
