import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import {
  AuditAction,
  AuditActorType,
  AuditOutcome,
  SystemRole,
  TenantStatus,
  type PaginatedResult,
  type SupportedCurrency,
  type SupportedLocale,
  type TenantDto,
  type TenantPublicConfigDto,
} from '@wlct/shared-types';
import { CACHE_KEY, CACHE_TTL } from '@wlct/config';
import { buildPaginationMeta, normalisePagination } from '@wlct/utils';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CacheService } from '../../infrastructure/redis/cache.service';
import { CryptoService } from '../../infrastructure/crypto/crypto.service';
import { PasswordService } from '../../infrastructure/crypto/password.service';
import { TenantResolverService } from './tenant-resolver.service';
import { AuditService } from '../audit/audit.service';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { ConflictException, NotFoundException } from '../../common/errors/app.exception';
import type { CreateTenantDto } from './dto/create-tenant.dto';
import type { UpdateTenantDto, UpdateTenantStatusDto } from './dto/update-tenant.dto';
import type { ListTenantsDto } from './dto/list-tenants.dto';
import type { CreateTenantDomainDto } from './dto/tenant-settings.dto';

const SORTABLE_FIELDS = ['createdAt', 'name', 'slug', 'status'] as const;

const TENANT_INCLUDE = {
  branding: true,
  domains: true,
} satisfies Prisma.TenantInclude;

type TenantRecord = Prisma.TenantGetPayload<{ include: typeof TENANT_INCLUDE }>;

/**
 * Tenant lifecycle and the public bootstrap configuration consumed by clients.
 *
 * Creating a tenant provisions its complete environment atomically: branding,
 * default settings, the system role set cloned for the tenant, feature flag
 * defaults and (optionally) the first administrator. A partially provisioned
 * brand is worse than none, so everything happens in one transaction.
 */
