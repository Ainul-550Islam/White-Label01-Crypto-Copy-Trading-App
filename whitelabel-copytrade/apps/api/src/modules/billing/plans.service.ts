import { Injectable } from '@nestjs/common';
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
import type { CreatePlanDto, ListPlansDto, UpdatePlanDto } from './dto/plan.dto';

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
    context: { actorId: string; auditTenantId: string; ipHash: string; requestId: string },
  ): Promise<SubscriptionPlanDto> {
    // A platform operator authors catalogue plans (tenantId null); a tenant
    // admin can only author plans owned by their own tenant.
    const ownerTenantId = scope.isPlatformUser ? null : scope.tenantId;

    const duplicate = await this.prisma.subscriptionPlan.findFirst({
      where: { tenantId: ownerTenantId, code: dto.code, deletedAt: null },
      select: { id: true },
    });

    if (duplicate) {
      throw new ConflictException('A plan with this code already exists.', { code: dto.code });
    }

    const plan = await this.prisma.subscriptionPlan.create({
      data: {
        tenantId: ownerTenantId,
        code: dto.code,
        name: dto.name,
        description: dto.description ?? null,
        audience: dto.audience,
        price: new Prisma.Decimal(dto.price),
        currency: dto.currency,
        interval: dto.interval,
        trialDays: dto.trialDays,
        performanceFeeBps: dto.performanceFeeBps,
        platformFeeBps: dto.platformFeeBps,
        limits: { ...DEFAULT_LIMITS, ...(dto.limits ?? {}) } as unknown as Prisma.InputJsonValue,
        features: dto.features ?? [],
        isActive: dto.isActive,
        sortOrder: dto.sortOrder,
        externalPriceId: dto.externalPriceId ?? null,
      },
    });

    await this.cache.delete('billing:platform-catalogue');

    await this.audit.record({
      tenantId: context.auditTenantId,
      actorType: AuditActorType.USER,
      actorId: context.actorId,
      action: AuditAction.PLAN_CREATED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'SubscriptionPlan',
      resourceId: plan.id,
      description: `Created plan ${plan.code}`,
      ipHash: context.ipHash,
      requestId: context.requestId,
    });

    return this.toDto(plan);
  }

  async update(
    planId: string,
    dto: UpdatePlanDto,
    scope: { tenantId: string | null; isPlatformUser: boolean },
    context: { actorId: string; auditTenantId: string; ipHash: string; requestId: string },
  ): Promise<SubscriptionPlanDto> {
    const existing = await this.prisma.subscriptionPlan.findFirst({
      where: {
        id: planId,
        deletedAt: null,
        ...(scope.isPlatformUser ? {} : { tenantId: scope.tenantId }),
      },
    });

    if (!existing) {
      throw new NotFoundException('Subscription plan', planId);
    }

    const updated = await this.prisma.subscriptionPlan.update({
      where: { id: planId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.price !== undefined ? { price: new Prisma.Decimal(dto.price) } : {}),
        ...(dto.interval !== undefined ? { interval: dto.interval } : {}),
        ...(dto.trialDays !== undefined ? { trialDays: dto.trialDays } : {}),
        ...(dto.performanceFeeBps !== undefined
          ? { performanceFeeBps: dto.performanceFeeBps }
          : {}),
        ...(dto.platformFeeBps !== undefined ? { platformFeeBps: dto.platformFeeBps } : {}),
        ...(dto.limits !== undefined
          ? {
              limits: {
                ...DEFAULT_LIMITS,
                ...((existing.limits as unknown as PlanLimits) ?? {}),
                ...dto.limits,
              } as unknown as Prisma.InputJsonValue,
            }
          : {}),
        ...(dto.features !== undefined ? { features: dto.features } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.externalPriceId !== undefined ? { externalPriceId: dto.externalPriceId } : {}),
      },
    });

    await this.cache.delete('billing:platform-catalogue');

    await this.audit.record({
      tenantId: context.auditTenantId,
      actorType: AuditActorType.USER,
      actorId: context.actorId,
      action: AuditAction.PLAN_UPDATED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'SubscriptionPlan',
      resourceId: planId,
      changes: {
        plan: { before: this.toDto(existing), after: this.toDto(updated) },
      },
      ipHash: context.ipHash,
      requestId: context.requestId,
    });

    return this.toDto(updated);
  }

  async archive(
    planId: string,
    scope: { tenantId: string | null; isPlatformUser: boolean },
    context: { actorId: string; auditTenantId: string; ipHash: string; requestId: string },
  ): Promise<{ id: string; archived: true }> {
    const plan = await this.prisma.subscriptionPlan.findFirst({
      where: {
        id: planId,
        deletedAt: null,
        ...(scope.isPlatformUser ? {} : { tenantId: scope.tenantId }),
      },
      select: { id: true, code: true },
    });

    if (!plan) {
      throw new NotFoundException('Subscription plan', planId);
    }

    // Refuse to archive a plan that still has paying subscribers: the FK is
    // Restrict, and silently orphaning billing state is worse than an error.
    const activeSubscriptions = await this.prisma.tenantSubscription.count({
      where: { planId, status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE'] } },
    });

    if (activeSubscriptions > 0) {
      throw new ConflictException(
        'This plan still has active subscriptions and cannot be archived.',
        { activeSubscriptions },
      );
    }

    await this.prisma.subscriptionPlan.update({
      where: { id: planId },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.cache.delete('billing:platform-catalogue');

    await this.audit.record({
      tenantId: context.auditTenantId,
      actorType: AuditActorType.USER,
      actorId: context.actorId,
      action: AuditAction.PLAN_UPDATED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'SubscriptionPlan',
      resourceId: planId,
      description: `Archived plan ${plan.code}`,
      ipHash: context.ipHash,
      requestId: context.requestId,
    });

    return { id: planId, archived: true };
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
