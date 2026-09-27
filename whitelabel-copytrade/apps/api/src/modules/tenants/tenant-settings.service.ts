import { Injectable } from '@nestjs/common';
import { AuditAction, AuditActorType, AuditOutcome } from '@wlct/shared-types';
import type { TenantSettingDto } from '@wlct/shared-types';
import type { SealedPayload } from '@wlct/utils';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CryptoService } from '../../infrastructure/crypto/crypto.service';
import { AuditService } from '../audit/audit.service';
import type { UpsertTenantSettingsDto } from './dto/tenant-settings.dto';

/**
 * Per-tenant configuration store.
 *
 * Settings flagged `isSecret` are encrypted at rest with the same envelope
 * scheme used for exchange credentials, and are never returned in plaintext by
 * the read APIs - only a boolean marker that a value is configured.
 */
@Injectable()
export class TenantSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string, category?: string): Promise<TenantSettingDto[]> {
    const settings = await this.prisma.tenantSetting.findMany({
      where: { tenantId, ...(category ? { category } : {}) },
      orderBy: [{ category: 'asc' }, { key: 'asc' }],
    });

    return settings.map((setting) => ({
      id: setting.id,
      tenantId: setting.tenantId,
      key: setting.key,
      // Secret values are masked; only presence is disclosed.
      value: setting.isSecret ? { configured: true } : setting.value,
      category: setting.category,
      isSecret: setting.isSecret,
      description: setting.description,
      updatedAt: setting.updatedAt.toISOString(),
    }));
  }

  /** Reads a decrypted secret setting. Internal use only. */
  async getSecret(tenantId: string, key: string): Promise<string | null> {
    const setting = await this.prisma.tenantSetting.findUnique({
      where: { tenantId_key: { tenantId, key } },
    });

    if (!setting || !setting.isSecret) {
      return null;
    }

    return this.crypto.decrypt(
      setting.value as unknown as SealedPayload,
      this.aad(tenantId, key),
    );
  }

  async getValue<T>(tenantId: string, key: string, fallback: T): Promise<T> {
    const setting = await this.prisma.tenantSetting.findUnique({
      where: { tenantId_key: { tenantId, key } },
    });

    if (!setting || setting.isSecret) {
      return fallback;
    }

    return (setting.value as T) ?? fallback;
  }

  async upsertMany(
    tenantId: string,
    dto: UpsertTenantSettingsDto,
    context: { actorId: string; ipHash: string; requestId: string },
  ): Promise<TenantSettingDto[]> {
    const results: TenantSettingDto[] = [];

    for (const entry of dto.settings) {
      const isSecret = entry.isSecret ?? false;
      const storedValue = isSecret
        ? (this.crypto.encrypt(
            typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value),
            this.aad(tenantId, entry.key),
          ) as unknown as object)
        : (entry.value as object);

      const setting = await this.prisma.tenantSetting.upsert({
        where: { tenantId_key: { tenantId, key: entry.key } },
        create: {
          tenantId,
          key: entry.key,
          value: storedValue,
          category: entry.category ?? 'general',
          isSecret,
          description: entry.description ?? null,
        },
        update: {
          value: storedValue,
          category: entry.category ?? 'general',
          isSecret,
          ...(entry.description !== undefined ? { description: entry.description } : {}),
        },
      });

      results.push({
        id: setting.id,
        tenantId: setting.tenantId,
        key: setting.key,
        value: setting.isSecret ? { configured: true } : setting.value,
        category: setting.category,
        isSecret: setting.isSecret,
        description: setting.description,
        updatedAt: setting.updatedAt.toISOString(),
      });

      await this.audit.record({
        tenantId,
        actorType: AuditActorType.USER,
        actorId: context.actorId,
        action: AuditAction.TENANT_SETTING_UPDATED,
        outcome: AuditOutcome.SUCCESS,
        resourceType: 'TenantSetting',
        resourceId: setting.id,
        description: `Setting "${entry.key}" updated`,
        // The value itself is never audited when it is a secret.
        metadata: { key: entry.key, isSecret },
        ipHash: context.ipHash,
        requestId: context.requestId,
      });
    }

    return results;
  }

  async remove(tenantId: string, key: string): Promise<{ key: string; deleted: true }> {
    await this.prisma.tenantSetting.deleteMany({ where: { tenantId, key } });
    return { key, deleted: true };
  }

  private aad(tenantId: string, key: string): string {
    return `tenant_setting:${tenantId}:${key}`;
  }
}
