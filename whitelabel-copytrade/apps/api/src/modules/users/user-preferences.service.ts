// # Responsibility: implements the Batch 04 commercial domain behavior for this capability.
// # Stores and retrieves validated locale preferences within the authenticated tenant and user scope.
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { SUPPORTED_DATE_FORMATS, SUPPORTED_PREFERENCE_CURRENCIES, SUPPORTED_PREFERENCE_LOCALES, type UserPreferencesDto } from './dto/user-preferences.dto';

export interface UserPreferenceRecord {
  tenantId: string;
  userId: string;
  locale: 'en' | 'bn';
  displayCurrency: string;
  timezone: string;
  dateFormat: 'ISO' | 'DMY' | 'MDY';
  updatedAt: Date;
}

@Injectable()
export class UserPreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  async get(tenantId: string, userId: string): Promise<UserPreferenceRecord> {
    await this.assertTenantUser(tenantId, userId);
    const row = await this.prisma.userPreferences.findUnique({ where: { tenantId_userId: { tenantId, userId } } });
    if (row) return this.map(row);
    return { tenantId, userId, locale: 'en', displayCurrency: 'USD', timezone: 'UTC', dateFormat: 'ISO', updatedAt: new Date(0) };
  }

  async update(tenantId: string, userId: string, input: UserPreferencesDto): Promise<UserPreferenceRecord> {
    await this.assertTenantUser(tenantId, userId);
    if (!SUPPORTED_PREFERENCE_LOCALES.includes(input.locale) || !SUPPORTED_PREFERENCE_CURRENCIES.includes(input.displayCurrency) || !SUPPORTED_DATE_FORMATS.includes(input.dateFormat)) {
      throw new BadRequestException('Unsupported user preference');
    }
    try {
      new Intl.DateTimeFormat(input.locale, { timeZone: input.timezone }).format(new Date(0));
    } catch {
      throw new BadRequestException('Unsupported timezone');
    }
    const row = await this.prisma.userPreferences.upsert({
      where: { tenantId_userId: { tenantId, userId } },
      create: { tenantId, userId, locale: input.locale, displayCurrency: input.displayCurrency, timezone: input.timezone, dateFormat: input.dateFormat },
      update: { locale: input.locale, displayCurrency: input.displayCurrency, timezone: input.timezone, dateFormat: input.dateFormat },
    });
    return this.map(row);
  }

  private async assertTenantUser(tenantId: string, userId: string): Promise<void> {
    if (!tenantId || !userId) throw new BadRequestException('Authenticated tenant and user are required');
    const user = await this.prisma.user.findFirst({ where: { id: userId, tenantId }, select: { id: true } });
    if (!user) throw new NotFoundException('User preferences not found');
  }

  private map(row: { tenantId: string; userId: string; locale: string; displayCurrency: string; timezone: string; dateFormat: string; updatedAt: Date }): UserPreferenceRecord {
    if (row.locale !== 'en' && row.locale !== 'bn') throw new Error('Persisted preference locale is invalid');
    if (row.dateFormat !== 'ISO' && row.dateFormat !== 'DMY' && row.dateFormat !== 'MDY') throw new Error('Persisted date format is invalid');
    if (!SUPPORTED_PREFERENCE_CURRENCIES.includes(row.displayCurrency as (typeof SUPPORTED_PREFERENCE_CURRENCIES)[number])) throw new Error('Persisted display currency is invalid');
    return { ...row, locale: row.locale, dateFormat: row.dateFormat };
  }
}
