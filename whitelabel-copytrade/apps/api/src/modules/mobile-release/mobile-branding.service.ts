import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  looksLikeSecret,
  MOBILE_ERROR_CODES,
  MobileBranding,
  MobileReleaseError,
} from './mobile-release.types';

/**
 * Backend-sanitized tenant branding -> mobile-safe branding.
 *
 * The source of truth is the existing TenantBranding record (produced by the
 * white-label module's own sanitisation). This service performs a second,
 * mobile-specific pass: strict color grammar, https-only URLs, string fields
 * stripped of markup and control characters, and a hard refusal of anything
 * resembling code (the tenant's `customCss` and raw HTML never reach the app —
 * a mobile binary cannot execute tenant CSS and must not carry it).
 */

const COLOR_RX = /^#[0-9a-fA-F]{6}$/;
const URL_RX = /^https:\/\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+$/;
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_APP_NAME = 30; // conservative across iOS home-screen norms

/** Control characters and markup delimiters must never reach a label field. */
function sanitiseLabel(raw: string, maxLength: number, field: string): string {
  const cleaned = raw
    // strip control chars
    .replace(/[\u0000-\u001f\u007f]/g, '')
    // strip markup delimiters entirely rather than escaping them into the label
    .replace(/[<>]/g, '')
    .trim();
  if (!cleaned) {
    throw new MobileReleaseError(
      MOBILE_ERROR_CODES.BRANDING_UNSAFE,
      `branding field ${field} is empty after sanitisation`,
    );
  }
  return cleaned.slice(0, maxLength);
}

function sanitiseOptionalUrl(raw: string | null | undefined, field: string): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const value = String(raw).trim();
  if (!URL_RX.test(value)) {
    throw new MobileReleaseError(
      MOBILE_ERROR_CODES.BRANDING_UNSAFE,
      `branding field ${field} must be an https URL`,
      400,
      { field },
    );
  }
  return value;
}

function sanitiseColor(raw: string | null | undefined, fallback: string, field: string): string {
  const value = (raw ?? fallback).trim();
  if (!COLOR_RX.test(value)) {
    throw new MobileReleaseError(
      MOBILE_ERROR_CODES.BRANDING_UNSAFE,
      `branding field ${field} must be #RRGGBB`,
      400,
      { field },
    );
  }
  return value.toUpperCase();
}

@Injectable()
export class MobileBrandingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reads the tenant's authoritative TenantBranding row and converts it to
   * mobile-safe branding. Throws MOBILE_BRANDING_UNSAFE (never silently
   * drops) when a configured value violates a mobile constraint, and
   * MOBILE_BRANDING_MISSING when the tenant has no branding yet.
   */
  async resolveForTenant(tenantId: string): Promise<MobileBranding> {
    const branding = await this.prisma.tenantBranding.findUnique({ where: { tenantId } });
    if (!branding) {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.BRANDING_MISSING,
        'tenant has no white-label branding configured; configure branding before provisioning a mobile app',
        409,
        { tenantId },
      );
    }
    return this.fromRecord({
      appName: branding.appName,
      logoUrl: branding.logoUrl ?? null,
      logoDarkUrl: branding.logoDarkUrl ?? null,
      faviconUrl: branding.faviconUrl ?? null,
      primaryColor: branding.primaryColor,
      secondaryColor: branding.secondaryColor,
      accentColor: branding.accentColor,
      backgroundColor: branding.backgroundColor,
      textColor: branding.textColor,
      fontFamily: branding.fontFamily,
      themeMode: branding.themeMode,
      supportEmail: branding.supportEmail ?? null,
      supportUrl: branding.supportUrl ?? null,
      termsUrl: branding.termsUrl ?? null,
      privacyUrl: branding.privacyUrl ?? null,
      customCss: branding.customCss ?? null,
    });
  }

  /**
   * Pure conversion (also the unit under test): TenantBranding-shaped input
   * in, mobile-safe branding out. customCss is deliberately NOT carried over
   * — an app cannot and must not execute tenant CSS.
   */
  fromRecord(record: {
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
  }): MobileBranding {
    const appName = sanitiseLabel(record.appName, MAX_APP_NAME, 'appName');

    const themeMode =
      record.themeMode === 'light' || record.themeMode === 'dark' ? record.themeMode : 'system';

    // Icon: prefer the square favicon/logo asset; splash falls back to logo.
    const iconUrl = sanitiseOptionalUrl(record.faviconUrl ?? record.logoUrl, 'iconUrl');
    const splashUrl = sanitiseOptionalUrl(record.logoDarkUrl ?? record.logoUrl, 'splashUrl');
    const logoUrl = sanitiseOptionalUrl(record.logoUrl, 'logoUrl');

    const supportEmail = record.supportEmail ? record.supportEmail.trim() : null;
    if (supportEmail && !EMAIL_RX.test(supportEmail)) {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.BRANDING_UNSAFE,
        'supportEmail is not a valid address',
        400,
        { field: 'supportEmail' },
      );
    }

    const branding: MobileBranding = {
      appName,
      primaryColor: sanitiseColor(record.primaryColor, '#1B2A4A', 'primaryColor'),
      secondaryColor: sanitiseColor(record.secondaryColor, '#0F172A', 'secondaryColor'),
      backgroundColor: sanitiseColor(record.backgroundColor, '#FFFFFF', 'backgroundColor'),
      textColor: sanitiseColor(record.textColor, '#0B1220', 'textColor'),
      fontFamily: sanitiseLabel(record.fontFamily || 'Inter', 64, 'fontFamily'),
      themeMode,
      iconUrl,
      splashUrl,
      logoUrl,
      supportEmail,
      supportUrl: sanitiseOptionalUrl(record.supportUrl, 'supportUrl'),
      termsUrl: sanitiseOptionalUrl(record.termsUrl, 'termsUrl'),
      privacyUrl: sanitiseOptionalUrl(record.privacyUrl, 'privacyUrl'),
    };

    // Final defence: a branding structure that somehow grew a secret-shaped
    // value is rejected, not shipped inside a signed binary.
    for (const [key, value] of Object.entries(branding)) {
      if (looksLikeSecret(key, value)) {
        throw new MobileReleaseError(
          MOBILE_ERROR_CODES.BRANDING_UNSAFE,
          `branding field ${key} carries secret-shaped content`,
          400,
          { field: key },
        );
      }
    }
    return branding;
  }
}
