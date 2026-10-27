import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { claimMutationIntent } from '../developer-platform/developer-mutation-intent';
import { Prisma } from '@prisma/client';
import {
  AuditAction,
  AuditActorType,
  AuditOutcome,
  BillingInterval,
  PlanAudience,
  type PaginatedResult,
  type PlanLimits,
  type SubscriptionPlanDto,
  type SupportedCurrency,
} from '@wlct/shared-types';
import { CACHE_TTL } from '@wlct/config';
import { buildPaginationMeta, normalisePagination } from '@wlct/utils';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CacheService } from '../../infrastructure/redis/cache.service';
import { AuditService } from '../audit/audit.service';
import { ConflictException, NotFoundException } from '../../common/errors/app.exception';
import type { CreatePlanDto, ListPlansDto, UpdatePlanDto, PlanGrantsDto } from './dto/plan.dto';

const SORTABLE_FIELDS = ['sortOrder', 'price', 'createdAt', 'name'] as const;

const DEFAULT_LIMITS: PlanLimits = {
  maxUsers: null,
  maxTraders: null,
  maxFollowersPerTrader: null,
  maxExchangeAccountsPerUser: null,
  maxCopySubscriptionsPerFollower: null,
  maxApiRequestsPerMinute: null,
  websocketConnections: null,
  customDomain: false,
  whiteLabelMobileApp: false,
  prioritySupport: false,
};

/**
 * The plan catalogue.
 *
 * Two audiences share one table: platform plans sold to tenants
 * (`tenantId = null`, audience TENANT) and per-tenant plans a brand sells to
 * its own users (audience END_USER). Reads are always filtered by the caller's
 * scope so a tenant can never see or edit another tenant's commercial terms.
 */
@Injectable()
export class PlansService {
  private readonly logger = new Logger(PlansService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly audit: AuditService,
  ) {}

