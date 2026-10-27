import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditAction, AuditActorType, AuditOutcome } from '@wlct/shared-types';
import type { TenantBrandingDto } from '@wlct/shared-types';
import { CACHE_KEY } from '@wlct/config';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CacheService } from '../../infrastructure/redis/cache.service';
import { AuditService } from '../audit/audit.service';
import { NotFoundException } from '../../common/errors/app.exception';
import type { UpdateBrandingDto } from './dto/update-branding.dto';

/** WCAG AA minimum contrast for normal text. */
const MIN_TEXT_CONTRAST_RATIO = 4.5;

/**
 * CSS constructs that make an update unacceptable rather than sanitised:
 * network reach (remote url(), @import), script vectors (expression(),
 * javascript:/vbscript:, behaviour/-moz-binding) and embedded markup.
 * Inline data: images stay allowed, matching {@link TenantBrandingService.sanitiseCss}.
 */
const DANGEROUS_CSS =
  /@import|expression\s*\(|javascript\s*:|vbscript\s*:|behaviou?r\s*:|-moz-binding|<\/?[a-z][^>]*>|url\s*\(\s*(['"]?)\s*(?!data:image\/(png|jpe?g|gif|svg\+xml|webp);base64,)/i;

/**
 * White-label branding.
 *
 * Custom CSS is accepted because brands demand it, but CSS that can execute
 * script or reach the network (remote url(), @import, expression(), behaviour
 * bindings, embedded markup) is REJECTED with a 400: silently stripping pieces
 * out of attacker-shaped input and storing the rest would hand downstream
 * renderers a stylesheet nobody actually reviewed. CSS that passes is still
 * sanitised on the way in as defence in depth, so the stored value is safe
 * for every renderer. Asset URLs must be HTTPS (they are rendered into the
 * tenant's pages, where plain HTTP is mixed content), and the text/background
 * pair must keep WCAG AA contrast (at least 4.5:1) so a brand update cannot
 * make the app unreadable.
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

    this.validateBrandingUpdate(dto, existing);

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
   * Rejects branding updates that are unsafe or unreadable before anything is
   * stored: non-HTTPS asset URLs, dangerous custom CSS, and a text/background
   * pair below WCAG AA contrast. Partial updates are judged on the merged
   * result, because that is what gets rendered.
   */
  private validateBrandingUpdate(
    dto: UpdateBrandingDto,
    existing: { backgroundColor: string; textColor: string },
  ): void {
    const assetUrls: Array<[string, string | null | undefined]> = [
      ['logoUrl', dto.logoUrl],
      ['logoDarkUrl', dto.logoDarkUrl],
      ['faviconUrl', dto.faviconUrl],
    ];
    for (const [field, value] of assetUrls) {
      if (typeof value === 'string' && value.trim() !== '' && !/^https:\/\//i.test(value.trim())) {
        throw new BadRequestException(`${field} must be an HTTPS URL`);
      }
    }

    if (typeof dto.customCss === 'string' && DANGEROUS_CSS.test(dto.customCss)) {
      throw new BadRequestException(
        'customCss contains a construct that is not allowed (@import, url(), expression(), behaviour bindings or markup)',
      );
    }

    if (dto.textColor !== undefined || dto.backgroundColor !== undefined) {
      const text = this.relativeLuminance(dto.textColor ?? existing.textColor, 'textColor');
      const background = this.relativeLuminance(
        dto.backgroundColor ?? existing.backgroundColor,
        'backgroundColor',
      );
      const ratio = (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05);
      if (ratio < MIN_TEXT_CONTRAST_RATIO) {
        throw new BadRequestException(
          'textColor must keep at least 4.5:1 contrast against backgroundColor',
        );
      }
    }
  }

  /** WCAG 2.x relative luminance of a #RGB/#RRGGBB/#RRGGBBAA hex color. */
  private relativeLuminance(hexColor: string, field: string): number {
    const match = /^#(?:([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])|([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})(?:[0-9a-fA-F]{2})?)$/.exec(
      hexColor.trim(),
    );
    if (!match) {
      throw new BadRequestException(`${field} must be a hex color`);
    }
    const channels = match[1]
      ? [match[1] + match[1], match[2] + match[2], match[3] + match[3]]
      : [match[4], match[5], match[6]];
    const [red, green, blue] = channels.map((channel) => {
      const value = parseInt(channel, 16) / 255;
      return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
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
