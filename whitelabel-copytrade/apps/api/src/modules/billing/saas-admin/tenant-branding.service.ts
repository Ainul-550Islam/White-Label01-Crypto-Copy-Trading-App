import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { TenantBrandingService as ExistingBrandingService } from '../../tenants/tenant-branding.service';
import { SaasAdminAuditService } from './saas-admin-audit.service';
import type { SaasBrandingState } from './saas-admin.types';

/**
 * Manages tenant branding configuration using existing branding architecture.
 * Validates assets, preserves sanitization, tenant isolation, audits changes.
 */
@Injectable()
export class SaasTenantBrandingService {
  private readonly logger = new Logger(SaasTenantBrandingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly existingBrandingService: ExistingBrandingService,
    private readonly auditService: SaasAdminAuditService,
  ) {}

  async getBrandingState(tenantId: string): Promise<SaasBrandingState> {
    try {
      const branding = await this.prisma.tenantBranding.findUnique({ where: { tenantId } });

      if (!branding) {
        // Return defaults if no branding yet
        const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
        return {
          tenantId,
          appName: tenant?.name || 'App',
          logoUrl: null,
          logoDarkUrl: null,
          faviconUrl: null,
          primaryColor: '#1B2A4A',
          secondaryColor: '#0F172A',
          accentColor: '#22C55E',
          backgroundColor: '#FFFFFF',
          textColor: '#0B1220',
          fontFamily: 'Inter',
          themeMode: 'system',
          supportEmail: null,
          supportUrl: null,
          termsUrl: null,
          privacyUrl: null,
          hasCustomCss: false,
          updatedAt: null,
        };
      }

      return {
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
        themeMode: branding.themeMode,
        supportEmail: branding.supportEmail,
        supportUrl: branding.supportUrl,
        termsUrl: branding.termsUrl,
        privacyUrl: branding.privacyUrl,
        hasCustomCss: !!branding.customCss,
        updatedAt: branding.updatedAt.toISOString(),
      };
    } catch (error: any) {
      this.logger.warn(`Failed to get branding for tenant ${tenantId}: ${error.message}`);
      throw error;
    }
  }

  async updateBranding(
    tenantId: string,
    input: {
      appName?: string;
      logoUrl?: string;
      logoDarkUrl?: string;
      faviconUrl?: string;
      primaryColor?: string;
      secondaryColor?: string;
      accentColor?: string;
      backgroundColor?: string;
      textColor?: string;
      fontFamily?: string;
      themeMode?: string;
      supportEmail?: string;
      supportUrl?: string;
      termsUrl?: string;
      privacyUrl?: string;
      customCss?: string;
      socialLinks?: Record<string, string>;
    },
    context: { actorId: string; ipHash: string; requestId: string },
  ): Promise<SaasBrandingState> {
    this.validateBrandingInput(input);

    const existing = await this.getBrandingState(tenantId);
    const previousState: Record<string, unknown> = { ...existing };

    // Use existing branding service which already has sanitization
    try {
      // Ensure branding record exists
      let branding = await this.prisma.tenantBranding.findUnique({ where: { tenantId } });
      if (!branding) {
        // Create default branding
        const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
        branding = await this.prisma.tenantBranding.create({
          data: {
            tenantId,
            appName: input.appName || tenant?.name || 'App',
            logoUrl: input.logoUrl || null,
            logoDarkUrl: input.logoDarkUrl || null,
            faviconUrl: input.faviconUrl || null,
            primaryColor: input.primaryColor || '#1B2A4A',
            secondaryColor: input.secondaryColor || '#0F172A',
            accentColor: input.accentColor || '#22C55E',
            backgroundColor: input.backgroundColor || '#FFFFFF',
            textColor: input.textColor || '#0B1220',
            fontFamily: input.fontFamily || 'Inter',
            themeMode: input.themeMode || 'system',
            supportEmail: input.supportEmail || null,
            supportUrl: input.supportUrl || null,
            termsUrl: input.termsUrl || null,
            privacyUrl: input.privacyUrl || null,
            customCss: input.customCss ? this.existingBrandingService.sanitiseCss(input.customCss) : null,
            socialLinks: input.socialLinks || {},
          },
        });
      } else {
        // Update via existing service to preserve sanitization logic
        const updateDto: any = {};
        if (input.appName !== undefined) updateDto.appName = input.appName;
        if (input.logoUrl !== undefined) updateDto.logoUrl = input.logoUrl;
        if (input.logoDarkUrl !== undefined) updateDto.logoDarkUrl = input.logoDarkUrl;
        if (input.faviconUrl !== undefined) updateDto.faviconUrl = input.faviconUrl;
        if (input.primaryColor !== undefined) updateDto.primaryColor = input.primaryColor;
        if (input.secondaryColor !== undefined) updateDto.secondaryColor = input.secondaryColor;
        if (input.accentColor !== undefined) updateDto.accentColor = input.accentColor;
        if (input.backgroundColor !== undefined) updateDto.backgroundColor = input.backgroundColor;
        if (input.textColor !== undefined) updateDto.textColor = input.textColor;
        if (input.fontFamily !== undefined) updateDto.fontFamily = input.fontFamily;
        if (input.themeMode !== undefined) updateDto.themeMode = input.themeMode;
        if (input.supportEmail !== undefined) updateDto.supportEmail = input.supportEmail;
        if (input.supportUrl !== undefined) updateDto.supportUrl = input.supportUrl;
        if (input.termsUrl !== undefined) updateDto.termsUrl = input.termsUrl;
        if (input.privacyUrl !== undefined) updateDto.privacyUrl = input.privacyUrl;
        if (input.customCss !== undefined) updateDto.customCss = input.customCss;
        if (input.socialLinks !== undefined) updateDto.socialLinks = input.socialLinks;

        await this.existingBrandingService.update(tenantId, updateDto, {
          actorId: context.actorId,
          ipHash: context.ipHash,
          requestId: context.requestId,
        });
      }

      const newState = await this.getBrandingState(tenantId);

      await this.auditService.logBrandingUpdated(tenantId, context.actorId, previousState as any, newState as any);

      this.logger.log(`Branding updated for tenant ${tenantId} by ${context.actorId}`);

      return newState;
    } catch (error: any) {
      this.logger.error(`Failed to update branding for tenant ${tenantId}: ${error.message}`);
      throw error;
    }
  }