  async list(
    query: ListPlansDto,
    scope: { tenantId: string | null; isPlatformUser: boolean },
  ): Promise<PaginatedResult<SubscriptionPlanDto>> {
    const pagination = normalisePagination(query, SORTABLE_FIELDS);

    const where: Prisma.SubscriptionPlanWhereInput = {
      deletedAt: null,
      ...(query.includeInactive ? {} : { isActive: true }),
      ...(query.audience ? { audience: query.audience } : {}),
      // Platform operators see the whole catalogue; a tenant sees the platform
      // plans it can buy plus the plans it owns.
      ...(scope.isPlatformUser
        ? {}
        : { OR: [{ tenantId: null }, { tenantId: scope.tenantId }] }),
    };

    const [items, totalItems] = await this.prisma.$transaction([
      this.prisma.subscriptionPlan.findMany({
        where,
        orderBy: { [pagination.sortBy ?? 'sortOrder']: pagination.sortOrder },
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.subscriptionPlan.count({ where }),
    ]);

    return {
      items: items.map((plan) => this.toDto(plan)),
      pagination: buildPaginationMeta(pagination.page, pagination.limit, totalItems),
    };
  }

  /** Cached read of the active platform catalogue used on public pricing pages. */
  async getPlatformCatalogue(): Promise<SubscriptionPlanDto[]> {
    return this.cache.remember('billing:platform-catalogue', CACHE_TTL.PLAN_CATALOG_SECONDS, async () => {
      const plans = await this.prisma.subscriptionPlan.findMany({
        where: {
          tenantId: null,
          audience: PlanAudience.TENANT,
          isActive: true,
          deletedAt: null,
        },
        orderBy: { sortOrder: 'asc' },
      });

      return plans.map((plan) => this.toDto(plan));
    });
  }

  async findById(
    planId: string,
    scope: { tenantId: string | null; isPlatformUser: boolean },
  ): Promise<SubscriptionPlanDto> {
    const plan = await this.prisma.subscriptionPlan.findFirst({
      where: {
        id: planId,
        deletedAt: null,
        ...(scope.isPlatformUser
          ? {}
          : { OR: [{ tenantId: null }, { tenantId: scope.tenantId }] }),
      },
    });

    if (!plan) {
      throw new NotFoundException('Subscription plan', planId);
    }

    return this.toDto(plan);
  }

  async create(
    dto: CreatePlanDto,
    scope: { tenantId: string | null; isPlatformUser: boolean },
    context: { actorId: string; auditTenantId: string; ipHash: string; requestId: string; idempotencyKey: string },
  ): Promise<SubscriptionPlanDto> {
    const ownerTenantId = scope.isPlatformUser ? null : scope.tenantId;
    if (!scope.isPlatformUser && !ownerTenantId) throw new ForbiddenException('Tenant context required');
    const plan = await this.prisma.withTenantRls(context.auditTenantId, async (tx) => {
      await claimMutationIntent(tx, context.auditTenantId, context.idempotencyKey, 'plan.create', dto.code);
      const lockKey = `plan:${ownerTenantId ?? 'platform'}:${dto.code}`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text`;
      const duplicate = await tx.subscriptionPlan.findFirst({ where: { tenantId: ownerTenantId, code: dto.code, deletedAt: null }, select: { id: true } });
      if (duplicate) throw new ConflictException('A plan with this code already exists.', { code: dto.code });
      const created = await tx.subscriptionPlan.create({ data: {
        tenantId: ownerTenantId, code: dto.code, name: dto.name, description: dto.description ?? null,
        audience: dto.audience, price: new Prisma.Decimal(dto.price), currency: dto.currency, interval: dto.interval,
        trialDays: dto.trialDays, performanceFeeBps: dto.performanceFeeBps, platformFeeBps: dto.platformFeeBps,
        limits: { ...DEFAULT_LIMITS, ...Object.fromEntries(Object.entries(dto.limits ?? {}).filter(([, value]) => value !== undefined)) } as unknown as Prisma.InputJsonValue,
        features: dto.features ?? [], isActive: dto.isActive, sortOrder: dto.sortOrder, externalPriceId: dto.externalPriceId ?? null,
      } });
      await this.auditPlanMutation(tx, context, created.id, AuditAction.PLAN_CREATED, Object.keys(dto));
      return created;
    });
    await this.invalidateCatalogue();
    const response = this.toDto(plan);
    // Return a submitted provider price identifier only on this protected
    // mutation response so the caller can verify it, not in public catalogue reads.
    return dto.externalPriceId === undefined ? response : Object.assign(response, { externalPriceId: plan.externalPriceId });
  }

  async update(
    planId: string,
    dto: UpdatePlanDto,
    scope: { tenantId: string | null; isPlatformUser: boolean },
    context: { actorId: string; auditTenantId: string; ipHash: string; requestId: string; idempotencyKey: string },
  ): Promise<SubscriptionPlanDto> {
    const updated = await this.prisma.withTenantRls(context.auditTenantId, async (tx) => {
      await claimMutationIntent(tx, context.auditTenantId, context.idempotencyKey, 'plan.update', planId);
      await tx.$queryRaw`SELECT id FROM subscription_plans WHERE id = ${planId}::uuid FOR UPDATE`;
      const existing = await tx.subscriptionPlan.findFirst({ where: { id: planId, deletedAt: null, ...(scope.isPlatformUser ? {} : { tenantId: scope.tenantId }) } });
      if (!existing) throw new NotFoundException('Subscription plan', planId);
      const providedLimits = dto.limits ? Object.fromEntries(Object.entries(dto.limits).filter(([, value]) => value !== undefined)) : undefined;
      const result = await tx.subscriptionPlan.update({ where: { id: planId }, data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.price !== undefined ? { price: new Prisma.Decimal(dto.price) } : {}),
        ...(dto.interval !== undefined ? { interval: dto.interval } : {}),
        ...(dto.trialDays !== undefined ? { trialDays: dto.trialDays } : {}),
        ...(dto.performanceFeeBps !== undefined ? { performanceFeeBps: dto.performanceFeeBps } : {}),
        ...(dto.platformFeeBps !== undefined ? { platformFeeBps: dto.platformFeeBps } : {}),
        ...(providedLimits !== undefined ? { limits: { ...DEFAULT_LIMITS, ...((existing.limits as unknown as PlanLimits) ?? {}), ...providedLimits } as unknown as Prisma.InputJsonValue } : {}),
        ...(dto.features !== undefined ? { features: dto.features } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.externalPriceId !== undefined ? { externalPriceId: dto.externalPriceId } : {}),
      } });
      await this.auditPlanMutation(tx, context, planId, AuditAction.PLAN_UPDATED, Object.keys(dto));
      return result;
    });
    await this.invalidateCatalogue();
    const response = this.toDto(updated);
    return dto.externalPriceId === undefined ? response : Object.assign(response, { externalPriceId: updated.externalPriceId });
  }

  async archive(
    planId: string,
    scope: { tenantId: string | null; isPlatformUser: boolean },
    context: { actorId: string; auditTenantId: string; ipHash: string; requestId: string; idempotencyKey: string },
  ): Promise<{ id: string; archived: true }> {
    await this.prisma.withTenantRls(context.auditTenantId, async (tx) => {
      await claimMutationIntent(tx, context.auditTenantId, context.idempotencyKey, 'plan.archive', planId);
      await tx.$queryRaw`SELECT id FROM subscription_plans WHERE id = ${planId}::uuid FOR UPDATE`;
      const plan = await tx.subscriptionPlan.findFirst({ where: { id: planId, deletedAt: null, ...(scope.isPlatformUser ? {} : { tenantId: scope.tenantId }) }, select: { id: true, tenantId: true } });
      if (!plan) throw new NotFoundException('Subscription plan', planId);
      const [check] = await tx.$queryRaw<Array<{ has_live: boolean }>>`SELECT plan_has_live_subscribers(${planId}::uuid) AS has_live`;
      if (!check || typeof check.has_live !== 'boolean') throw new Error('Global subscription visibility unavailable');
      if (check.has_live) throw new ConflictException('This plan still has active subscriptions and cannot be archived.');
      await tx.subscriptionPlan.update({ where: { id: planId }, data: { deletedAt: new Date(), isActive: false } });
      await this.auditPlanMutation(tx, context, planId, AuditAction.PLAN_UPDATED, ['archive']);
    });
    await this.invalidateCatalogue();
    return { id: planId, archived: true };
  }

  /** Only a platform operator can change machine-readable grants on a platform plan. */
  async updateGrants(planId: string, dto: PlanGrantsDto, scope: { isPlatformUser: boolean },
    context: { actorId: string; auditTenantId: string; ipHash: string; requestId: string; idempotencyKey: string }): Promise<SubscriptionPlanDto> {
    if (!scope.isPlatformUser) throw new ForbiddenException('Platform operator required');
    const updated = await this.prisma.withTenantRls(context.auditTenantId, async (tx) => {
      await claimMutationIntent(tx, context.auditTenantId, context.idempotencyKey, 'plan.grants', planId);
      await tx.$queryRaw`SELECT id FROM subscription_plans WHERE id = ${planId}::uuid FOR UPDATE`;
      const existing = await tx.subscriptionPlan.findFirst({ where: { id: planId, tenantId: null, deletedAt: null } });
      if (!existing) throw new NotFoundException('Platform subscription plan', planId);
      const oldLimits = existing.limits && typeof existing.limits === 'object' && !Array.isArray(existing.limits) ? existing.limits : {};
      const limits = { ...oldLimits, ...dto, developer_pkce_required: 1 } as Prisma.InputJsonValue;
      const result = await tx.subscriptionPlan.update({ where: { id: planId }, data: { limits } });
      await this.auditPlanMutation(tx, context, planId, AuditAction.PLAN_UPDATED, Object.keys(dto));
      return result;
    });
    await this.invalidateCatalogue();
    return this.toDto(updated);
  }

  private async invalidateCatalogue(): Promise<void> {
    try { await this.cache.delete('billing:platform-catalogue'); }
    catch { this.logger.warn('Plan catalogue cache invalidation failed; bounded cache entries will expire'); }
  }

  private async auditPlanMutation(tx: Prisma.TransactionClient, context: { actorId: string; auditTenantId: string; ipHash: string; requestId: string }, planId: string, action: AuditAction, fields: string[]): Promise<void> {
    await tx.auditLog.create({ data: { tenantId: context.auditTenantId, actorType: AuditActorType.USER, actorId: context.actorId, action,
      outcome: AuditOutcome.SUCCESS, resourceType: 'SubscriptionPlan', resourceId: planId, description: 'Subscription plan changed',
      metadata: { fields }, ipHash: context.ipHash, requestId: context.requestId } });
  }

  toDto(plan: {
    id: string;
    tenantId: string | null;
    code: string;
    name: string;
    description: string | null;
    audience: string;
    price: Prisma.Decimal;
    currency: string;
    interval: string;
    trialDays: number;
    performanceFeeBps: number;
    platformFeeBps: number;
    limits: unknown;
    features: string[];
    isActive: boolean;
    sortOrder: number;
    createdAt: Date;
    updatedAt: Date;
  }): SubscriptionPlanDto {
    return {
      id: plan.id,
      tenantId: plan.tenantId,
      code: plan.code,
      name: plan.name,
      description: plan.description,
      audience: plan.audience as PlanAudience,
      price: plan.price.toFixed(6),
      currency: plan.currency as SupportedCurrency,
      interval: plan.interval as BillingInterval,
      trialDays: plan.trialDays,
      performanceFeeBps: plan.performanceFeeBps,
      platformFeeBps: plan.platformFeeBps,
      limits: { ...DEFAULT_LIMITS, ...((plan.limits as PlanLimits) ?? {}) },
      features: plan.features,
      isActive: plan.isActive,
      sortOrder: plan.sortOrder,
      createdAt: plan.createdAt.toISOString(),
      updatedAt: plan.updatedAt.toISOString(),
    };
  }
}
