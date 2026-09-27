import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MOBILE_ERROR_CODES, MobileReleaseError } from './mobile-release.types';

/**
 * Deterministic tenant application identities.
 *
 * The naming strategy follows the platform's reverse-DNS convention:
 *   Android: com.<platform-root>.<tenant-slug>   (configurable root prefix)
 *   iOS:     com.<platform-root>.<tenant-slug>   (Apple's reverse-DNS style)
 *
 * Identifiers are derived from the tenant SLUG (unique, immutable per tenant),
 * so the same tenant always derives the same identity, and the database's
 * unique constraints make silent cross-tenant reuse impossible.
 */

const ANDROID_PACKAGE_RX = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,6}$/;
const IOS_BUNDLE_RX = /^[A-Za-z0-9][A-Za-z0-9-]*(\.[A-Za-z0-9-]+){1,6}$/;

/** Segments that would collide with framework-reserved namespaces. */
const RESERVED_SEGMENTS = new Set([
  'android',
  'apple',
  'ios',
  'com',
  'org',
  'net', // only reserved as a FULL first segment, checked separately below
]);

const JAVA_KEYWORDS = new Set([
  'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const',
  'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float',
  'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native',
  'new', 'package', 'private', 'protected', 'public', 'return', 'short', 'static', 'strictfp',
  'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient', 'try', 'void',
  'volatile', 'while', 'true', 'false', 'null',
]);

export interface TenantIdentityInput {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
}

export interface MobileIdentityPair {
  androidPackageId: string;
  iosBundleId: string;
}

@Injectable()
export class MobileIdentityService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Normalises a tenant name/slug into a DNS-label-safe slug: lowercase,
   * alphanumerics and single hyphens, 1-63 chars, no leading/trailing hyphen.
   */
  slugify(raw: string): string {
    const slug = raw
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 63)
      .replace(/-+$/g, '');
    if (!slug) {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.IDENTITY_INVALID,
        'tenant name produces an empty identity slug',
      );
    }
    return slug;
  }

  private androidRoot(): string {
    // Platform-owned root; overridable for self-hosted deployments.
    const root = process.env.MOBILE_ANDROID_PACKAGE_ROOT || 'com.whitelabel.generated';
    return root;
  }

  private iosRoot(): string {
    const root = process.env.MOBILE_IOS_BUNDLE_ROOT || 'com.whitelabel.generated';
    return root;
  }

  derive(input: TenantIdentityInput): MobileIdentityPair {
    const slug = this.slugify(input.tenantSlug || input.tenantName);
    const androidPackageId = `${this.androidRoot()}.${slug}`;
    const iosBundleId = `${this.iosRoot()}.${slug}`;
    this.validateAndroidPackage(androidPackageId);
    this.validateIosBundle(iosBundleId);
    return { androidPackageId, iosBundleId };
  }

  /**
   * Android applicationId rules: reverse-DNS, lowercase alphanumerics plus
   * underscore, each segment starting with a letter, no Java keywords, at
   * least two segments, <= 120 chars overall.
   */
  validateAndroidPackage(packageId: string): void {
    if (!packageId || packageId.length > 120 || !ANDROID_PACKAGE_RX.test(packageId)) {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.IDENTITY_INVALID,
        `invalid Android applicationId: ${packageId}`,
        400,
        { packageId },
      );
    }
    const segments = packageId.split('.');
    if (RESERVED_SEGMENTS.has(segments[0]) && segments[0] !== 'com' && segments[0] !== 'org') {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.IDENTITY_INVALID,
        `Android applicationId uses reserved first segment: ${segments[0]}`,
        400,
        { packageId },
      );
    }
    for (const segment of segments) {
      if (JAVA_KEYWORDS.has(segment)) {
        throw new MobileReleaseError(
          MOBILE_ERROR_CODES.IDENTITY_INVALID,
          `Android applicationId segment is a Java keyword: ${segment}`,
          400,
          { packageId, segment },
        );
      }
    }
  }

  /**
   * Apple bundle-id rules: reverse-DNS of alphanumerics and hyphens, segments
   * not starting with a hyphen or digit-only, <= 160 chars.
   */
  validateIosBundle(bundleId: string): void {
    if (!bundleId || bundleId.length > 160 || !IOS_BUNDLE_RX.test(bundleId)) {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.IDENTITY_INVALID,
        `invalid iOS bundle identifier: ${bundleId}`,
        400,
        { bundleId },
      );
    }
    for (const segment of bundleId.split('.')) {
      if (segment.length > 63) {
        throw new MobileReleaseError(
          MOBILE_ERROR_CODES.IDENTITY_INVALID,
          'iOS bundle identifier segment exceeds 63 characters',
          400,
          { bundleId },
        );
      }
    }
  }

  /**
   * Uniqueness is enforced twice: pre-checked here for a readable error, and
   * enforced by unique indexes for the race a pre-check cannot close.
   */
  async assertAvailable(pair: Partial<MobileIdentityPair>, tenantId: string): Promise<void> {
    if (pair.androidPackageId) {
      const clash = await this.prisma.mobileApplication.findFirst({
        where: { androidPackageId: pair.androidPackageId },
        select: { tenantId: true },
      });
      if (clash && clash.tenantId !== tenantId) {
        throw new MobileReleaseError(
          MOBILE_ERROR_CODES.IDENTITY_COLLISION,
          `Android applicationId ${pair.androidPackageId} already belongs to another tenant`,
          409,
          { androidPackageId: pair.androidPackageId },
        );
      }
    }
    if (pair.iosBundleId) {
      const clash = await this.prisma.mobileApplication.findFirst({
        where: { iosBundleId: pair.iosBundleId },
        select: { tenantId: true },
      });
      if (clash && clash.tenantId !== tenantId) {
        throw new MobileReleaseError(
          MOBILE_ERROR_CODES.IDENTITY_COLLISION,
          `iOS bundle id ${pair.iosBundleId} already belongs to another tenant`,
          409,
          { iosBundleId: pair.iosBundleId },
        );
      }
    }
  }

  /**
   * Full identity resolution for provisioning: derive, validate, assert no
   * cross-tenant collision. Same tenant + same slug re-resolves to the same
   * pair, which is exactly what makes provisioning idempotent.
   */
  async resolveForTenant(input: TenantIdentityInput): Promise<MobileIdentityPair> {
    const pair = this.derive(input);
    await this.assertAvailable(pair, input.tenantId);
    return pair;
  }
}
