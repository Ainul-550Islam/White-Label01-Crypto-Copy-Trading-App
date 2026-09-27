/**
 * Developer webhook subscription lifecycle with ownership enforcement,
 * deterministic event filtering, secret lifecycle and delivery policy.
 *
 * A subscription belongs to exactly one (tenant, application). Endpoints
 * must be https in PRODUCTION. The signing secret is shown ONCE at creation
 * and stored only as an HMAC digest. Every mutation is audited.
 */

import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  constantTimeEqual,
  credentialDigest,
  DEVELOPER_ERROR_CODES,
  DeveloperError,
  eventDefinition,
  idempotencyKey,
  isKnownEventType,
  validateScopes,
} from './developer.types';
import { DeveloperAuditService, type DeveloperAuditActor } from './developer-audit.service';
import {
  DEVELOPER_POLICY_DATA_PORT,
  DeveloperPolicyDataPort,
  DeveloperPolicyService,
} from './developer-policy.service';
import { DEVELOPER_SECRET_CIPHER, WebhookSigningService, type DeveloperSecretCipher } from './webhook-signing.service';
import { DEVELOPER_SECRET_HMAC_KEY } from './developer-credential.service';

const HTTPS_ENDPOINT_PATTERN = /^https:\/\/[A-Za-z0-9.\-_:]+[A-Za-z0-9/\-._~%]*$/;

export interface CreateSubscriptionInput {
  applicationId: string;
  endpointUrl: string;
  eventTypes: string[];
  eventVersion?: string;
  environment?: 'SANDBOX' | 'PRODUCTION';
  description?: string;
}

