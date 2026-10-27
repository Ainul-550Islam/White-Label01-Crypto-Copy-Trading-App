// # Responsibility: implements the Batch 04 commercial domain behavior for this capability.
// # Stores and retrieves validated locale preferences within the authenticated tenant and user scope.
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { SUPPORTED_DATE_FORMATS, SUPPORTED_PREFERENCE_CURRENCIES, SUPPORTED_PREFERENCE_LOCALES, type UserPreferencesDto } from './dto/user-preferences.dto';

export interface UserPreferenceRecord {
  tenantId: string;
  userId: string;
  locale: (typeof SUPPORTED_PREFERENCE_LOCALES)[number];
  displayCurrency: string;
  timezone: string;
  dateFormat: 'ISO' | 'DMY' | 'MDY';
  updatedAt: Date;
}

@Injectable()
export class UserPreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  async get(tenantId: string, userId: string): Promise<UserPreferenceRecord> {
    this.assertScope(tenantId, userId);
    return this.prisma.withTenantRls(tenantId, async (tx) => {
      await this.assertTenantUser(tx, tenantId, userId);
      const row = await tx.userPreferences.findUnique({ where: { tenantId_userId: { tenantId, userId } } });
      if (row) return this.map(row);
      return { tenantId, userId, locale: 'en', displayCurrency: 'USD', timezone: 'UTC', dateFormat: 'ISO', updatedAt: new Date(0) };
    });
  }

  async update(tenantId: string, userId: string, input: UserPreferencesDto): Promise<UserPreferenceRecord> {
    this.assertScope(tenantId, userId);
    if (!SUPPORTED_PREFERENCE_LOCALES.includes(input.locale) || !SUPPORTED_PREFERENCE_CURRENCIES.includes(input.displayCurrency) || !SUPPORTED_DATE_FORMATS.includes(input.dateFormat)) {
      throw new BadRequestException('Unsupported user preference');
    }
    try {
      new Intl.DateTimeFormat(input.locale, { timeZone: input.timezone }).format(new Date(0));
    } catch {
      throw new BadRequestException('Unsupported timezone');
    }
    return this.prisma.withTenantRls(tenantId, async (tx) => {
      await this.assertTenantUser(tx, tenantId, userId);
      const row = await tx.userPreferences.upsert({
        where: { tenantId_userId: { tenantId, userId } },
        create: { tenantId, userId, locale: input.locale, displayCurrency: input.displayCurrency, timezone: input.timezone, dateFormat: input.dateFormat },
        update: { locale: input.locale, displayCurrency: input.displayCurrency, timezone: input.timezone, dateFormat: input.dateFormat },
      });
      return this.map(row);
    });
  }

  private assertScope(tenantId: string, userId: string): void {
    if (!tenantId || !userId) throw new BadRequestException('Authenticated tenant and user are required');
  }

  private async assertTenantUser(tx: Prisma.TransactionClient, tenantId: string, userId: string): Promise<void> {
    const user = await tx.user.findFirst({ where: { id: userId, tenantId }, select: { id: true } });
    if (!user) throw new NotFoundException('User preferences not found');
  }

  private map(row: { tenantId: string; userId: string; locale: string; displayCurrency: string; timezone: string; dateFormat: string; updatedAt: Date }): UserPreferenceRecord {
    const locale = SUPPORTED_PREFERENCE_LOCALES.find((value) => value === row.locale);
    if (!locale) throw new Error('Persisted preference locale is invalid');
    if (row.dateFormat !== 'ISO' && row.dateFormat !== 'DMY' && row.dateFormat !== 'MDY') throw new Error('Persisted date format is invalid');
    if (!SUPPORTED_PREFERENCE_CURRENCIES.includes(row.displayCurrency as (typeof SUPPORTED_PREFERENCE_CURRENCIES)[number])) throw new Error('Persisted display currency is invalid');
    return { ...row, locale, dateFormat: row.dateFormat };
  }
}
