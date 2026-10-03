/**
 * Plan Repository - Data access layer for billing plans
 * 
 * This module handles database operations for plans including
 * CRUD operations, queries, and data persistence.
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { Plan, PlanFilter, PlanSummary, CreatePlanRequest, UpdatePlanRequest } from './plan.types';

export class PlanRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string, tenantId: string): Promise<Plan | null> {
    const plan = await this.prisma.plan.findFirst({
      where: {
        id,
        tenantId,
      },
      include: {
        features: true,
        limits: true,
      },
    });

    if (!plan) {
      return null;
    }

    return this.mapToDomain(plan);
  }

  async findBySlug(slug: string, tenantId: string): Promise<Plan | null> {
    const plan = await this.prisma.plan.findFirst({
      where: {
        slug,
        tenantId,
      },
      include: {
        features: true,
        limits: true,
      },
    });

    if (!plan) {
      return null;
    }

    return this.mapToDomain(plan);
  }

  async findMany(filter: PlanFilter, tenantId: string): Promise<Plan[]> {
    const where: any = { tenantId };

    if (filter.tier) {
      where.tier = filter.tier;
    }

    if (filter.status) {
      where.status = filter.status;
    }

    if (filter.search) {
      where.OR = [
        { name: { contains: filter.search, mode: 'insensitive' } },
        { description: { contains: filter.search, mode: 'insensitive' } },
      ];
    }

    const plans = await this.prisma.plan.findMany({
      where,
      include: {
        features: true,
        limits: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return plans.map(plan => this.mapToDomain(plan));
  }

  async findSummaries(tenantId: string): Promise<PlanSummary[]> {
    const plans = await this.prisma.plan.findMany({
      where: { tenantId, status: 'active' },
      select: {
        id: true,
        name: true,
        tier: true,
        status: true,
        price: true,
        _count: {
          select: {
            features: true,
            limits: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return plans.map(plan => ({
      id: plan.id,
      name: plan.name,
      tier: plan.tier as any,
      status: plan.status as any,
      price: plan.price as any,
      featureCount: plan._count.features,
      limitCount: plan._count.limits,
    }));
  }

  async create(data: CreatePlanRequest, tenantId: string, createdBy: string): Promise<Plan> {
    const plan = await this.prisma.plan.create({
      data: {
        tenantId,
        name: data.name,
        slug: data.slug,
        description: data.description,
        tier: data.tier,
        status: 'active',
        price: data.price as any,
        metadata: data.metadata || {},
        createdBy,
        updatedBy: createdBy,
        features: {
          create: data.features.map(feature => ({
            key: feature.key,
            name: feature.name,
            description: feature.description,
            enabled: feature.enabled,
            limit: feature.limit,
            unit: feature.unit,
          })),
        },
        limits: {
          create: data.limits.map(limit => ({
            key: limit.key,
            name: limit.name,
            description: limit.description,
            value: limit.value,
            unit: limit.unit,
            hardLimit: limit.hardLimit,
          })),
        },
      },
      include: {
        features: true,
        limits: true,
      },
    });

    return this.mapToDomain(plan);
  }

  async update(id: string, data: UpdatePlanRequest, tenantId: string, updatedBy: string): Promise<Plan> {
    // features/limits arrive as plain arrays, so they cannot ride the scalar
    // spread: when provided they replace the plan's rows wholesale (nested
    // deleteMany + create inside the same update, which Prisma runs as one
    // transaction).
    const { features, limits, price, ...scalars } = data;
    // Scoped by tenant (Prisma 5 extended unique where): a tenant can neither
    // edit another tenant's plan nor the platform catalogue (tenantId null).
    const plan = await this.prisma.plan.update({
      where: { id, tenantId },
      data: {
        ...scalars,
        ...(price !== undefined
          ? { price: price as unknown as Prisma.InputJsonValue }
          : {}),
        updatedBy,
        updatedAt: new Date(),
        ...(features
          ? {
              features: {
                deleteMany: {},
                create: features.map(feature => ({
                  key: feature.key,
                  name: feature.name,
                  description: feature.description,
                  enabled: feature.enabled,
                  limit: feature.limit,
                  unit: feature.unit,
                })),
              },
            }
          : {}),
        ...(limits
          ? {
              limits: {
                deleteMany: {},
                create: limits.map(limit => ({
                  key: limit.key,
                  name: limit.name,
                  description: limit.description,
                  value: limit.value,
                  unit: limit.unit,
                  hardLimit: limit.hardLimit,
                })),
              },
            }
          : {}),
      },
      include: {
        features: true,
        limits: true,
      },
    });

    return this.mapToDomain(plan);
  }

  async delete(id: string, tenantId: string): Promise<void> {
    // Scoped by tenant: deleting by id alone would let a caller remove another
    // tenant's (or the platform catalogue's) plan.
    const result = await this.prisma.plan.deleteMany({
      where: { id, tenantId },
    });
    if (result.count === 0) {
      throw new Error(`Plan not found: ${id}`);
    }
  }

  async count(tenantId: string): Promise<number> {
    return this.prisma.plan.count({
      where: { tenantId },
    });
  }

  private mapToDomain(plan: any): Plan {
    return {
      id: plan.id,
      tenantId: plan.tenantId,
      name: plan.name,
      slug: plan.slug,
      description: plan.description,
      tier: plan.tier,
      status: plan.status,
      price: plan.price,
      features: plan.features || [],
      limits: plan.limits || [],
      metadata: plan.metadata || {},
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
      createdBy: plan.createdBy,
      updatedBy: plan.updatedBy,
    };
  }
}