@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly crypto: CryptoService,
    private readonly passwords: PasswordService,
    private readonly resolver: TenantResolverService,
    private readonly audit: AuditService,
    private readonly featureFlags: FeatureFlagsService,
    @InjectPinoLogger(TenantsService.name) private readonly logger: PinoLogger,
  ) {}

  async list(query: ListTenantsDto): Promise<PaginatedResult<TenantDto>> {
    const pagination = normalisePagination(query, SORTABLE_FIELDS);

    const where: Prisma.TenantWhereInput = {
      ...(query.includeDeleted ? {} : { deletedAt: null }),
      ...(query.status ? { status: query.status } : {}),
      ...(pagination.search
        ? {
            OR: [
              { name: { contains: pagination.search, mode: 'insensitive' } },
              { slug: { contains: pagination.search.toLowerCase() } },
              { contactEmail: { contains: pagination.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, totalItems] = await this.prisma.$transaction([
      this.prisma.tenant.findMany({
        where,
        include: TENANT_INCLUDE,
        orderBy: { [pagination.sortBy ?? 'createdAt']: pagination.sortOrder },
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.tenant.count({ where }),
    ]);

    return {
      items: items.map((tenant) => this.toDto(tenant)),
      pagination: buildPaginationMeta(pagination.page, pagination.limit, totalItems),
    };
  }

  async findById(tenantId: string): Promise<TenantDto> {
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: tenantId, deletedAt: null },
      include: TENANT_INCLUDE,
    });

    if (!tenant) {
      throw new NotFoundException('Tenant', tenantId);
    }

    return this.toDto(tenant);
  }

  /**
   * Unauthenticated bootstrap payload: branding, locales and feature flags that
   * a mobile app or web client needs before a user signs in. Contains nothing
   * sensitive by design.
   */
  async getPublicConfig(tenantId: string): Promise<TenantPublicConfigDto> {
    return this.cache.remember(
      CACHE_KEY.tenantPublicConfig(tenantId),
      CACHE_TTL.TENANT_PUBLIC_CONFIG_SECONDS,
      async () => {
        const tenant = await this.prisma.tenant.findFirst({
          where: { id: tenantId, deletedAt: null },
          include: { branding: true },
        });

        if (!tenant) {
          throw new NotFoundException('Tenant', tenantId);
        }

        const flags = await this.featureFlags.getAllForTenant(tenantId);

        return {
          tenantId: tenant.id,
          slug: tenant.slug,
          name: tenant.name,
          status: tenant.status as TenantStatus,
          branding: {
            appName: tenant.branding?.appName ?? tenant.name,
            logoUrl: tenant.branding?.logoUrl ?? null,
            logoDarkUrl: tenant.branding?.logoDarkUrl ?? null,
            faviconUrl: tenant.branding?.faviconUrl ?? null,
            primaryColor: tenant.branding?.primaryColor ?? '#1B2A4A',
            secondaryColor: tenant.branding?.secondaryColor ?? '#0F172A',
            accentColor: tenant.branding?.accentColor ?? '#22C55E',
            backgroundColor: tenant.branding?.backgroundColor ?? '#FFFFFF',
            textColor: tenant.branding?.textColor ?? '#0B1220',
            fontFamily: tenant.branding?.fontFamily ?? 'Inter',
            themeMode: (tenant.branding?.themeMode ?? 'system') as 'light' | 'dark' | 'system',
            supportEmail: tenant.branding?.supportEmail ?? null,
            supportUrl: tenant.branding?.supportUrl ?? null,
            termsUrl: tenant.branding?.termsUrl ?? null,
            privacyUrl: tenant.branding?.privacyUrl ?? null,
            customCss: tenant.branding?.customCss ?? null,
            socialLinks: (tenant.branding?.socialLinks as Record<string, string>) ?? {},
          },
          defaultLocale: tenant.defaultLocale as SupportedLocale,
          supportedLocales: tenant.supportedLocales as SupportedLocale[],
          defaultCurrency: tenant.defaultCurrency as SupportedCurrency,
          supportedCurrencies: tenant.supportedCurrencies as SupportedCurrency[],
          features: flags,
          registrationEnabled: flags.public_registration ?? true,
          twoFactorRequired: flags.two_factor_mandatory ?? false,
        };
      },
    );
  }

  async create(
    dto: CreateTenantDto,
    context: { actorId: string; ipHash: string; requestId: string },
  ): Promise<TenantDto> {
    const existing = await this.prisma.tenant.findUnique({
      where: { slug: dto.slug },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException('This slug is already taken by another organisation.', {
        slug: dto.slug,
      });
    }

    const ownerPasswordHash = dto.owner ? await this.passwords.hash(dto.owner.password) : null;
    if (dto.owner) {
      this.passwords.assertPolicy(dto.owner.password, { email: dto.owner.email });
    }

    const systemRoleTemplates = await this.prisma.role.findMany({
      where: { tenantId: null, isSystem: true, scope: 'TENANT', deletedAt: null },
      include: { permissions: { select: { permissionId: true } } },
    });

    const tenant = await this.prisma.$transaction(async (tx) => {
      const created = await tx.tenant.create({
        data: {
          slug: dto.slug,
          name: dto.name,
          legalName: dto.legalName ?? null,
          status: TenantStatus.ACTIVE,
          contactEmail: dto.contactEmail,
          contactPhone: dto.contactPhone ?? null,
          countryCode: dto.countryCode ?? null,
          defaultLocale: dto.defaultLocale,
          supportedLocales: dto.supportedLocales,
          defaultCurrency: dto.defaultCurrency,
          supportedCurrencies: dto.supportedCurrencies,
          timezone: dto.timezone,
          platformFeeBps: dto.platformFeeBps,
          performanceFeeBps: dto.performanceFeeBps,
          maxUsers: dto.maxUsers ?? null,
          maxTraders: dto.maxTraders ?? null,
          branding: {
            create: {
              appName: dto.name,
            },
          },
        },
        select: { id: true, slug: true },
      });

      // Clone the platform role templates so the tenant owns editable copies
      // while keeping the same keys the guards already understand.
      for (const template of systemRoleTemplates) {
        await tx.role.create({
          data: {
            tenantId: created.id,
            key: template.key,
            name: template.name,
            description: template.description,
            scope: template.scope,
            isSystem: true,
            isDefault: template.key === SystemRole.FOLLOWER,
            priority: template.priority,
            permissions: {
              create: template.permissions.map((entry) => ({ permissionId: entry.permissionId })),
            },
          },
        });
      }

      if (dto.owner && ownerPasswordHash) {
        const adminRole = await tx.role.findFirst({
          where: { tenantId: created.id, key: SystemRole.TENANT_ADMIN },
          select: { id: true },
        });

        const owner = await tx.user.create({
          data: {
            tenantId: created.id,
            email: dto.owner.email,
            emailIndex: this.crypto.blindIndex(dto.owner.email),
            passwordHash: ownerPasswordHash,
            status: 'ACTIVE',
            emailVerifiedAt: new Date(),
            profile: {
              create: {
                firstName: dto.owner.firstName ?? null,
                lastName: dto.owner.lastName ?? null,
                locale: dto.defaultLocale,
                preferredCurrency: dto.defaultCurrency,
                timezone: dto.timezone,
              },
            },
          },
          select: { id: true },
        });

        if (adminRole) {
          await tx.userRole.create({
            data: { userId: owner.id, roleId: adminRole.id, tenantId: created.id },
          });
        }

        await tx.tenant.update({
          where: { id: created.id },
          data: { ownerUserId: owner.id },
        });
      }

      if (dto.planId) {
        const plan = await tx.subscriptionPlan.findFirst({
          where: { id: dto.planId, deletedAt: null },
          select: { id: true, trialDays: true, interval: true },
        });

        if (plan) {
          const periodEnd = new Date();
          periodEnd.setMonth(
            periodEnd.getMonth() +
              (plan.interval === 'YEARLY' ? 12 : plan.interval === 'QUARTERLY' ? 3 : 1),
          );

          await tx.tenantSubscription.create({
            data: {
              tenantId: created.id,
              planId: plan.id,
              status: plan.trialDays > 0 ? 'TRIALING' : 'ACTIVE',
              currentPeriodEnd: periodEnd,
              trialEndsAt:
                plan.trialDays > 0
                  ? new Date(Date.now() + plan.trialDays * 86_400_000)
                  : null,
            },
          });
        }
      }

      return created;
    });

    await this.featureFlags.applyDefaultsForTenant(tenant.id);

    this.logger.info(
      { event: 'tenant.created', tenantId: tenant.id, slug: tenant.slug },
      'Tenant provisioned',
    );

    await this.audit.recordImmediate({
      tenantId: tenant.id,
      actorType: AuditActorType.USER,
      actorId: context.actorId,
      action: AuditAction.TENANT_CREATED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'Tenant',
      resourceId: tenant.id,
      description: `Created tenant ${dto.slug}`,
      metadata: { slug: dto.slug, withOwner: Boolean(dto.owner) },
      ipHash: context.ipHash,
      requestId: context.requestId,
    });

    return this.findById(tenant.id);
  }

  async update(
    tenantId: string,
    dto: UpdateTenantDto,
    context: { actorId: string; ipHash: string; requestId: string },
  ): Promise<TenantDto> {
    const before = await this.prisma.tenant.findFirst({
      where: { id: tenantId, deletedAt: null },
      include: TENANT_INCLUDE,
    });

    if (!before) {
      throw new NotFoundException('Tenant', tenantId);
    }

    const updated = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.legalName !== undefined ? { legalName: dto.legalName } : {}),
        ...(dto.contactEmail !== undefined ? { contactEmail: dto.contactEmail } : {}),
        ...(dto.contactPhone !== undefined ? { contactPhone: dto.contactPhone } : {}),
        ...(dto.countryCode !== undefined ? { countryCode: dto.countryCode } : {}),
        ...(dto.defaultLocale !== undefined ? { defaultLocale: dto.defaultLocale } : {}),
        ...(dto.supportedLocales !== undefined ? { supportedLocales: dto.supportedLocales } : {}),
        ...(dto.defaultCurrency !== undefined ? { defaultCurrency: dto.defaultCurrency } : {}),
        ...(dto.supportedCurrencies !== undefined
          ? { supportedCurrencies: dto.supportedCurrencies }
          : {}),
        ...(dto.timezone !== undefined ? { timezone: dto.timezone } : {}),
        ...(dto.platformFeeBps !== undefined ? { platformFeeBps: dto.platformFeeBps } : {}),
        ...(dto.performanceFeeBps !== undefined
          ? { performanceFeeBps: dto.performanceFeeBps }
          : {}),
        ...(dto.maxUsers !== undefined ? { maxUsers: dto.maxUsers } : {}),
        ...(dto.maxTraders !== undefined ? { maxTraders: dto.maxTraders } : {}),
      },
      include: TENANT_INCLUDE,
    });

    await this.resolver.invalidate(
      tenantId,
      updated.slug,
      updated.domains.map((domain) => domain.domain),
    );

    await this.audit.record({
      tenantId,
      actorType: AuditActorType.USER,
      actorId: context.actorId,
      action: AuditAction.TENANT_UPDATED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'Tenant',
      resourceId: tenantId,
      changes: {
        tenant: { before: this.toDto(before), after: this.toDto(updated) },
      },
      ipHash: context.ipHash,
      requestId: context.requestId,
    });

    return this.toDto(updated);
  }

  async updateStatus(
    tenantId: string,
    dto: UpdateTenantStatusDto,
    context: { actorId: string; ipHash: string; requestId: string },
  ): Promise<TenantDto> {
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: tenantId },
      include: TENANT_INCLUDE,
    });

    if (!tenant) {
      throw new NotFoundException('Tenant', tenantId);
    }

    const updated = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { status: dto.status },
      include: TENANT_INCLUDE,
    });

    // Suspension must stop live traffic immediately.
    if (dto.status === TenantStatus.SUSPENDED || dto.status === TenantStatus.ARCHIVED) {
      await this.prisma.$transaction([
        this.prisma.userSession.updateMany({
          where: { tenantId, revokedAt: null },
          data: { revokedAt: new Date(), revokeReason: 'tenant_suspended' },
        }),
        this.prisma.refreshToken.updateMany({
          where: { tenantId, status: 'ACTIVE' },
          data: { status: 'REVOKED', revokedAt: new Date(), revokeReason: 'tenant_suspended' },
        }),
      ]);
    }

    await this.resolver.invalidate(
      tenantId,
      updated.slug,
      updated.domains.map((domain) => domain.domain),
    );

    await this.audit.recordImmediate({
      tenantId,
      actorType: AuditActorType.USER,
      actorId: context.actorId,
      action:
        dto.status === TenantStatus.SUSPENDED
          ? AuditAction.TENANT_SUSPENDED
          : AuditAction.TENANT_UPDATED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'Tenant',
      resourceId: tenantId,
      description: dto.reason ?? `Status changed to ${dto.status}`,
      changes: { status: { before: tenant.status, after: dto.status } },
      ipHash: context.ipHash,
      requestId: context.requestId,
    });

    return this.toDto(updated);
  }

  async softDelete(
    tenantId: string,
    context: { actorId: string; ipHash: string; requestId: string },
  ): Promise<{ id: string; deleted: true }> {
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: tenantId, deletedAt: null },
      include: TENANT_INCLUDE,
    });

    if (!tenant) {
      throw new NotFoundException('Tenant', tenantId);
    }

    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { deletedAt: new Date(), status: TenantStatus.ARCHIVED },
    });

    await this.resolver.invalidate(
      tenantId,
      tenant.slug,
      tenant.domains.map((domain) => domain.domain),
    );

    await this.audit.recordImmediate({
      tenantId,
      actorType: AuditActorType.USER,
      actorId: context.actorId,
      action: AuditAction.TENANT_DELETED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'Tenant',
      resourceId: tenantId,
      ipHash: context.ipHash,
      requestId: context.requestId,
    });

    return { id: tenantId, deleted: true };
  }

  async addDomain(
    tenantId: string,
    dto: CreateTenantDomainDto,
    context: { actorId: string; ipHash: string; requestId: string },
  ): Promise<{ id: string; domain: string; verificationToken: string; status: string }> {
    const existing = await this.prisma.tenantDomain.findUnique({
      where: { domain: dto.domain },
      select: { id: true, tenantId: true },
    });

    if (existing) {
      throw new ConflictException('This domain is already registered.', { domain: dto.domain });
    }

    // The token proves ownership via a DNS TXT record before we serve the brand.
    const verificationToken = this.crypto.generateToken(16);

    const domain = await this.prisma.tenantDomain.create({
      data: {
        tenantId,
        domain: dto.domain,
        isPrimary: dto.isPrimary ?? false,
        status: 'PENDING_DNS',
        verificationToken,
      },
    });

    await this.audit.record({
      tenantId,
      actorType: AuditActorType.USER,
      actorId: context.actorId,
      action: AuditAction.TENANT_DOMAIN_ADDED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'TenantDomain',
      resourceId: domain.id,
      description: `Registered custom domain ${dto.domain}`,
      ipHash: context.ipHash,
      requestId: context.requestId,
    });

    return {
      id: domain.id,
      domain: domain.domain,
      verificationToken: domain.verificationToken,
      status: domain.status,
    };
  }

  async removeDomain(
    tenantId: string,
    domainId: string,
    context: { actorId: string; ipHash: string; requestId: string },
  ): Promise<{ id: string; deleted: true }> {
    const domain = await this.prisma.tenantDomain.findFirst({
      where: { id: domainId, tenantId },
      select: { id: true, domain: true },
    });

    if (!domain) {
      throw new NotFoundException('Domain', domainId);
    }

    await this.prisma.tenantDomain.delete({ where: { id: domainId } });
    await this.resolver.invalidate(tenantId, undefined, [domain.domain]);

    await this.audit.record({
      tenantId,
      actorType: AuditActorType.USER,
      actorId: context.actorId,
      action: AuditAction.TENANT_DOMAIN_REMOVED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'TenantDomain',
      resourceId: domainId,
      description: `Removed custom domain ${domain.domain}`,
      ipHash: context.ipHash,
      requestId: context.requestId,
    });

    return { id: domainId, deleted: true };
  }

  private toDto(tenant: TenantRecord): TenantDto {
    return {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      legalName: tenant.legalName,
      status: tenant.status as TenantStatus,
      ownerUserId: tenant.ownerUserId,
      defaultLocale: tenant.defaultLocale as SupportedLocale,
      supportedLocales: tenant.supportedLocales as SupportedLocale[],
      defaultCurrency: tenant.defaultCurrency as SupportedCurrency,
      supportedCurrencies: tenant.supportedCurrencies as SupportedCurrency[],
      timezone: tenant.timezone,
      contactEmail: tenant.contactEmail,
      contactPhone: tenant.contactPhone,
      countryCode: tenant.countryCode,
      platformFeeBps: tenant.platformFeeBps,
      performanceFeeBps: tenant.performanceFeeBps,
      maxUsers: tenant.maxUsers,
      maxTraders: tenant.maxTraders,
      branding: tenant.branding
        ? {
            id: tenant.branding.id,
            tenantId: tenant.branding.tenantId,
            appName: tenant.branding.appName,
            logoUrl: tenant.branding.logoUrl,
            logoDarkUrl: tenant.branding.logoDarkUrl,
            faviconUrl: tenant.branding.faviconUrl,
            primaryColor: tenant.branding.primaryColor,
            secondaryColor: tenant.branding.secondaryColor,
            accentColor: tenant.branding.accentColor,
            backgroundColor: tenant.branding.backgroundColor,
            textColor: tenant.branding.textColor,
            fontFamily: tenant.branding.fontFamily,
            themeMode: tenant.branding.themeMode as 'light' | 'dark' | 'system',
            supportEmail: tenant.branding.supportEmail,
            supportUrl: tenant.branding.supportUrl,
            termsUrl: tenant.branding.termsUrl,
            privacyUrl: tenant.branding.privacyUrl,
            customCss: tenant.branding.customCss,
            socialLinks: (tenant.branding.socialLinks as Record<string, string>) ?? {},
            createdAt: tenant.branding.createdAt.toISOString(),
            updatedAt: tenant.branding.updatedAt.toISOString(),
          }
        : undefined,
      domains: tenant.domains.map((domain) => ({
        id: domain.id,
        tenantId: domain.tenantId,
        domain: domain.domain,
        isPrimary: domain.isPrimary,
        status: domain.status as never,
        verificationToken: domain.verificationToken,
        verifiedAt: domain.verifiedAt ? domain.verifiedAt.toISOString() : null,
        createdAt: domain.createdAt.toISOString(),
      })),
      createdAt: tenant.createdAt.toISOString(),
      updatedAt: tenant.updatedAt.toISOString(),
      deletedAt: tenant.deletedAt ? tenant.deletedAt.toISOString() : null,
    };
  }
}
