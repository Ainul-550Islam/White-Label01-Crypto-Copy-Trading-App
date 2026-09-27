/**
 * Developer platform module wiring.
 *
 * Ports to existing infrastructure are adapted HERE (and only here):
 * - policy source: platform configuration (environment);
 * - policy data: tenant plan limits + features from the billing schema
 *   (single source of limit truth);
 * - secret HMAC key: platform secret infrastructure (fail-closed at boot —
 *   no hardcoded credential material);
 * - secret cipher: existing CryptoService (webhook secrets encrypted at
 *   rest, decryptable only for outbound signing);
 * - rate-limit store: existing Redis infrastructure;
 * - webhook HTTP: plain https client with timeout semantics.
 *
 * Usage metering stays with the existing UsageModule: developer usage is an
 * aggregation over authoritative UsageEvent rows, never a second counter.
 */

import { Global, Module, type Provider } from '@nestjs/common';

import { CryptoModule } from '../../infrastructure/crypto/crypto.module';
import { CryptoService } from '../../infrastructure/crypto/crypto.service';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisModule } from '../../infrastructure/redis/redis.module';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { ApiAccessService } from './api-access.service';
import { ApiRateLimitService, DEVELOPER_RATE_LIMIT_STORE } from './api-rate-limit.service';
import { ApiVersionService } from './api-version.service';
import {
  DEVELOPER_POLICY_DATA_PORT,
  DEVELOPER_POLICY_SOURCE,
  DeveloperPolicyService,
  type PlanLimitView,
} from './developer-policy.service';
import { DeveloperApplicationService } from './developer-application.service';
import { DeveloperAuditService } from './developer-audit.service';
import {
  DEVELOPER_SECRET_HMAC_KEY,
  DeveloperCredentialService,
} from './developer-credential.service';
import { DeveloperAnalyticsService } from './developer-analytics.service';
import { DeveloperReconciliationService } from './developer-reconciliation.service';
import { DeveloperScopeService } from './developer-scope.service';
import { DeveloperUsageService } from './developer-usage.service';
import { EventSubscriptionService } from './event-subscription.service';
import { OAuthService } from './oauth.service';
import {
  DEVELOPER_WEBHOOK_HTTP,
  WebhookDeliveryService,
  type WebhookHttpClient,
} from './webhook-delivery.service';
import {
  DEVELOPER_SECRET_CIPHER,
  WebhookSigningService,
  type DeveloperSecretCipher,
} from './webhook-signing.service';
import { WebhookReplayService } from './webhook-replay.service';
import { WebhookSubscriptionService } from './webhook-subscription.service';
import { DeveloperController } from './developer.controller';

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value || value.length < 16) {
    // Fail-closed: the service refuses to boot without platform secret
    // infrastructure. There is no development fallback credential.
    throw new Error(
      `${key} must be provided by secret infrastructure (>= 16 chars) before the developer platform can start`,
    );
  }
  return value;
}

const POLICY_SOURCE_PROVIDER: Provider = {
  provide: DEVELOPER_POLICY_SOURCE,
  useFactory: () => ({
    get: (key: string): string | undefined => process.env[key],
  }),
};

const POLICY_DATA_PROVIDER: Provider = {
  provide: DEVELOPER_POLICY_DATA_PORT,
  useFactory: (prisma: PrismaService) => ({
    async planLimitViewForTenant(tenantId: string): Promise<PlanLimitView> {
      // Authoritative truth: the tenant's active subscription plan rows.
      const subscription = await prisma.tenantSubscription.findFirst({
        where: { tenantId, status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] } },
        orderBy: { currentPeriodStart: 'desc' },
        select: { planId: true },
      });
      if (!subscription) {
        // No plan: NOTHING is granted (strictest interpretation).
        return { planKey: 'none', limits: {}, features: [] };
      }
      const [limits, features] = await Promise.all([
        prisma.planLimit.findMany({
          where: { planId: subscription.planId },
          select: { key: true, value: true },
        }),
        prisma.planFeature.findMany({
          where: { planId: subscription.planId, enabled: true },
          select: { key: true },
        }),
      ]);
      const limitMap: Record<string, number> = {};
      for (const limit of limits) limitMap[limit.key] = limit.value;
      return {
        planKey: subscription.planId,
        limits: limitMap,
        features: features.map((feature: { key: string }) => feature.key),
      };
    },
    async tenantEntitlementKeys(tenantId: string): Promise<string[]> {
      const rows = await prisma.tenantFeatureFlag.findMany({
        where: { tenantId, enabled: true },
        select: { featureFlag: { select: { key: true } } },
      });
      return rows.map((row: { featureFlag: { key: string } }) => row.featureFlag.key);
    },
  }),
  inject: [PrismaService],
};

