import { ForbiddenException, Injectable } from '@nestjs/common';
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
import { NotFoundException } from '../../common/errors/app.exception';
import type { UpsertFeatureFlagDto, SetTenantFlagDto } from './dto/feature-flag.dto';
import { claimMutationIntent } from '../developer-platform/developer-mutation-intent';

/**
 * Definitions applied to every newly provisioned tenant. Anything that touches
 * money, custody or compliance defaults to OFF: a brand must consciously turn
 * it on after the corresponding contractual and regulatory work is done.
 */
const GLOBAL_KILL_SWITCH_KEY = 'platform.kill_switch';

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
    @InjectPinoLogger(FeatureFlagsService.name) private readonly logger: PinoLogger,
  ) {}

  /** Resolved on/off map for a tenant, cached briefly to keep hot paths cheap. */
  async getAllForTenant(tenantId: string): Promise<Record<string, boolean>> {
    return this.cache.remember(
      CACHE_KEY.tenantFeatureFlags(tenantId),
      CACHE_TTL.FEATURE_FLAGS_SECONDS,
      async () => this.prisma.withTenantRls(tenantId, async (tx) => {
        const [definitions, overrides] = await Promise.all([
          tx.featureFlag.findMany(),
          tx.tenantFeatureFlag.findMany({
            where: { tenantId },
            include: { featureFlag: { select: { key: true } } },
          }),
        ]);

        const resolved: Record<string, boolean> = {};

        for (const definition of definitions) {
          resolved[definition.key] = definition.isGlobalDefault;
        }

        for (const override of overrides) {
          if (override.featureFlag.key !== GLOBAL_KILL_SWITCH_KEY) {
            resolved[override.featureFlag.key] = override.enabled;
          }
        }

        // A global kill switch is controlled only by the platform definition;
        // tenant overrides cannot re-enable a feature while it is engaged.
        const killSwitchActive = definitions.some(
          (definition) => definition.key === GLOBAL_KILL_SWITCH_KEY && definition.isGlobalDefault,
        );
        resolved[GLOBAL_KILL_SWITCH_KEY] = killSwitchActive;
        if (killSwitchActive) {
          for (const key of Object.keys(resolved)) {
            if (key !== GLOBAL_KILL_SWITCH_KEY) resolved[key] = false;
          }
        }

        return resolved;
      }),
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
    const overrides = await this.prisma.withTenantRls(tenantId, (tx) => tx.tenantFeatureFlag.findMany({
      where: { tenantId },
      include: { featureFlag: { select: { key: true } } },
      orderBy: { featureFlag: { key: 'asc' } },
    }));

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
    idempotencyKey: string,
  ): Promise<FeatureFlagDto> {
    const definition = await this.prisma.withTenantRls(context.tenantId, async (tx) => {
      // Global definitions can be changed by different platform tenants; lock
      // by flag key as well as recording the tenant-scoped intent.
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext('feature-flag-global'), hashtext(${dto.key}))`;
      await claimMutationIntent(tx, context.tenantId, idempotencyKey, 'feature_flag.definition', dto.key);
      const saved = await tx.featureFlag.upsert({
        where: { key: dto.key },
        create: {
          key: dto.key, name: dto.name, description: dto.description ?? null,
          isGlobalDefault: dto.isGlobalDefault ?? false, rolloutPercentage: dto.rolloutPercentage ?? 100,
        },
        update: {
          name: dto.name,
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.isGlobalDefault !== undefined ? { isGlobalDefault: dto.isGlobalDefault } : {}),
          ...(dto.rolloutPercentage !== undefined ? { rolloutPercentage: dto.rolloutPercentage } : {}),
        },
      });
      await tx.auditLog.create({ data: {
        tenantId: context.tenantId, actorType: AuditActorType.USER, actorId: context.actorId,
        action: AuditAction.FEATURE_FLAG_UPDATED, outcome: AuditOutcome.SUCCESS,
        resourceType: 'FeatureFlag', resourceId: saved.id,
        description: `Feature flag definition "${dto.key}" saved`,
        ipHash: context.ipHash, requestId: context.requestId,
      } });
      return saved;
    });
    // A definition can affect every tenant. If Redis is temporarily unavailable,
    // the committed result is still returned and bounded TTLs expire the cache.
    try {
      await this.cache.deleteByPattern('tenant:*:feature-flags');
    } catch {
      this.logger.warn({ event: 'feature_flag.definition_cache_invalidation_failed' }, 'Feature flag cache will expire');
    }
    return {
      id: definition.id, key: definition.key, name: definition.name,
      description: definition.description, isGlobalDefault: definition.isGlobalDefault,
      rolloutPercentage: definition.rolloutPercentage,
      createdAt: definition.createdAt.toISOString(), updatedAt: definition.updatedAt.toISOString(),
    };
  }

  /**
   * The intent, override and primary audit record commit together. Reusing a
   * key is a conflict rather than a second write, including after a lost HTTP
   * response. An advisory transaction lock also serialises different keys for
   * the same tenant/flag so before/after audit values are accurate.
   */
  async setForTenant(
    tenantId: string,
    dto: SetTenantFlagDto,
    context: { actorId: string; ipHash: string; requestId: string },
    idempotencyKey: string,
  ): Promise<TenantFeatureFlagDto> {
    if (dto.key === GLOBAL_KILL_SWITCH_KEY) {
      throw new ForbiddenException('The platform kill switch cannot be changed by a tenant.');
    }
    const result = await this.prisma.withTenantRls(tenantId, async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext('feature-flag'), hashtext(${`${tenantId}:${dto.key}`}))`;
      const definition = await tx.featureFlag.findUnique({ where: { key: dto.key } });
      if (!definition) throw new NotFoundException('Feature flag', dto.key);
      if (dto.enabled) {
        const subscription = await tx.tenantSubscription.findFirst({
          where: { tenantId, status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] } },
          orderBy: { currentPeriodStart: 'desc' },
          select: { plan: { select: { features: true, limits: true } } },
        });
        // Entitlement has two lawful spellings and either alone suffices:
        //   - the plan's feature list names the flag key (the amenities the
        //     tenant is buying, e.g. 'live_trading'), or
        //   - the plan's limits carry a strict boolean grant
        //     `tenant_flag_grant_<key>: true` (a targeted override; the string
        //     "true" or any other JSON value is NOT a grant).
        const features = subscription?.plan.features;
        const grantedByFeatures = Array.isArray(features) && features.includes(dto.key);
        const limits = subscription?.plan.limits;
        const grantedByLimits = !!(limits && typeof limits === 'object' && !Array.isArray(limits)
          && (limits as Record<string, unknown>)[`tenant_flag_grant_${dto.key}`] === true);
        if (!grantedByFeatures && !grantedByLimits) {
          throw new ForbiddenException('The current plan does not grant this feature.');
        }
      }
      await claimMutationIntent(tx, tenantId, idempotencyKey, 'feature_flag.set', dto.key);
      const previous = await tx.tenantFeatureFlag.findUnique({
        where: { tenantId_featureFlagId: { tenantId, featureFlagId: definition.id } },
        select: { enabled: true },
      });
      const override = await tx.tenantFeatureFlag.upsert({
        where: { tenantId_featureFlagId: { tenantId, featureFlagId: definition.id } },
        create: {
          tenantId, featureFlagId: definition.id, enabled: dto.enabled,
          rolloutPercentage: dto.rolloutPercentage ?? null,
          metadata: (dto.metadata ?? {}) as object,
        },
        update: {
          enabled: dto.enabled,
          ...(dto.rolloutPercentage !== undefined ? { rolloutPercentage: dto.rolloutPercentage } : {}),
          ...(dto.metadata !== undefined ? { metadata: dto.metadata as object } : {}),
        },
      });
      await tx.auditLog.create({ data: {
        tenantId, actorType: AuditActorType.USER, actorId: context.actorId,
        action: AuditAction.FEATURE_FLAG_UPDATED, outcome: AuditOutcome.SUCCESS,
        resourceType: 'TenantFeatureFlag', resourceId: override.id,
        description: 'Tenant feature flag override updated',
        changes: { enabled: { before: previous?.enabled ?? null, after: dto.enabled } },
        ipHash: context.ipHash, requestId: context.requestId,
      } });
      return { override, key: definition.key };
    });
    // Cache failure must not disguise a committed write as an uncommitted one.
    // The cache entries have bounded TTLs and will self-expire if Redis is down.
    try {
      await this.cache.delete(CACHE_KEY.tenantFeatureFlags(tenantId), CACHE_KEY.tenantPublicConfig(tenantId));
    } catch {
      this.logger.warn({ event: 'feature_flag.cache_invalidation_failed', tenantId }, 'Feature flag cache will expire');
    }
    this.logger.info({ event: 'feature_flag.changed', tenantId, key: dto.key, enabled: dto.enabled }, 'Tenant feature flag updated');
    const { override, key } = result;
    return {
      id: override.id, tenantId: override.tenantId, featureFlagId: override.featureFlagId,
      key, enabled: override.enabled, rolloutPercentage: override.rolloutPercentage,
      metadata: (override.metadata as Record<string, unknown>) ?? {}, updatedAt: override.updatedAt.toISOString(),
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

    await this.prisma.withTenantRls(tenantId, (tx) => tx.tenantFeatureFlag.createMany({
      data: definitions.map((definition) => ({
        tenantId,
        featureFlagId: definition.id,
        enabled: TENANT_DEFAULTS[definition.key] ?? false,
      })),
      skipDuplicates: true,
    }));

    await this.cache.delete(CACHE_KEY.tenantFeatureFlags(tenantId));
  }

  private async getRolloutPercentage(tenantId: string, key: string): Promise<number> {
    const definition = await this.prisma.withTenantRls(tenantId, (tx) => tx.featureFlag.findUnique({
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
    }));

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
