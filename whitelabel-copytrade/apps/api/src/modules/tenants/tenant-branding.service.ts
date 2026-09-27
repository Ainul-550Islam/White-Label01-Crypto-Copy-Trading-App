import { Injectable } from '@nestjs/common';
import { AuditAction, AuditActorType, AuditOutcome } from '@wlct/shared-types';
import type { TenantBrandingDto } from '@wlct/shared-types';
import { CACHE_KEY } from '@wlct/config';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CacheService } from '../../infrastructure/redis/cache.service';
import { AuditService } from '../audit/audit.service';
import { NotFoundException } from '../../common/errors/app.exception';
import type { UpdateBrandingDto } from './dto/update-branding.dto';

/**
 * White-label branding.
 *
 * Custom CSS is accepted because brands demand it, but it is sanitised on the
 * way in: anything that can execute script or exfiltrate data (url(), @import,
 * expression(), behaviour bindings) is stripped rather than escaped, so the
 * stored value is safe for every downstream renderer.
 */
@Injectable()
export class TenantBrandingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly audit: AuditService,
  ) {}

  async get(tenantId: string): Promise<TenantBrandingDto> {
    const branding = await this.prisma.tenantBranding.findUnique({ where: { tenantId } });

    if (!branding) {
      throw new NotFoundException('Branding configuration', tenantId);
    }

    return this.toDto(branding);
  }

  async update(
    tenantId: string,
    dto: UpdateBrandingDto,
    context: { actorId: string; ipHash: string; requestId: string },
  ): Promise<TenantBrandingDto> {
    const existing = await this.prisma.tenantBranding.findUnique({ where: { tenantId } });
    if (!existing) {
      throw new NotFoundException('Branding configuration', tenantId);
    }

    const sanitisedCss =
      dto.customCss !== undefined ? this.sanitiseCss(dto.customCss ?? '') : undefined;

    const updated = await this.prisma.tenantBranding.update({
      where: { tenantId },
      data: {
        ...(dto.appName !== undefined ? { appName: dto.appName } : {}),
        ...(dto.logoUrl !== undefined ? { logoUrl: dto.logoUrl } : {}),
        ...(dto.logoDarkUrl !== undefined ? { logoDarkUrl: dto.logoDarkUrl } : {}),
        ...(dto.faviconUrl !== undefined ? { faviconUrl: dto.faviconUrl } : {}),
        ...(dto.primaryColor !== undefined ? { primaryColor: dto.primaryColor } : {}),
        ...(dto.secondaryColor !== undefined ? { secondaryColor: dto.secondaryColor } : {}),
        ...(dto.accentColor !== undefined ? { accentColor: dto.accentColor } : {}),
        ...(dto.backgroundColor !== undefined ? { backgroundColor: dto.backgroundColor } : {}),
        ...(dto.textColor !== undefined ? { textColor: dto.textColor } : {}),
        ...(dto.fontFamily !== undefined ? { fontFamily: dto.fontFamily } : {}),
        ...(dto.themeMode !== undefined ? { themeMode: dto.themeMode } : {}),
        ...(dto.supportEmail !== undefined ? { supportEmail: dto.supportEmail } : {}),
        ...(dto.supportUrl !== undefined ? { supportUrl: dto.supportUrl } : {}),
        ...(dto.termsUrl !== undefined ? { termsUrl: dto.termsUrl } : {}),
        ...(dto.privacyUrl !== undefined ? { privacyUrl: dto.privacyUrl } : {}),
        ...(sanitisedCss !== undefined ? { customCss: sanitisedCss } : {}),
        ...(dto.socialLinks !== undefined ? { socialLinks: dto.socialLinks } : {}),
      },
    });

    await this.cache.delete(CACHE_KEY.tenantPublicConfig(tenantId));

    await this.audit.record({
      tenantId,
      actorType: AuditActorType.USER,
      actorId: context.actorId,
      action: AuditAction.TENANT_BRANDING_UPDATED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'TenantBranding',
      resourceId: updated.id,
      changes: {
        branding: { before: this.toDto(existing), after: this.toDto(updated) },
      },
      ipHash: context.ipHash,
      requestId: context.requestId,
    });

    return this.toDto(updated);
  }

  /**
   * Removes CSS constructs that can execute code or make network requests.
   * Whitelisting properties would be stricter but breaks legitimate theming;
   * this blocklist targets the constructs that are actually dangerous.
   */
  sanitiseCss(css: string): string {
    return css
      .replace(/<\/?[^>]*>/g, '')
      .replace(/@import[^;]*;?/gi, '')
      .replace(/expression\s*\([^)]*\)/gi, '')
      .replace(/javascript\s*:/gi, '')
      .replace(/vbscript\s*:/gi, '')
      .replace(/behaviou?r\s*:[^;]*;?/gi, '')
      .replace(/-moz-binding\s*:[^;]*;?/gi, '')
      .replace(/url\s*\(\s*(['"]?)\s*(?!data:image\/(png|jpe?g|gif|svg\+xml|webp);base64,)[^)]*\1\s*\)/gi, 'none')
      .slice(0, 20000);
  }

  private toDto(branding: {
    id: string;
    tenantId: string;
    appName: string;
    logoUrl: string | null;
    logoDarkUrl: string | null;
    faviconUrl: string | null;
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
    backgroundColor: string;
    textColor: string;
    fontFamily: string;
    themeMode: string;
    supportEmail: string | null;
    supportUrl: string | null;
    termsUrl: string | null;
    privacyUrl: string | null;
    customCss: string | null;
    socialLinks: unknown;
    createdAt: Date;
    updatedAt: Date;
  }): TenantBrandingDto {
    return {
      id: branding.id,
      tenantId: branding.tenantId,
      appName: branding.appName,
      logoUrl: branding.logoUrl,
      logoDarkUrl: branding.logoDarkUrl,
      faviconUrl: branding.faviconUrl,
      primaryColor: branding.primaryColor,
      secondaryColor: branding.secondaryColor,
      accentColor: branding.accentColor,
      backgroundColor: branding.backgroundColor,
      textColor: branding.textColor,
      fontFamily: branding.fontFamily,
      themeMode: branding.themeMode as 'light' | 'dark' | 'system',
      supportEmail: branding.supportEmail,
      supportUrl: branding.supportUrl,
      termsUrl: branding.termsUrl,
      privacyUrl: branding.privacyUrl,
      customCss: branding.customCss,
      socialLinks: (branding.socialLinks as Record<string, string>) ?? {},
      createdAt: branding.createdAt.toISOString(),
      updatedAt: branding.updatedAt.toISOString(),
    };
  }
}