const SECRET_HMAC_PROVIDER: Provider = {
  provide: DEVELOPER_SECRET_HMAC_KEY,
  useFactory: () => requireEnv('DEVELOPER_SECRET_HMAC_KEY'),
};

const SECRET_CIPHER_PROVIDER: Provider = {
  provide: DEVELOPER_SECRET_CIPHER,
  useFactory: (crypto: CryptoService): DeveloperSecretCipher => ({
    encrypt: (plaintext: string) => JSON.stringify(crypto.encrypt(plaintext, 'developer-webhook-secret')),
    decrypt: (ciphertext: string) => crypto.decrypt(JSON.parse(ciphertext), 'developer-webhook-secret'),
  }),
  inject: [CryptoService],
};

const RATE_LIMIT_STORE_PROVIDER: Provider = {
  provide: DEVELOPER_RATE_LIMIT_STORE,
  useFactory: (redis: RedisService) => ({
    // Fixed-minute buckets make the deterministic reset derivable without
    // reading internal Redis TTL state.
    incrementWithin: async (key: string, windowSeconds: number) => {
      const hits = (await redis.client.incr(`devrl:${key}`)) ?? 0;
      if (hits === 1) await redis.client.expire(`devrl:${key}`, windowSeconds);
      return hits;
    },
    ttlSeconds: async (key: string) => {
      const ttl = await redis.client.ttl(`devrl:${key}`);
      return ttl > 0 ? ttl : 60;
    },
  }),
  inject: [RedisService],
};

const WEBHOOK_HTTP_PROVIDER: Provider = {
  provide: DEVELOPER_WEBHOOK_HTTP,
  useFactory: (): WebhookHttpClient => ({
    async post(url, headers, body, timeoutMs) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body,
          signal: controller.signal,
        });
        // Response body is drained but never echoed: it may contain anything.
        await response.arrayBuffer().catch(() => undefined);
        return { status: response.status };
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          return { timedOut: true };
        }
        return { networkError: true };
      } finally {
        clearTimeout(timer);
      }
    },
  }),
};

@Global()
@Module({
  imports: [PrismaModule, RedisModule, CryptoModule],
  controllers: [DeveloperController],
  providers: [
    POLICY_SOURCE_PROVIDER,
    POLICY_DATA_PROVIDER,
    SECRET_HMAC_PROVIDER,
    SECRET_CIPHER_PROVIDER,
    RATE_LIMIT_STORE_PROVIDER,
    WEBHOOK_HTTP_PROVIDER,
    DeveloperPolicyService,
    DeveloperApplicationService,
    DeveloperCredentialService,
    DeveloperScopeService,
    OAuthService,
    ApiVersionService,
    ApiAccessService,
    ApiRateLimitService,
    WebhookSubscriptionService,
    WebhookSigningService,
    WebhookDeliveryService,
    WebhookReplayService,
    EventSubscriptionService,
    DeveloperUsageService,
    DeveloperAnalyticsService,
    DeveloperAuditService,
    DeveloperReconciliationService,
  ],
  exports: [
    DeveloperPolicyService,
    DeveloperApplicationService,
    DeveloperCredentialService,
    DeveloperScopeService,
    OAuthService,
    ApiVersionService,
    ApiAccessService,
    ApiRateLimitService,
    WebhookSubscriptionService,
    WebhookSigningService,
    WebhookDeliveryService,
    WebhookReplayService,
    EventSubscriptionService,
    DeveloperUsageService,
    DeveloperAnalyticsService,
    DeveloperAuditService,
    DeveloperReconciliationService,
  ],
})
export class DeveloperModule {}