  private validateBrandingInput(input: any): void {
    // Validate hex colors
    const hexColorRegex = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
    const colorFields = ['primaryColor', 'secondaryColor', 'accentColor', 'backgroundColor', 'textColor'];

    for (const field of colorFields) {
      if (input[field] !== undefined && input[field] !== null) {
        if (!hexColorRegex.test(input[field])) {
          throw new Error(`${field} must be a valid hex color`);
        }
      }
    }

    // Validate URLs
    const urlFields = ['logoUrl', 'logoDarkUrl', 'faviconUrl', 'supportUrl', 'termsUrl', 'privacyUrl'];
    for (const field of urlFields) {
      if (input[field] !== undefined && input[field] !== null && input[field] !== '') {
        try {
          const url = new URL(input[field]);
          if (!['http:', 'https:'].includes(url.protocol)) {
            throw new Error(`${field} must be http or https URL`);
          }
        } catch {
          throw new Error(`${field} must be a valid URL`);
        }
      }
    }

    // Validate appName length
    if (input.appName !== undefined && input.appName !== null) {
      if (typeof input.appName !== 'string' || input.appName.length > 64 || input.appName.length < 1) {
        throw new Error('appName must be 1-64 characters');
      }
    }

    // Validate fontFamily length
    if (input.fontFamily !== undefined && input.fontFamily !== null) {
      if (typeof input.fontFamily !== 'string' || input.fontFamily.length > 64) {
        throw new Error('fontFamily must be <= 64 characters');
      }
    }

    // Validate themeMode
    if (input.themeMode !== undefined && input.themeMode !== null) {
      if (!['light', 'dark', 'system'].includes(input.themeMode)) {
        throw new Error('themeMode must be light, dark, or system');
      }
    }

    // Validate customCss length and block dangerous content
    if (input.customCss !== undefined && input.customCss !== null) {
      if (typeof input.customCss !== 'string' || input.customCss.length > 20000) {
        throw new Error('customCss must be <= 20000 characters');
      }
      // Check for script injection attempts - will be sanitized but we reject obvious attempts
      const dangerous = ['<script', 'javascript:', 'vbscript:', 'expression(', 'behavior:', '-moz-binding'];
      const lowerCss = input.customCss.toLowerCase();
      for (const pattern of dangerous) {
        if (lowerCss.includes(pattern)) {
          throw new Error(`customCss contains forbidden pattern: ${pattern}`);
        }
      }
    }

    // Validate socialLinks - only URLs
    if (input.socialLinks !== undefined && input.socialLinks !== null) {
      if (typeof input.socialLinks !== 'object' || Array.isArray(input.socialLinks)) {
        throw new Error('socialLinks must be an object');
      }
      for (const [key, value] of Object.entries(input.socialLinks)) {
        if (typeof value !== 'string') {
          throw new Error(`socialLinks[${key}] must be a string`);
        }
        if (value) {
          try {
            new URL(value);
          } catch {
            throw new Error(`socialLinks[${key}] must be a valid URL`);
          }
        }
      }
    }
  }
}
