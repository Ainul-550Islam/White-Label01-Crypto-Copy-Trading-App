import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import { HEADER_TENANT_SLUG } from '@wlct/config';
import { extractSubdomain } from '@wlct/utils';

import { AppConfigService } from '../../config/app-config.service';
import { TenantResolverService } from '../../modules/tenants/tenant-resolver.service';
import type { AppRequest, TenantContext } from '../types/request.types';

/**
 * Resolves the tenant for *unauthenticated* traffic (login, registration,
 * public branding) from trustworthy transport-level signals, in priority order:
 *
 *   1. custom domain           -> app.acme-capital.com
 *   2. platform sub-domain     -> acme.copytrade.app
 *   3. X-Tenant-Slug header    -> native mobile clients that cannot use DNS
 *   4. configured default slug -> single-brand deployments
 *
 * The header is the weakest signal, so it is only honoured when it resolves to
 * an ACTIVE tenant, and any authenticated request later has this value replaced
 * by the tenant id embedded in the verified JWT (see TenantGuard). A client can
 * therefore never read another brand's data by forging a header.
 */
@Injectable()
export class TenantResolutionMiddleware implements NestMiddleware {
  constructor(
    private readonly tenantResolver: TenantResolverService,
    private readonly config: AppConfigService,
  ) {}

  async use(req: AppRequest, _res: Response, next: NextFunction): Promise<void> {
    try {
      const context = await this.resolve(req);
      if (context) {
        req.tenantContext = context;
      }
    } catch {
      // Tenant resolution must never break the request pipeline; downstream
      // guards decide whether a missing tenant context is fatal for the route.
    }
    next();
  }

  private async resolve(req: AppRequest): Promise<TenantContext | null> {
    const host = (req.headers['x-forwarded-host'] as string) ?? req.headers.host ?? '';
    const hostname = host.split(',')[0].trim().split(':')[0].toLowerCase();

    if (hostname) {
      const subdomain = extractSubdomain(hostname, this.config.platformRootDomain);
      if (subdomain) {
        const bySubdomain = await this.tenantResolver.resolveBySlug(subdomain);
        if (bySubdomain) {
          return { ...bySubdomain, source: 'subdomain' };
        }
      } else if (!this.isPlatformHost(hostname)) {
        const byDomain = await this.tenantResolver.resolveByDomain(hostname);
        if (byDomain) {
          return { ...byDomain, source: 'domain' };
        }
      }
    }

    const headerValue = req.headers[HEADER_TENANT_SLUG];
    const slug = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    if (slug) {
      const byHeader = await this.tenantResolver.resolveBySlug(slug.trim().toLowerCase());
      if (byHeader) {
        return { ...byHeader, source: 'header' };
      }
    }

    const fallback = await this.tenantResolver.resolveBySlug(this.config.defaultTenantSlug);
    return fallback ? { ...fallback, source: 'default' } : null;
  }

  private isPlatformHost(hostname: string): boolean {
    return (
      hostname === this.config.platformRootDomain ||
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.endsWith('.local')
    );
  }
}
