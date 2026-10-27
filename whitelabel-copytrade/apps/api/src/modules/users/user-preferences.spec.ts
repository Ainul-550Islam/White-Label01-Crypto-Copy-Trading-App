// # Responsibility: verifies the Batch 04 commercial behavior and its safety contracts.
// # Verifies validated defaults, storage, and tenant/user isolation for user display preferences.
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UserPreferencesService } from './user-preferences.service';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';

const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';
const userA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const userB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function fixture(foundUser = true) {
  const findFirst = jest.fn().mockResolvedValue(foundUser ? { id: userA } : null);
  const findUnique = jest.fn().mockResolvedValue(null);
  const upsert = jest.fn(async ({ create }: { create: { tenantId: string; userId: string; locale: string; displayCurrency: string; timezone: string; dateFormat: string } }) => ({ ...create, updatedAt: new Date('2026-10-26T00:00:00.000Z') }));
  const tx = { user: { findFirst }, userPreferences: { findUnique, upsert } };
  const prisma = { ...tx, withTenantRls: async (_tenant: string, work: (client: typeof tx) => unknown) => work(tx) } as unknown as PrismaService;
  return { service: new UserPreferencesService(prisma), findFirst, findUnique, upsert };
}

describe('UserPreferencesService', () => {
  it('returns safe defaults for a user without a preference record', async () => {
    const { service, findUnique } = fixture();
    const result = await service.get(tenantA, userA);
    expect(result).toMatchObject({ tenantId: tenantA, userId: userA, locale: 'en', displayCurrency: 'USD', timezone: 'UTC', dateFormat: 'ISO' });
    expect(findUnique).toHaveBeenCalledWith({ where: { tenantId_userId: { tenantId: tenantA, userId: userA } } });
  });

  it('persists valid Bengali, BDT and Dhaka preferences scoped to the current tenant and user', async () => {
    const { service, upsert } = fixture();
    const result = await service.update(tenantA, userA, { locale: 'bn', displayCurrency: 'BDT', timezone: 'Asia/Dhaka', dateFormat: 'DMY' });
    expect(result).toMatchObject({ tenantId: tenantA, userId: userA, locale: 'bn', displayCurrency: 'BDT', timezone: 'Asia/Dhaka', dateFormat: 'DMY' });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId_userId: { tenantId: tenantA, userId: userA } } }));
  });

  it.each(['ar', 'es', 'tr'] as const)('persists the %s locale without falling back', async (locale) => {
    const { service } = fixture();
    await expect(service.update(tenantA, userA, { locale, displayCurrency: 'USD', timezone: 'UTC', dateFormat: 'ISO' }))
      .resolves.toMatchObject({ locale });
  });

  it('rejects unsupported locales before writing preferences', async () => {
    const { service, upsert } = fixture();
    await expect(service.update(tenantA, userA, { locale: 'fr' as never, displayCurrency: 'USD', timezone: 'UTC', dateFormat: 'ISO' }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('does not read another tenant or user profile', async () => {
    const { service, findFirst } = fixture(false);
    await expect(service.get(tenantB, userB)).rejects.toBeInstanceOf(NotFoundException);
    expect(findFirst).toHaveBeenCalledWith({ where: { id: userB, tenantId: tenantB }, select: { id: true } });
  });

  it.each(['Unknown/Place', 'Not_A_Timezone'])('rejects unsupported timezone %s', async (timezone) => {
    const { service, upsert } = fixture();
    await expect(service.update(tenantA, userA, { locale: 'en', displayCurrency: 'USD', timezone, dateFormat: 'ISO' })).rejects.toBeInstanceOf(BadRequestException);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('rejects empty authenticated scope', async () => {
    const { service } = fixture();
    await expect(service.get('', userA)).rejects.toBeInstanceOf(BadRequestException);
  });
});
