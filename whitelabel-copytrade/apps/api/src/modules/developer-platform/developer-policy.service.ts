/**
 * Resolves developer/API policy from tenant plan limits, entitlements and
 * platform configuration. The service NEVER invents limits: every number it
 * returns comes from the injected policy source (platform configuration) or
 * the tenant's plan-limit view. When a plan does not grant a capability the
 * resolved limit is 0/false — the strictest interpretation — never a
 * convenient default.
 */

import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { DEVELOPER_SCOPES, type ApiVersionContract } from './developer.types';

/** Platform configuration reader (env-backed in production; injectable for tests). */
export interface DeveloperPolicySource {
  get(key: string): string | undefined;
}

export const DEVELOPER_POLICY_SOURCE = Symbol('DEVELOPER_POLICY_SOURCE');

/**
 * Read-port for plan/entitlement truth. The module wires this to the
 * existing billing plans/entitlements services; services in this module
 * never touch plan tables directly (single source of limit truth).
 */
export interface DeveloperPolicyDataPort {
  planLimitViewForTenant(tenantId: string, transaction?: Prisma.TransactionClient): Promise<PlanLimitView>;
  tenantEntitlementKeys(tenantId: string, transaction?: Prisma.TransactionClient): Promise<string[]>;
}

export const DEVELOPER_POLICY_DATA_PORT = Symbol('DEVELOPER_POLICY_DATA_PORT');

/** Plan-limit view supplied by the billing/entitlement system (authoritative). */
export interface PlanLimitView {
  planKey: string;
  /** Raw plan-limit rows keyed by limit key; absent = not granted. */
  limits: Record<string, number>;
  features: readonly string[];
}

export interface DeveloperRateLimitPolicy {
  burstPerMinute: number;
  sustainedPerMinute: number;
}

export interface DeveloperOAuthPolicy {
  pkceRequired: boolean;
  requireConsent: boolean;
  authorizationCodeTtlSeconds: number;
  accessTokenTtlSeconds: number;
}

export interface DeveloperPolicy {
  tenantId: string;
  planKey: string;
  maxApplications: number;
  maxCredentialsPerApplication: number;
  maxRedirectUris: number;
  maxWebhookSubscriptions: number;
  maxWebhookEndpointsPerApplication: number;
  webhookMaxAttempts: number;
  webhookTimestampToleranceSeconds: number;
  rateLimit: DeveloperRateLimitPolicy;
  oauth: DeveloperOAuthPolicy;
  allowedScopes: string[];
  allowedApiVersions: string[];
  environments: ('SANDBOX' | 'PRODUCTION')[];
  partnerApplicationsAllowed: boolean;
  reactivationReviewRequired: boolean;
}

export const DEVELOPER_POLICY_ENV_KEYS = {
  burst: 'DEVELOPER_RATE_BURST_PER_MINUTE',
  sustained: 'DEVELOPER_RATE_SUSTAINED_PER_MINUTE',
  oauthCodeTtl: 'DEVELOPER_OAUTH_CODE_TTL_SECONDS',
  oauthTokenTtl: 'DEVELOPER_OAUTH_TOKEN_TTL_SECONDS',
  webhookMaxAttempts: 'DEVELOPER_WEBHOOK_MAX_ATTEMPTS',
  webhookTolerance: 'DEVELOPER_WEBHOOK_TOLERANCE_SECONDS',
  sandboxOnly: 'DEVELOPER_PLATFORM_SANDBOX_ONLY',
  defaultApiVersions: 'DEVELOPER_DEFAULT_API_VERSIONS',
} as const;

