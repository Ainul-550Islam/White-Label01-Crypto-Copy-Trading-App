import { Injectable } from '@nestjs/common';
import { CACHE_KEY, CACHE_TTL } from '@wlct/config';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CacheService } from '../../infrastructure/redis/cache.service';
import type { TenantContext } from '../../common/types/request.types';

export type ResolvedTenant = Omit<TenantContext, 'source'>;

/**
 * Read-optimised tenant lookups used on the hot path of every request.
 *
 * Results are cached in Redis because tenant metadata changes rarely but is
 * needed on 100% of requests; the cache is invalidated explicitly by
 * TenantsService whenever a tenant, domain or status changes.
 */
@Injectable()
export class TenantResolverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async resolveBySlug(slug: string): Promise<ResolvedTenant | null> {
    if (!slug) {
      return null;
    }

    return this.cache.remember(
      CACHE_KEY.tenantBySlug(slug),
      CACHE_TTL.TENANT_RESOLUTION_SECONDS,
      async () => {
        const tenant = await this.prisma.tenant.findFirst({
          where: { slug, deletedAt: null },
          select: {
            id: true,
            slug: true,
            status: true,
            defaultLocale: true,
            defaultCurrency: true,
          },
        });
        return tenant ? this.toContext(tenant) : null;
      },
    );
  }

  async resolveById(tenantId: string): Promise<ResolvedTenant | null> {
    if (!tenantId) {
      return null;
    }

    return this.cache.remember(
      CACHE_KEY.tenantById(tenantId),
      CACHE_TTL.TENANT_RESOLUTION_SECONDS,
      async () => {
        const tenant = await this.prisma.tenant.findFirst({
          where: { id: tenantId, deletedAt: null },
          select: {
            id: true,
            slug: true,
            status: true,
            defaultLocale: true,
            defaultCurrency: true,
          },
        });
        return tenant ? this.toContext(tenant) : null;
      },
    );
  }

  async resolveByDomain(domain: string): Promise<ResolvedTenant | null> {
    if (!domain) {
      return null;
    }

    return this.cache.remember(
      CACHE_KEY.tenantByDomain(domain),
      CACHE_TTL.TENANT_RESOLUTION_SECONDS,
      async () => {
        const record = await this.prisma.tenantDomain.findFirst({
          where: { domain, status: 'ACTIVE', tenant: { deletedAt: null } },
          select: {
            tenant: {
              select: {
                id: true,
                slug: true,
                status: true,
                defaultLocale: true,
                defaultCurrency: true,
              },
            },
          },
        });
        return record?.tenant ? this.toContext(record.tenant) : null;
      },
    );
  }

  /** Drops every cache entry that can point at this tenant. */
  async invalidate(tenantId: string, slug?: string, domains: string[] = []): Promise<void> {
    const keys = [CACHE_KEY.tenantById(tenantId), CACHE_KEY.tenantPublicConfig(tenantId)];
    if (slug) {
      keys.push(CACHE_KEY.tenantBySlug(slug));
    }
    for (const domain of domains) {
      keys.push(CACHE_KEY.tenantByDomain(domain));
    }
    await this.cache.delete(...keys);
  }

  private toContext(tenant: {
    id: string;
    slug: string;
    status: string;
    defaultLocale: string;
    defaultCurrency: string;
  }): ResolvedTenant {
    return {
      tenantId: tenant.id,
      slug: tenant.slug,
      status: tenant.status,
      defaultLocale: tenant.defaultLocale,
      defaultCurrency: tenant.defaultCurrency,
    };
  }
}
