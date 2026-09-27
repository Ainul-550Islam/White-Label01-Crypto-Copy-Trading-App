import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { createHash } from 'node:crypto';
import {
  AuditAction,
  AuditActorType,
  AuditOutcome,
  type FeatureFlagDto,
  type TenantFeatureFlagDto,
} from '@wlct/shared-types';
import { CACHE_KEY, CACHE_TTL, FEATURE_FLAG_KEYS } from '@wlct/config';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CacheService } from '../../infrastructure/redis/cache.service';
import { AuditService } from '../audit/audit.service';
import { NotFoundException } from '../../common/errors/app.exception';
import type { UpsertFeatureFlagDto, SetTenantFlagDto } from './dto/feature-flag.dto';

/**
 * Definitions applied to every newly provisioned tenant. Anything that touches
 * money, custody or compliance defaults to OFF: a brand must consciously turn
 * it on after the corresponding contractual and regulatory work is done.
 */
const TENANT_DEFAULTS: Record<string, boolean> = {
  [FEATURE_FLAG_KEYS.COPY_TRADING]: false,
  [FEATURE_FLAG_KEYS.FUTURES_TRADING]: false,
  [FEATURE_FLAG_KEYS.SPOT_TRADING]: false,
  [FEATURE_FLAG_KEYS.PAPER_TRADING]: true,
  [FEATURE_FLAG_KEYS.REFERRAL_PROGRAM]: false,
  [FEATURE_FLAG_KEYS.KYC_REQUIRED]: true,
  [FEATURE_FLAG_KEYS.TWO_FACTOR_MANDATORY]: false,
  [FEATURE_FLAG_KEYS.PUBLIC_REGISTRATION]: true,
  [FEATURE_FLAG_KEYS.CUSTOM_DOMAIN]: false,
  [FEATURE_FLAG_KEYS.MOBILE_APP]: true,
  [FEATURE_FLAG_KEYS.ADVANCED_ANALYTICS]: false,
  [FEATURE_FLAG_KEYS.WITHDRAWAL_NOTIFICATIONS]: true,
};