function positiveInt(source: DeveloperPolicySource, key: string, fallback: number): number {
  const raw = source.get(key);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function boolean(source: DeveloperPolicySource, key: string, fallback: boolean): boolean {
  const raw = source.get(key);
  if (raw === undefined) return fallback;
  return raw === 'true' || raw === '1';
}

@Injectable()
export class DeveloperPolicyService {
  constructor(
    @Inject(DEVELOPER_POLICY_SOURCE) private readonly source: DeveloperPolicySource = { get: () => undefined },
  ) {}

  /**
   * Resolves the FULL policy for a tenant. Plan limits are authoritative for
   * counts and capability; platform configuration is authoritative for
   * operational tuning (TTLs, tolerances, default rate tier).
   */
  resolve(tenantId: string, plan: PlanLimitView, entitlements: readonly string[]): DeveloperPolicy {
    const limit = (key: string): number => plan.limits[key];

    const maxApplications = limit('developer_applications') ?? 0;
    const maxCredentials = limit('developer_credentials_per_app') ?? 0;
    const maxWebhooks = limit('developer_webhook_subscriptions') ?? 0;

    // Platform rate tier, tightened (never loosened) by the plan's own cap.
    const platformBurst = positiveInt(this.source, DEVELOPER_POLICY_ENV_KEYS.burst, 600);
    const platformSustained = positiveInt(this.source, DEVELOPER_POLICY_ENV_KEYS.sustained, 120);
    const planBurst = limit('developer_rate_burst_per_minute');
    const planSustained = limit('developer_rate_sustained_per_minute');
    const burst = planBurst === undefined ? platformBurst : Math.min(platformBurst, planBurst);
    const sustained =
      planSustained === undefined ? platformSustained : Math.min(platformSustained, planSustained);

    // A tenant flag is not an independent platform entitlement: an enabled
    // override can outlive a downgrade. The current plan's machine-readable
    // grants are the hard ceiling, even when an old flag names a wider scope.
    const scopeByFeature: Record<string, string[]> = {
      developer_portfolio_read: ['profile:read', 'account:read', 'portfolio:read'],
      developer_trading: ['trading:read', 'trading:execute', 'portfolio:read'],
      developer_copy_trading: ['copy:read', 'copy:manage'],
      developer_billing: ['billing:read', 'statements:read'],
      developer_billing_manage: ['billing:manage'],
      developer_funding: ['funding:read', 'funding:request', 'statements:read'],
      developer_reporting: ['reports:read'],
      developer_webhooks: ['webhooks:manage'],
      developer_management: ['developer:manage'],
    };
    const allowedScopes = new Set<string>();
    const grantedFeatures = new Set(plan.features);
    for (const feature of [...plan.features, ...entitlements.filter((key) => grantedFeatures.has(key))]) {
      for (const scope of scopeByFeature[feature] ?? []) {
        allowedScopes.add(scope);
      }
    }
    // Every defined scope's backing capability must exist regardless; scopes
    // outside the catalog are rejected at validation, not here.
    const cataloged = new Set(DEVELOPER_SCOPES.map((definition) => definition.scope));
    const sandboxOnly = boolean(this.source, DEVELOPER_POLICY_ENV_KEYS.sandboxOnly, false);

    const configuredVersions = (this.source.get(DEVELOPER_POLICY_ENV_KEYS.defaultApiVersions) ?? 'v1,v2')
      .split(',')
      .map((version) => version.trim())
      .filter(Boolean);

    return {
      tenantId,
      planKey: plan.planKey,
      maxApplications,
      maxCredentialsPerApplication: maxCredentials,
      maxRedirectUris: limit('developer_redirect_uris') ?? 0,
      maxWebhookSubscriptions: maxWebhooks,
      maxWebhookEndpointsPerApplication: limit('developer_webhook_endpoints_per_app') ?? 0,
      webhookMaxAttempts: positiveInt(this.source, DEVELOPER_POLICY_ENV_KEYS.webhookMaxAttempts, 5),
      webhookTimestampToleranceSeconds: positiveInt(
        this.source,
        DEVELOPER_POLICY_ENV_KEYS.webhookTolerance,
        300,
      ),
      rateLimit: { burstPerMinute: burst, sustainedPerMinute: sustained },
      oauth: {
        // Interactive OAuth enforces S256 for every application, even if a
        // legacy plan omitted or disabled the historical toggle.
        pkceRequired: true,
        requireConsent: true,
        authorizationCodeTtlSeconds: positiveInt(
          this.source,
          DEVELOPER_POLICY_ENV_KEYS.oauthCodeTtl,
          600,
        ),
        accessTokenTtlSeconds: positiveInt(
          this.source,
          DEVELOPER_POLICY_ENV_KEYS.oauthTokenTtl,
          3600,
        ),
      },
      allowedScopes: [...allowedScopes].filter((scope) => cataloged.has(scope)).sort(),
      allowedApiVersions: configuredVersions,
      environments: sandboxOnly ? ['SANDBOX'] : ['SANDBOX', 'PRODUCTION'],
      partnerApplicationsAllowed: plan.features.includes('developer_partner_applications'),
      reactivationReviewRequired: limit('developer_reactivation_review') === 1,
    };
  }

  /** Deterministic answer for "may this tenant use this API version?" */
  apiVersionsFor(policy: DeveloperPolicy): ApiVersionContract['version'][] {
    return policy.allowedApiVersions.filter((version) => /^[a-z]\d+$/.test(version));
  }
}