@Injectable()
export class WebhookSubscriptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DeveloperAuditService,
    private readonly policyService: DeveloperPolicyService,
    private readonly policyData: DeveloperPolicyDataPort,
    private readonly signing: WebhookSigningService,
    @Inject(DEVELOPER_SECRET_HMAC_KEY) private readonly hmacKey: string,
    @Inject(DEVELOPER_SECRET_CIPHER) private readonly cipher: DeveloperSecretCipher,
  ) {}

  private validateEndpoint(url: string, environment: string): string {
    if (!HTTPS_ENDPOINT_PATTERN.test(url)) {
      throw new DeveloperError(
        DEVELOPER_ERROR_CODES.WEBHOOK_ENDPOINT_INVALID,
        'webhook endpoint must be a valid https URL',
      );
    }
    if (environment === 'PRODUCTION' && /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(url)) {
      throw new DeveloperError(
        DEVELOPER_ERROR_CODES.WEBHOOK_ENDPOINT_INVALID,
        'production endpoints cannot target loopback hosts',
      );
    }
    return url;
  }

  private validateEventTypes(eventTypes: string[]): string[] {
    const unique = [...new Set(eventTypes.map((type) => type.trim()).filter(Boolean))];
    if (unique.length === 0) {
      throw new DeveloperError(DEVELOPER_ERROR_CODES.VALIDATION, 'at least one event type is required');
    }
    for (const eventType of unique) {
      if (!isKnownEventType(eventType)) {
        throw new DeveloperError(
          DEVELOPER_ERROR_CODES.EVENT_NOT_SUBSCRIBED,
          `event type '${eventType}' does not exist on this platform`,
        );
      }
    }
    return unique.sort();
  }

  private async loadOwnedApplication(tenantId: string, applicationId: string) {
    const application = await this.prisma.developerApplication.findUnique({
      where: { id: applicationId },
    });
    if (!application || application.tenantId !== tenantId) {
      throw new NotFoundException('developer application not found');
    }
    return application;
  }

  async create(actor: DeveloperAuditActor, input: CreateSubscriptionInput) {
    const application = await this.loadOwnedApplication(actor.tenantId, input.applicationId);
    if (application.state === 'REVOKED') {
      throw new DeveloperError(DEVELOPER_ERROR_CODES.APPLICATION_REVOKED, 'application is revoked');
    }
    const plan = await this.policyData.planLimitViewForTenant(actor.tenantId);
    const entitlements = await this.policyData.tenantEntitlementKeys(actor.tenantId);
    const policy = this.policyService.resolve(actor.tenantId, plan, entitlements);

    const activeCount = await this.prisma.developerWebhookSubscription.count({
      where: { tenantId: actor.tenantId, revokedAt: null },
    });
    if (activeCount >= policy.maxWebhookSubscriptions) {
      throw new DeveloperError(
        DEVELOPER_ERROR_CODES.POLICY_LIMIT,
        `plan allows at most ${policy.maxWebhookSubscriptions} webhook subscriptions`,
      );
    }
    // webhooks:manage must be inside the application's declared scopes.
    validateScopes(['webhooks:manage']);
    if (!application.scopes.includes('webhooks:manage')) {
      throw new DeveloperError(
        DEVELOPER_ERROR_CODES.SCOPE_NOT_ALLOWED,
        "application does not hold the 'webhooks:manage' scope",
      );
    }

    const environment = input.environment ?? application.environment;
    const endpointUrl = this.validateEndpoint(input.endpointUrl, environment);
    const eventTypes = this.validateEventTypes(input.eventTypes);
    const eventVersion = input.eventVersion ?? 'v1';

    const secret = this.signing.newSecret();
    const subscription = await this.prisma.developerWebhookSubscription.create({
      data: {
        tenantId: actor.tenantId,
        applicationId: application.id,
        endpointUrl,
        eventTypes,
        eventVersion,
        environment,
        description: input.description ?? null,
        state: 'ACTIVE',
        secretHash: credentialDigest(secret, this.hmacKey),
        // Retrievable ONLY through the platform crypto infrastructure so the
        // delivery pipeline can sign; never rendered outside signing.
        secretEncrypted: this.cipher.encrypt(secret),
        idempotencyKey: idempotencyKey(
          actor.tenantId,
          'webhook.subscription',
          `${application.id}|${endpointUrl}|${eventTypes.join(',')}`,
        ),
        createdByActorId: actor.actorId,
      },
    });
    await this.audit.record({
      ...actor,
      applicationId: application.id,
      action: 'webhook.created',
      detail: { subscriptionId: subscription.id, endpointUrl, eventTypes, eventVersion },
    });
    // One-time presentation of the endpoint secret.
    return { subscription, secret };
  }

  private async loadOwnedSubscription(tenantId: string, subscriptionId: string) {
    const subscription = await this.prisma.developerWebhookSubscription.findUnique({
      where: { id: subscriptionId },
    });
    if (!subscription || subscription.tenantId !== tenantId) {
      throw new NotFoundException('webhook subscription not found');
    }
    return subscription;
  }

  async update(
    actor: DeveloperAuditActor,
    subscriptionId: string,
    patch: { endpointUrl?: string; eventTypes?: string[]; description?: string },
  ) {
    const subscription = await this.loadOwnedSubscription(actor.tenantId, subscriptionId);
    if (subscription.revokedAt) {
      throw new DeveloperError(DEVELOPER_ERROR_CODES.VALIDATION, 'revoked subscriptions cannot be updated');
    }
    const endpointUrl = patch.endpointUrl
      ? this.validateEndpoint(patch.endpointUrl, subscription.environment)
      : subscription.endpointUrl;
    const eventTypes = patch.eventTypes
      ? this.validateEventTypes(patch.eventTypes)
      : subscription.eventTypes;
    const updated = await this.prisma.developerWebhookSubscription.update({
      where: { id: subscription.id },
      data: {
        endpointUrl,
        eventTypes,
        description: patch.description ?? subscription.description,
      },
    });
    await this.audit.record({
      ...actor,
      applicationId: subscription.applicationId,
      action: 'webhook.changed',
      detail: { subscriptionId, fields: Object.keys(patch) },
    });
    return updated;
  }

  async pause(actor: DeveloperAuditActor, subscriptionId: string, reason?: string) {
    const subscription = await this.loadOwnedSubscription(actor.tenantId, subscriptionId);
    if (subscription.state !== 'ACTIVE') {
      throw new DeveloperError(DEVELOPER_ERROR_CODES.INVALID_TRANSITION, 'only ACTIVE subscriptions can pause');
    }
    const updated = await this.prisma.developerWebhookSubscription.update({
      where: { id: subscription.id },
      data: { state: 'PAUSED' },
    });
    await this.audit.record({
      ...actor,
      applicationId: subscription.applicationId,
      action: 'webhook.paused',
      detail: { subscriptionId, reason: reason ?? null },
    });
    return updated;
  }

  async resume(actor: DeveloperAuditActor, subscriptionId: string, reason?: string) {
    const subscription = await this.loadOwnedSubscription(actor.tenantId, subscriptionId);
    if (subscription.state !== 'PAUSED') {
      throw new DeveloperError(DEVELOPER_ERROR_CODES.INVALID_TRANSITION, 'only PAUSED subscriptions can resume');
    }
    const updated = await this.prisma.developerWebhookSubscription.update({
      where: { id: subscription.id },
      data: { state: 'ACTIVE' },
    });
    await this.audit.record({
      ...actor,
      applicationId: subscription.applicationId,
      action: 'webhook.resumed',
      detail: { subscriptionId, reason: reason ?? null },
    });
    return updated;
  }

  async revoke(actor: DeveloperAuditActor, subscriptionId: string, reason?: string) {
    const subscription = await this.loadOwnedSubscription(actor.tenantId, subscriptionId);
    if (!subscription.revokedAt) {
      await this.prisma.developerWebhookSubscription.update({
        where: { id: subscription.id },
        data: { state: 'REVOKED', revokedAt: new Date() },
      });
    }
    await this.audit.record({
      ...actor,
      applicationId: subscription.applicationId,
      action: 'webhook.revoked',
      detail: { subscriptionId, reason: reason ?? null },
    });
  }

  /** Rotates the endpoint secret; new secret shown once. */
  async rotateSecret(actor: DeveloperAuditActor, subscriptionId: string): Promise<{ secret: string }> {
    const subscription = await this.loadOwnedSubscription(actor.tenantId, subscriptionId);
    if (subscription.revokedAt) {
      throw new DeveloperError(DEVELOPER_ERROR_CODES.VALIDATION, 'revoked subscriptions cannot rotate secrets');
    }
    const secret = this.signing.newSecret();
    await this.prisma.developerWebhookSubscription.update({
      where: { id: subscription.id },
      data: {
        secretHash: credentialDigest(secret, this.hmacKey),
        secretEncrypted: this.cipher.encrypt(secret),
      },
    });
    await this.audit.record({
      ...actor,
      applicationId: subscription.applicationId,
      action: 'webhook.secret_rotated',
      detail: { subscriptionId },
    });
    return { secret };
  }

  /** Digest comparison used by the delivery pipeline (never exposes it). */
  async secretMatches(subscriptionId: string, tenantId: string, secret: string): Promise<boolean> {
    const subscription = await this.loadOwnedSubscription(tenantId, subscriptionId);
    return constantTimeEqual(credentialDigest(secret, this.hmacKey), subscription.secretHash);
  }

  /** Delivery-time event filter (CHECK 41) + subscription liveness. */
  async acceptsEvent(subscriptionId: string, tenantId: string, eventType: string, environment: string) {
    const subscription = await this.loadOwnedSubscription(tenantId, subscriptionId);
    if (subscription.revokedAt || subscription.state !== 'ACTIVE') {
      throw new DeveloperError(DEVELOPER_ERROR_CODES.EVENT_NOT_SUBSCRIBED, 'subscription is not active');
    }
    if (!subscription.eventTypes.includes(eventType)) {
      throw new DeveloperError(DEVELOPER_ERROR_CODES.EVENT_NOT_SUBSCRIBED, `event '${eventType}' is not subscribed`);
    }
    if (subscription.environment !== environment) {
      throw new DeveloperError(DEVELOPER_ERROR_CODES.ENVIRONMENT_MISMATCH, 'event environment does not match subscription');
    }
    return subscription;
  }

  async list(tenantId: string, query: { applicationId?: string; status?: string; limit?: number; cursor?: string }) {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    const rows = await this.prisma.developerWebhookSubscription.findMany({
      where: {
        tenantId,
        ...(query.applicationId ? { applicationId: query.applicationId } : {}),
        ...(query.status ? { state: query.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return {
      rows: rows.map(({ secretHash, ...safe }: { secretHash?: string } & Record<string, unknown>) => {
        void secretHash;
        return safe;
      }),
    };
  }
}