@Injectable()
export class FeatureFlagsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly audit: AuditService,
    @InjectPinoLogger(FeatureFlagsService.name) private readonly logger: PinoLogger,
  ) {}

  /** Resolved on/off map for a tenant, cached briefly to keep hot paths cheap. */
  async getAllForTenant(tenantId: string): Promise<Record<string, boolean>> {
    return this.cache.remember(
      CACHE_KEY.tenantFeatureFlags(tenantId),
      CACHE_TTL.FEATURE_FLAGS_SECONDS,
      async () => {
        const [definitions, overrides] = await Promise.all([
          this.prisma.featureFlag.findMany(),
          this.prisma.tenantFeatureFlag.findMany({
            where: { tenantId },
            include: { featureFlag: { select: { key: true } } },
          }),
        ]);

        const resolved: Record<string, boolean> = {};

        for (const definition of definitions) {
          resolved[definition.key] = definition.isGlobalDefault;
        }

        for (const override of overrides) {
          resolved[override.featureFlag.key] = override.enabled;
        }

        return resolved;
      },
    );
  }

  /**
   * Tenant-level check. Percentage rollouts are evaluated deterministically
   * from the tenant id so a tenant never flips between requests.
   */
  async isEnabled(tenantId: string, key: string): Promise<boolean> {
    const flags = await this.getAllForTenant(tenantId);
    if (flags[key] !== true) {
      return false;
    }

    const rollout = await this.getRolloutPercentage(tenantId, key);
    if (rollout >= 100) {
      return true;
    }
    if (rollout <= 0) {
      return false;
    }

    return this.bucket(`${tenantId}:${key}`) < rollout;
  }

  /**
   * User-level check for gradual rollouts inside a tenant that already has the
   * flag on. Bucketing by user id keeps the cohort stable.
   */
  async isEnabledForUser(tenantId: string, userId: string, key: string): Promise<boolean> {
    const flags = await this.getAllForTenant(tenantId);
    if (flags[key] !== true) {
      return false;
    }

    const rollout = await this.getRolloutPercentage(tenantId, key);
    if (rollout >= 100) {
      return true;
    }
    if (rollout <= 0) {
      return false;
    }

    return this.bucket(`${tenantId}:${userId}:${key}`) < rollout;
  }

  async listDefinitions(): Promise<FeatureFlagDto[]> {
    const definitions = await this.prisma.featureFlag.findMany({ orderBy: { key: 'asc' } });

    return definitions.map((definition) => ({
      id: definition.id,
      key: definition.key,
      name: definition.name,
      description: definition.description,
      isGlobalDefault: definition.isGlobalDefault,
      rolloutPercentage: definition.rolloutPercentage,
      createdAt: definition.createdAt.toISOString(),
      updatedAt: definition.updatedAt.toISOString(),
    }));
  }

  async listForTenant(tenantId: string): Promise<TenantFeatureFlagDto[]> {
    const overrides = await this.prisma.tenantFeatureFlag.findMany({
      where: { tenantId },
      include: { featureFlag: { select: { key: true } } },
      orderBy: { featureFlag: { key: 'asc' } },
    });

    return overrides.map((override) => ({
      id: override.id,
      tenantId: override.tenantId,
      featureFlagId: override.featureFlagId,
      key: override.featureFlag.key,
      enabled: override.enabled,
      rolloutPercentage: override.rolloutPercentage,
      metadata: (override.metadata as Record<string, unknown>) ?? {},
      updatedAt: override.updatedAt.toISOString(),
    }));
  }

  async upsertDefinition(
    dto: UpsertFeatureFlagDto,
    context: { actorId: string; tenantId: string; ipHash: string; requestId: string },
  ): Promise<FeatureFlagDto> {
    const definition = await this.prisma.featureFlag.upsert({
      where: { key: dto.key },
      create: {
        key: dto.key,
        name: dto.name,
        description: dto.description ?? null,
        isGlobalDefault: dto.isGlobalDefault ?? false,
        rolloutPercentage: dto.rolloutPercentage ?? 100,
      },
      update: {
        name: dto.name,
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.isGlobalDefault !== undefined ? { isGlobalDefault: dto.isGlobalDefault } : {}),
        ...(dto.rolloutPercentage !== undefined
          ? { rolloutPercentage: dto.rolloutPercentage }
          : {}),
      },
    });

    // A definition change can affect every tenant, so drop the whole namespace.
    await this.cache.deleteByPattern('tenant:*:feature-flags');

    await this.audit.record({
      tenantId: context.tenantId,
      actorType: AuditActorType.USER,
      actorId: context.actorId,
      action: AuditAction.FEATURE_FLAG_UPDATED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'FeatureFlag',
      resourceId: definition.id,
      description: `Feature flag definition "${dto.key}" saved`,
      ipHash: context.ipHash,
      requestId: context.requestId,
    });

    return {
      id: definition.id,
      key: definition.key,
      name: definition.name,
      description: definition.description,
      isGlobalDefault: definition.isGlobalDefault,
      rolloutPercentage: definition.rolloutPercentage,
      createdAt: definition.createdAt.toISOString(),
      updatedAt: definition.updatedAt.toISOString(),
    };
  }

  async setForTenant(
    tenantId: string,
    dto: SetTenantFlagDto,
    context: { actorId: string; ipHash: string; requestId: string },
  ): Promise<TenantFeatureFlagDto> {
    const definition = await this.prisma.featureFlag.findUnique({ where: { key: dto.key } });
    if (!definition) {
      throw new NotFoundException('Feature flag', dto.key);
    }

    const override = await this.prisma.tenantFeatureFlag.upsert({
      where: {
        tenantId_featureFlagId: { tenantId, featureFlagId: definition.id },
      },
      create: {
        tenantId,
        featureFlagId: definition.id,
        enabled: dto.enabled,
        rolloutPercentage: dto.rolloutPercentage ?? null,
        metadata: (dto.metadata ?? {}) as object,
      },
      update: {
        enabled: dto.enabled,
        ...(dto.rolloutPercentage !== undefined
          ? { rolloutPercentage: dto.rolloutPercentage }
          : {}),
        ...(dto.metadata !== undefined ? { metadata: dto.metadata as object } : {}),
      },
    });

    await this.cache.delete(
      CACHE_KEY.tenantFeatureFlags(tenantId),
      CACHE_KEY.tenantPublicConfig(tenantId),
    );

    this.logger.info(
      { event: 'feature_flag.changed', tenantId, key: dto.key, enabled: dto.enabled },
      'Tenant feature flag updated',
    );

    await this.audit.record({
      tenantId,
      actorType: AuditActorType.USER,
      actorId: context.actorId,
      action: AuditAction.FEATURE_FLAG_UPDATED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'TenantFeatureFlag',
      resourceId: override.id,
      description: `Feature "${dto.key}" ${dto.enabled ? 'enabled' : 'disabled'}`,
      changes: { enabled: { before: !dto.enabled, after: dto.enabled } },
      ipHash: context.ipHash,
      requestId: context.requestId,
    });

    return {
      id: override.id,
      tenantId: override.tenantId,
      featureFlagId: override.featureFlagId,
      key: definition.key,
      enabled: override.enabled,
      rolloutPercentage: override.rolloutPercentage,
      metadata: (override.metadata as Record<string, unknown>) ?? {},
      updatedAt: override.updatedAt.toISOString(),
    };
  }

  /** Writes the default override rows for a freshly provisioned tenant. */
  async applyDefaultsForTenant(tenantId: string): Promise<void> {
    const definitions = await this.prisma.featureFlag.findMany({
      where: { key: { in: Object.keys(TENANT_DEFAULTS) } },
      select: { id: true, key: true },
    });

    if (definitions.length === 0) {
      this.logger.warn(
        { event: 'feature_flag.defaults_missing', tenantId },
        'No feature flag definitions found; run the database seed',
      );
      return;
    }

    await this.prisma.tenantFeatureFlag.createMany({
      data: definitions.map((definition) => ({
        tenantId,
        featureFlagId: definition.id,
        enabled: TENANT_DEFAULTS[definition.key] ?? false,
      })),
      skipDuplicates: true,
    });

    await this.cache.delete(CACHE_KEY.tenantFeatureFlags(tenantId));
  }

  private async getRolloutPercentage(tenantId: string, key: string): Promise<number> {
    const definition = await this.prisma.featureFlag.findUnique({
      where: { key },
      select: {
        id: true,
        rolloutPercentage: true,
        tenantOverrides: {
          where: { tenantId },
          select: { rolloutPercentage: true },
          take: 1,
        },
      },
    });

    if (!definition) {
      return 0;
    }

    const override = definition.tenantOverrides[0]?.rolloutPercentage;
    return override ?? definition.rolloutPercentage;
  }

  /** Stable 0-99 bucket derived from a seed string. */
  private bucket(seed: string): number {
    const digest = createHash('sha256').update(seed).digest();
    return digest.readUInt32BE(0) % 100;
  }
}
