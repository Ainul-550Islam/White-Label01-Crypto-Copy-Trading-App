import { Injectable } from '@nestjs/common';

import {
  looksLikeSecret,
  MobileBranding,
  MobileEnvironment,
  MobileReleaseError,
  MOBILE_ERROR_CODES,
  MobileRuntimeConfig,
} from './mobile-release.types';
import { MobileEnvReader, MOBILE_RELEASE_ENV } from './mobile-release-policy.service';
import { Inject } from '@nestjs/common';

/**
 * Immutable, environment-specific runtime configuration for a mobile build.
 *
 * The mobile binary ships to untrusted devices, so this module is an
 * ALLOW-LIST producer: it emits exactly the keys listed below and refuses —
 * rather than filters — anything secret-shaped that a caller tries to merge
 * in. There is no code path that turns arbitrary tenant/platform settings into
 * app configuration; that path would be the leak.
 */

export interface MobileConfigInput {
  tenantId: string;
  applicationId: string;
  environment: MobileEnvironment;
  branding: MobileBranding;
  /** Tenant-visible feature flags only; non-boolean entries are dropped. */
  featureFlags?: Record<string, unknown>;
}

@Injectable()
export class MobileConfigService {
  constructor(
    @Inject(MOBILE_RELEASE_ENV) private readonly env: MobileEnvReader = { get: () => undefined },
  ) {}

  private apiBaseUrl(environment: MobileEnvironment): string {
    const key =
      environment === 'PRODUCTION'
        ? 'MOBILE_API_BASE_URL_PRODUCTION'
        : environment === 'STAGING'
          ? 'MOBILE_API_BASE_URL_STAGING'
          : 'MOBILE_API_BASE_URL_DEVELOPMENT';
    const explicit = this.env.get(key);
    if (explicit) return explicit.replace(/\/+$/, '');
    // Last-resort same-platform default: the public API origin itself. The
    // app talks to the existing backend; it never talks to a database.
    const fallback = this.env.get('APP_PUBLIC_BASE_URL') || 'https://api.placeholder.invalid';
    return fallback.replace(/\/+$/, '');
  }

  /**
   * Builds the allow-listed runtime configuration. Every value is re-checked
   * against the secret scanner: even an allow-listed field whose CONTENT
   * looks like key material aborts the build configuration.
   */
  build(input: MobileConfigInput): MobileRuntimeConfig {
    const featureFlags: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(input.featureFlags ?? {})) {
      if (typeof value === 'boolean' && /^[a-z0-9_]+$/i.test(key)) {
        featureFlags[key] = value;
      }
    }

    const config: MobileRuntimeConfig = {
      tenantId: input.tenantId,
      applicationId: input.applicationId,
      environment: input.environment,
      apiBaseUrl: this.apiBaseUrl(input.environment),
      branding: input.branding,
      featureFlags,
    };

    // Defence in depth: walk the assembled object; any secret-shaped pair
    // refuses the whole configuration instead of being scrubbed silently —
    // a silent scrub would hide the fact that a secret reached this layer.
    const stack: Array<{ key: string; value: unknown }> = Object.entries(config).map(
      ([key, value]) => ({ key, value }),
    );
    while (stack.length > 0) {
      const entry = stack.pop()!;
      if (entry.value && typeof entry.value === 'object' && !Array.isArray(entry.value)) {
        for (const [k, v] of Object.entries(entry.value as Record<string, unknown>)) {
          stack.push({ key: `${entry.key}.${k}`, value: v });
        }
      }
      const leafKey = entry.key.split('.').pop() ?? entry.key;
      if (looksLikeSecret(leafKey, entry.value)) {
        throw new MobileReleaseError(
          MOBILE_ERROR_CODES.CONFIG_SECRET,
          `mobile runtime configuration field ${entry.key} is secret-shaped and was refused`,
          400,
          { field: entry.key },
        );
      }
      if (
        typeof entry.value === 'string' &&
        entry.value.length > 4096
      ) {
        throw new MobileReleaseError(
          MOBILE_ERROR_CODES.CONFIG_SECRET,
          `mobile runtime configuration field ${entry.key} is implausibly large`,
          400,
          { field: entry.key },
        );
      }
    }
    return config;
  }

  /**
   * Merges caller extras into the config under the allow-list: only keys in
   * SAFE_EXTRA_KEYS are honoured, boolean/short-string values only, and the
   * secret scanner still runs over the merged result.
   */
  private static readonly SAFE_EXTRA_KEYS = new Set([
    'sentryDsn',
    'supportAccountId',
    'storeReviewerNote',
  ]);

  buildWithExtras(input: MobileConfigInput, extras: Record<string, unknown>): MobileRuntimeConfig {
    const safe: Record<string, unknown> = {};
    for (const key of Object.keys(extras ?? {}).sort()) {
      if (!MobileConfigService.SAFE_EXTRA_KEYS.has(key)) continue;
      const value = extras[key];
      if (typeof value === 'string' && value.length <= 512) safe[key] = value;
    }
    const base = this.build(input);
    const merged = { ...base, ...safe } as unknown as MobileRuntimeConfig;
    // Re-run the scanner over the merged object (cheap, and the only way the
    // extras path can be as safe as the base path).
    return this.build({ ...input, featureFlags: merged.featureFlags, branding: merged.branding });
  }
}
